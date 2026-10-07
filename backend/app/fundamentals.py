"""Temel analiz ve temettü verileri.

Şirket bilgileri ve finansallar Yahoo Finance'ten alınır. Bazı BIST şirketleri
finansallarını döviz cinsinden raporladığından (ör. THY: USD), piyasa değeri ile
kıyaslanan oranlar (F/K, PD/DD, F/S) finansal para birimi TL'ye çevrilerek
yeniden hesaplanır.
"""
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pandas as pd
import yfinance as yf

from . import market

_info_cache: dict[str, tuple[float, dict]] = {}
_div_cache: dict[str, tuple[float, pd.Series]] = {}
_lock = threading.Lock()
INFO_TTL = 6 * 3600
DIV_TTL = 12 * 3600
FX = {"USD": "USDTRY=X", "EUR": "EURTRY=X"}


def _info(symbol: str) -> dict:
    with _lock:
        hit = _info_cache.get(symbol)
    if hit and time.time() - hit[0] < INFO_TTL:
        return hit[1]
    info = {}
    for attempt in range(3):
        try:
            info = yf.Ticker(symbol).info or {}
        except Exception:
            info = {}
        if len(info) >= 40 or attempt == 2:  # eksik yanıt gelirse (eşzamanlı isteklerde olabiliyor) tekrar dene
            break
        time.sleep(0.5)
    if len(info) >= 40:
        with _lock:
            _info_cache[symbol] = (time.time(), info)
    return info


def dividends_series(symbol: str) -> pd.Series:
    with _lock:
        hit = _div_cache.get(symbol)
    if hit and time.time() - hit[0] < DIV_TTL:
        return hit[1]
    try:
        s = yf.Ticker(symbol).dividends
        s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
        s = s[s > 0]
    except Exception:
        s = pd.Series(dtype=float)
    with _lock:
        _div_cache[symbol] = (time.time(), s)
    return s


def _fx_rate(fin_ccy: str | None, trade_ccy: str) -> float:
    """Finansal tablo para birimini işlem para birimine çeviren kur."""
    if not fin_ccy or fin_ccy == trade_ccy:
        return 1.0
    if trade_ccy == "TRY" and fin_ccy in FX:
        q = market.quotes([FX[fin_ccy]])[0]
        return q["price"] or 1.0
    return 1.0


def _num(v):
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def _statement(df: pd.DataFrame | None, rows: dict[str, list[str]], scale: float) -> list[dict]:
    if df is None or df.empty:
        return []
    out = []
    for col in list(df.columns)[:8][::-1]:
        item = {"period": pd.Timestamp(col).strftime("%Y-%m")}
        for key, names in rows.items():
            val = next((df.at[n, col] for n in names if n in df.index and pd.notna(df.at[n, col])), None)
            item[key] = float(val) * scale if val is not None else None
        out.append(item)
    return out


def summary(symbol: str, with_statements: bool = True) -> dict:
    symbol = symbol.upper()
    info = _info(symbol)
    q = market.quotes([symbol])[0]
    price = q["price"] or _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    trade_ccy = info.get("currency") or market.currency_of(symbol)
    fin_ccy = info.get("financialCurrency") or trade_ccy
    k = _fx_rate(fin_ccy, trade_ccy)

    mcap = _num(info.get("marketCap"))
    net = _num(info.get("netIncomeToCommon"))
    rev = _num(info.get("totalRevenue"))
    # Veri sağlayıcının "financialCurrency" alanı her zaman doğru değil (bazı şirketlerde rakamlar zaten TL).
    # Kur düzeltmesi yalnızca Fiyat/Satış oranını makul bir düzeye yaklaştırıyorsa uygulanır.
    if k != 1.0 and mcap and rev:
        if abs(math.log(mcap / (rev * k))) >= abs(math.log(mcap / rev)):
            k = 1.0
    book = _num(info.get("bookValue"))
    eps = _num(info.get("trailingEps"))
    shares = _num(info.get("sharesOutstanding"))
    ebitda = _num(info.get("ebitda"))
    ev = _num(info.get("enterpriseValue"))
    divs = dividends_series(symbol)
    ttm_div = float(divs[divs.index > pd.Timestamp.now() - pd.Timedelta(days=365)].sum()) if len(divs) else 0.0

    ratios = {
        "pe": mcap / (net * k) if mcap and net and net > 0 else None,
        "pb": price / (book * k) if price and book and book > 0 else None,
        "ps": mcap / (rev * k) if mcap and rev else None,
        "ev_ebitda": ev / (ebitda * k) if ev and ebitda and ebitda > 0 else None,
        "forward_pe": _num(info.get("forwardPE")),
        "eps": net * k / shares if net and shares else (eps * k if eps is not None else None),
        "dividend_yield": ttm_div / price * 100 if price else None,
        "payout_ratio": (_num(info.get("payoutRatio")) or 0) * 100 if info.get("payoutRatio") is not None else None,
        "profit_margin": (_num(info.get("profitMargins")) or 0) * 100 if info.get("profitMargins") is not None else None,
        "operating_margin": (_num(info.get("operatingMargins")) or 0) * 100 if info.get("operatingMargins") is not None else None,
        "roe": (_num(info.get("returnOnEquity")) or 0) * 100 if info.get("returnOnEquity") is not None else None,
        "roa": (_num(info.get("returnOnAssets")) or 0) * 100 if info.get("returnOnAssets") is not None else None,
        "debt_to_equity": _num(info.get("debtToEquity")),
        "current_ratio": _num(info.get("currentRatio")),
        "revenue_growth": (_num(info.get("revenueGrowth")) or 0) * 100 if info.get("revenueGrowth") is not None else None,
        "earnings_growth": (_num(info.get("earningsGrowth")) or 0) * 100 if info.get("earningsGrowth") is not None else None,
        "beta": _num(info.get("beta")),
    }

    # Basit puanlama: değerleme, kârlılık, büyüme ve finansal sağlık
    def score(v, good, bad, higher_better=True):
        if v is None:
            return None
        if not higher_better:
            v, good, bad = -v, -good, -bad
        return max(0.0, min(1.0, (v - bad) / (good - bad)))

    parts = {
        "Değerleme": [score(ratios["pe"], 8, 30, False), score(ratios["pb"], 1, 6, False)],
        "Kârlılık": [score(ratios["profit_margin"], 20, 0), score(ratios["roe"], 25, 0)],
        "Büyüme": [score(ratios["revenue_growth"], 30, -5), score(ratios["earnings_growth"], 30, -20)],
        "Finansal sağlık": [score(ratios["debt_to_equity"], 30, 200, False), score(ratios["current_ratio"], 2, 0.8)],
    }
    scores = {}
    for name, vals in parts.items():
        vals = [v for v in vals if v is not None]
        scores[name] = round(sum(vals) / len(vals) * 100) if vals else None

    result = {
        "symbol": symbol, "name": info.get("longName") or info.get("shortName") or market.NAME_BY_SYMBOL.get(symbol, symbol),
        "sector": info.get("sector"), "industry": info.get("industry"), "website": info.get("website"),
        "employees": info.get("fullTimeEmployees"), "description": info.get("longBusinessSummary"),
        "currency": trade_ccy, "financial_currency": fin_ccy, "fx_applied": k if k != 1.0 else None,
        "price": price, "market_cap": mcap, "shares": _num(info.get("sharesOutstanding")),
        "high_52w": _num(info.get("fiftyTwoWeekHigh")), "low_52w": _num(info.get("fiftyTwoWeekLow")),
        "ratios": ratios, "scores": scores,
        "revenue_ttm": rev * k if rev else None, "net_income_ttm": net * k if net else None,
        "target_price": _num(info.get("targetMeanPrice")), "recommendation": info.get("recommendationKey"),
        "analyst_count": info.get("numberOfAnalystOpinions"),
    }
    if with_statements:
        t = yf.Ticker(symbol)
        rows = {"revenue": ["Total Revenue", "Operating Revenue"], "gross_profit": ["Gross Profit"],
                "operating_income": ["Operating Income", "EBIT"], "net_income": ["Net Income", "Net Income Common Stockholders"]}
        try:
            result["quarterly"] = _statement(t.quarterly_income_stmt, rows, k)
        except Exception:
            result["quarterly"] = []
        try:
            result["annual"] = _statement(t.income_stmt, rows, k)
        except Exception:
            result["annual"] = []
    return result


def peers(symbol: str) -> list[dict]:
    """Uygulamanın kataloğunda aynı piyasa ve sektördeki şirketlerle oran karşılaştırması."""
    symbol = symbol.upper()
    asset = market.ASSET_BY_SYMBOL.get(symbol)
    m = market.market_of(symbol)
    group = [a["symbol"] for a in market.CATALOG.get(m, []) if not a.get("index")
             and (asset is None or a.get("sector") == asset.get("sector"))]
    if symbol not in group:
        group.insert(0, symbol)
    group = group[:8]
    with ThreadPoolExecutor(max_workers=3) as ex:
        data = list(ex.map(lambda s: summary(s, with_statements=False), group))
    return [{"symbol": d["symbol"], "name": d["name"], "market_cap": d["market_cap"], **d["ratios"]} for d in data]


# ----------------------------------------------------------------------------- temettü
def dividend_profile(symbol: str, price: float | None) -> dict:
    s = dividends_series(symbol)
    now = pd.Timestamp.now()
    if s.empty:
        return {"symbol": symbol, "pays": False}
    last12 = s[s.index > now - pd.Timedelta(days=365)]
    yearly = s.groupby(s.index.year).sum()
    full_years = yearly[yearly.index < now.year]
    growth = None
    if len(full_years) >= 6 and full_years.iloc[-6] > 0:
        growth = ((full_years.iloc[-1] / full_years.iloc[-6]) ** (1 / 5) - 1) * 100
    streak = 0
    for y in range(now.year - 1, now.year - 40, -1):
        if y in yearly.index and yearly[y] > 0:
            streak += 1
        else:
            break
    ttm = float(last12.sum())
    info = _info(symbol)
    ex_next = info.get("exDividendDate")
    ex_next = datetime.fromtimestamp(ex_next).strftime("%Y-%m-%d") if isinstance(ex_next, (int, float)) and ex_next > time.time() else None
    return {
        "symbol": symbol, "pays": True, "ttm_per_share": ttm,
        "yield_pct": ttm / price * 100 if price else None,
        "payments_12m": int(len(last12)), "last_date": s.index[-1].strftime("%Y-%m-%d"), "last_amount": float(s.iloc[-1]),
        "next_ex_date": ex_next, "growth_5y_pct": float(growth) if growth is not None else None, "streak_years": streak,
        "paid_last_12m": ttm > 0,
    }


def dividend_list(market_key: str) -> list[dict]:
    assets = [a for a in market.CATALOG.get(market_key, []) if not a.get("index")]
    qs = {q["symbol"]: q for q in market.quotes([a["symbol"] for a in assets])}
    with ThreadPoolExecutor(max_workers=8) as ex:
        profiles = list(ex.map(lambda a: dividend_profile(a["symbol"], qs[a["symbol"]]["price"]), assets))
    out = []
    for a, p in zip(assets, profiles):
        q = qs[a["symbol"]]
        out.append({**p, "name": a["name"], "sector": a.get("sector"), "price": q["price"], "currency": q["currency"],
                    "change_pct": q["change_pct"]})
    return out


def dividend_history(symbol: str) -> dict:
    s = dividends_series(symbol.upper())
    yearly = s.groupby(s.index.year).sum() if len(s) else pd.Series(dtype=float)
    return {
        "symbol": symbol.upper(),
        "payments": [{"date": d.strftime("%Y-%m-%d"), "amount": float(v)} for d, v in s.items()][::-1][:60],
        "yearly": [{"year": int(y), "amount": float(v)} for y, v in yearly.items()][-15:],
    }
