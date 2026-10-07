"""Nicel analizler: portföy optimizasyonu (etkin sınır), Monte Carlo simülasyonu ve enflasyona göre reel getiri."""
import html
import re
import threading
import time
import urllib.request
from datetime import date

import numpy as np
import pandas as pd

from . import market

# ----------------------------------------------------------------------------- yardımcı
def _returns(symbols: list[str], period: str = "1y") -> pd.DataFrame:
    """Varlıkların TL bazında günlük getirileri (ABD varlıkları USD/TRY ile çevrilir)."""
    usd = market.to_frame(market.history("USDTRY=X", period, "1d"))["close"]
    usd.index = usd.index.normalize()
    usd = usd[~usd.index.duplicated(keep="last")]
    cols = {}
    for s in symbols:
        c = market.to_frame(market.history(s, period, "1d"))["close"]
        c.index = c.index.normalize()
        c = c[~c.index.duplicated(keep="last")]
        if market.currency_of(s) == "USD":
            c = c * usd.reindex(c.index).ffill()
        cols[s] = c
    prices = pd.DataFrame(cols).ffill().dropna()
    return prices.pct_change().dropna()


# ----------------------------------------------------------------------------- etkin sınır
def optimize(symbols: list[str], n: int = 4000, seed: int = 7) -> dict:
    """Rastgele portföylerle etkin sınır; en düşük oynaklık ve en yüksek Sharpe ağırlıkları."""
    symbols = list(dict.fromkeys(s.upper() for s in symbols))[:10]
    if len(symbols) < 2:
        raise ValueError("En az iki varlık seçin.")
    r = _returns(symbols)
    mu, cov = r.mean().values * 252, r.cov().values * 252
    rng = np.random.default_rng(seed)
    w = rng.dirichlet(np.ones(len(symbols)), n)
    rets = w @ mu
    vols = np.sqrt(np.einsum("ij,jk,ik->i", w, cov, w))
    sharpe = rets / vols
    i_min, i_max = int(vols.argmin()), int(sharpe.argmax())
    eq = np.ones(len(symbols)) / len(symbols)

    def pack(weights):
        weights = np.asarray(weights)
        ret = float(weights @ mu)
        vol = float(np.sqrt(weights @ cov @ weights))
        return {"weights": {s: round(float(x) * 100, 2) for s, x in zip(symbols, weights)},
                "return_pct": ret * 100, "volatility_pct": vol * 100, "sharpe": ret / vol if vol else None}

    step = max(1, n // 1500)
    return {
        "symbols": symbols,
        "cloud": [{"vol": float(v) * 100, "ret": float(x) * 100, "sharpe": float(s)} for v, x, s in zip(vols[::step], rets[::step], sharpe[::step])],
        "min_volatility": pack(w[i_min]), "max_sharpe": pack(w[i_max]), "equal_weight": pack(eq),
        "assets": [{"symbol": s, "return_pct": float(m) * 100, "volatility_pct": float(np.sqrt(cov[i, i])) * 100}
                   for i, (s, m) in enumerate(zip(symbols, mu))],
        "correlation": np.round(r.corr().values, 3).tolist(),
        "days": len(r),
    }


# ----------------------------------------------------------------------------- Monte Carlo
def monte_carlo(weights: dict[str, float], start_value: float, days: int = 252, paths: int = 2000, seed: int = 11) -> dict:
    """Geçmiş günlük getirilerden yeniden örnekleme (bootstrap) ile portföyün olası gelecek değerleri."""
    symbols = [s for s, w in weights.items() if w > 0]
    if not symbols:
        raise ValueError("Portföyde varlık yok.")
    r = _returns(symbols, "2y")
    w = np.array([weights[s] for s in symbols], dtype=float)
    w = w / w.sum()
    port = (r.values @ w)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(port), size=(paths, days))
    growth = np.cumprod(1 + port[idx], axis=1)
    values = start_value * growth
    pct = {p: np.percentile(values, p, axis=0) for p in (5, 25, 50, 75, 95)}
    today = pd.Timestamp(date.today())
    times = [int((today + pd.offsets.BDay(i + 1)).timestamp()) for i in range(days)]
    final = values[:, -1]
    return {
        "bands": {str(p): [{"time": t, "value": round(float(v), 2)} for t, v in zip(times[::2], arr[::2])] for p, arr in pct.items()},
        "final": {str(p): float(np.percentile(final, p)) for p in (5, 25, 50, 75, 95)},
        "prob_loss": float((final < start_value).mean() * 100),
        "prob_gain_20": float((final > start_value * 1.2).mean() * 100),
        "start_value": start_value, "days": days, "paths": paths, "history_days": len(port),
    }


# ----------------------------------------------------------------------------- enflasyon
TCMB_URL = "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Enflasyon+Verileri/Tuketici+Fiyatlari"
_cpi: tuple[float, pd.DataFrame] | None = None
_lock = threading.Lock()


def cpi() -> pd.DataFrame:
    """TCMB'nin yayımladığı aylık TÜFE değişimleri (yıllık % ve aylık %), 2005'ten bugüne."""
    global _cpi
    with _lock:
        if _cpi and time.time() - _cpi[0] < 12 * 3600:
            return _cpi[1]
    req = urllib.request.Request(TCMB_URL, headers={"User-Agent": "Mozilla/5.0 FinAnaliz"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    data = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 3 and re.fullmatch(r"\d{2}-\d{4}", cells[0]):
            try:
                data.append({"month": pd.Timestamp(f"{cells[0][3:]}-{cells[0][:2]}-01"), "yearly": float(cells[1].replace(",", ".")),
                             "monthly": float(cells[2].replace(",", "."))})
            except ValueError:
                pass
    df = pd.DataFrame(data).sort_values("month").set_index("month")
    with _lock:
        _cpi = (time.time(), df)
    return df


def inflation_between(start: pd.Timestamp, end: pd.Timestamp | None = None) -> float | None:
    """İki tarih arasındaki kümülatif TÜFE artışı (%). Ay içi kısımlar orantılanır; son açıklanan aydan sonrası
    son aylık değerle tahmin edilir."""
    df = cpi()
    if df.empty:
        return None
    end = end or pd.Timestamp(date.today())
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    if end <= start:
        return 0.0
    factor = 1.0
    last_monthly = float(df["monthly"].iloc[-1])
    m = pd.Timestamp(start.year, start.month, 1)
    while m <= end:
        nxt = m + pd.offsets.MonthBegin(1)
        rate = float(df.loc[m, "monthly"]) if m in df.index else last_monthly
        a, b = max(start, m), min(end, nxt)
        frac = (b - a).days / (nxt - m).days
        factor *= (1 + rate / 100) ** max(frac, 0)
        m = nxt
    return (factor - 1) * 100


def real_return(nominal_pct: float, inflation_pct: float) -> float:
    return ((1 + nominal_pct / 100) / (1 + inflation_pct / 100) - 1) * 100


def inflation_summary() -> dict:
    df = cpi()
    last = df.iloc[-1]
    return {"last_month": df.index[-1].strftime("%Y-%m"), "yearly": float(last["yearly"]), "monthly": float(last["monthly"]),
            "series": [{"month": i.strftime("%Y-%m"), "yearly": float(r["yearly"]), "monthly": float(r["monthly"])}
                       for i, r in df.tail(36).iterrows()],
            "source": "TCMB – Tüketici Fiyatları (TÜİK verisi)"}


# ----------------------------------------------------------------------------- korelasyon
def correlation(symbols: list[str], period: str = "1y") -> dict:
    symbols = list(dict.fromkeys(symbols))[:15]
    if len(symbols) < 2:
        raise ValueError("Korelasyon için en az iki varlık gerekir.")
    r = _returns(symbols, period)
    corr = r.corr()
    pairs = [(a, b, float(corr.loc[a, b])) for i, a in enumerate(symbols) for b in symbols[i + 1:]]
    pairs.sort(key=lambda x: -x[2])
    avg = float(np.mean([p[2] for p in pairs])) if pairs else None
    return {"symbols": symbols, "matrix": np.round(corr.values, 3).tolist(), "average": avg,
            "most_similar": [{"a": a, "b": b, "corr": c} for a, b, c in pairs[:3]],
            "most_different": [{"a": a, "b": b, "corr": c} for a, b, c in pairs[-3:][::-1]], "days": len(r)}


# ----------------------------------------------------------------------------- senaryo analizi
FACTORS = {"XU100.IS": "BIST 100", "USDTRY=X": "Dolar/TL", "^GSPC": "S&P 500", "GC=F": "Altın (ons)", "BTC-USD": "Bitcoin"}


def scenario(holdings: dict[str, float], shocks: dict[str, float]) -> dict:
    """holdings: {sembol: TL değeri}; shocks: {faktör: % değişim}. Her varlığın TL getirisi, son 1 yılın günlük verisiyle
    faktörlerin günlük getirilerine çok değişkenli regresyonla bağlanır; şok faktörlere uygulanarak beklenen etki hesaplanır."""
    shocks = {k: v for k, v in shocks.items() if k in FACTORS and v}
    if not holdings:
        raise ValueError("Portföyde varlık yok.")
    if not shocks:
        raise ValueError("En az bir senaryo değişkeni girin.")
    factors = list(shocks)
    syms = list(holdings)
    r = _returns(list(dict.fromkeys(syms + factors)), "1y")
    X = r[factors].values
    X1 = np.column_stack([np.ones(len(X)), X])
    shock_vec = np.array([shocks[f] / 100 for f in factors])
    items, total_before, total_after = [], 0.0, 0.0
    for s in syms:
        if s in factors:
            betas = np.array([1.0 if f == s else 0.0 for f in factors])
            r2 = 1.0
        else:
            y = r[s].values
            coef, *_ = np.linalg.lstsq(X1, y, rcond=None)
            betas = coef[1:]
            pred = X1 @ coef
            ss = ((y - y.mean()) ** 2).sum()
            r2 = float(1 - ((y - pred) ** 2).sum() / ss) if ss > 0 else 0.0
        impact = float(betas @ shock_vec)
        v = holdings[s]
        items.append({"symbol": s, "value": v, "impact_pct": impact * 100, "impact_try": v * impact,
                      "betas": {FACTORS[f]: round(float(b), 3) for f, b in zip(factors, betas)}, "r2": round(r2, 3)})
        total_before += v
        total_after += v * (1 + impact)
    items.sort(key=lambda x: x["impact_try"])
    return {"shocks": {FACTORS[k]: v for k, v in shocks.items()}, "items": items, "before": total_before, "after": total_after,
            "impact_try": total_after - total_before, "impact_pct": (total_after / total_before - 1) * 100 if total_before else 0, "days": len(r)}


# ----------------------------------------------------------------------------- sektör rotasyonu
def sector_rotation(market_key: str) -> dict:
    assets = [a for a in market.CATALOG.get(market_key, []) if not a.get("index")]
    frames = market.daily_frames([a["symbol"] for a in assets])
    by_sector: dict[str, list] = {}
    for a in assets:
        f = frames.get(a["symbol"])
        if f is None or len(f) < 130:
            continue
        c = f["Close"]
        ret = lambda n: (float(c.iloc[-1]) / float(c.iloc[-1 - n]) - 1) * 100
        by_sector.setdefault(a.get("sector") or "Diğer", []).append({"1w": ret(5), "1m": ret(21), "3m": ret(63), "6m": ret(126), "symbol": a["symbol"]})
    out = []
    for sec, lst in by_sector.items():
        avg = {k: float(np.mean([x[k] for x in lst])) for k in ("1w", "1m", "3m", "6m")}
        # Momentum: kısa vadeli getiri orta vadeli getiriden iyiyse hızlanıyor
        momentum = avg["1m"] - avg["3m"] / 3
        quadrant = ("Lider" if avg["3m"] >= 0 and momentum >= 0 else "Zayıflayan" if avg["3m"] >= 0 else
                    "Toparlanan" if momentum >= 0 else "Geride kalan")
        out.append({"sector": sec, "count": len(lst), **avg, "momentum": momentum, "quadrant": quadrant,
                    "best": max(lst, key=lambda x: x["1m"])["symbol"]})
    out.sort(key=lambda x: -x["1m"])
    return {"market": market_key, "sectors": out}


# ----------------------------------------------------------------------------- geçmişe yolculuk
def time_travel(symbol: str, start: str, amount: float) -> dict:
    symbol = symbol.upper()
    df = market.to_frame(market.history(symbol, "max", "1d"))
    c = df["close"]
    c.index = c.index.normalize()
    c = c[~c.index.duplicated(keep="last")]
    start_ts = pd.Timestamp(start)
    after = c[c.index >= start_ts]
    if after.empty:
        raise ValueError("Bu tarih için veri yok.")
    p0, d0 = float(after.iloc[0]), after.index[0]
    shares = amount / p0
    series = after * shares
    final = float(series.iloc[-1])
    years = max((series.index[-1] - d0).days / 365.25, 1 / 365)
    out = {"symbol": symbol, "name": market.NAME_BY_SYMBOL.get(symbol, symbol), "currency": market.currency_of(symbol),
           "start_date": d0.strftime("%Y-%m-%d"), "start_price": p0, "end_price": float(c.iloc[-1]), "shares": shares,
           "amount": amount, "final": final, "return_pct": (final / amount - 1) * 100, "cagr_pct": ((final / amount) ** (1 / years) - 1) * 100,
           "max_value": float(series.max()), "min_value": float(series.min()),
           "max_drawdown_pct": float((series / series.cummax() - 1).min() * 100), "years": years,
           "series": [{"time": int(t.timestamp()), "value": round(float(v), 2)} for t, v in series.iloc[:: max(1, len(series) // 600)].items()]}
    # Aynı tutar aynı tarihte alternatiflere yatırılsaydı (TL bazında)
    if out["currency"] == "TRY":
        alts = {}
        for alt, label in (("USDTRY=X", "Dolar"), ("GRAM-ALTIN", "Gram altın"), ("XU100.IS", "BIST 100")):
            if alt == symbol:
                continue
            try:
                a = market.to_frame(market.history(alt, "max", "1d"))["close"]
                a.index = a.index.normalize()
                a = a[a.index >= start_ts]
                if len(a):
                    alts[label] = amount * float(a.iloc[-1]) / float(a.iloc[0])
            except Exception:
                pass
        try:
            inf = inflation_between(d0)
            alts["Enflasyon (aynı alım gücü)"] = amount * (1 + inf / 100)
        except Exception:
            pass
        out["alternatives"] = alts
    return out
