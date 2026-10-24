"""Şirket araştırma araçları:
- digest: son bilançonun sade Türkçe 5 maddelik özeti,
- similar: fiyat hareketi, sektör, büyüklük ve temel oranlara göre benzer hisseler,
- events: temettü, bedelsiz/bölünme, bedelli ve halka arz sonrası hissenin geçmişte ortalama ne yaptığı.
Tümü kural tabanlıdır ve Yahoo Finance + SPK verisini kullanır; yatırım tavsiyesi değildir."""
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait as fut_wait

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from . import fundamentals, market, quant, universe, yahoo
from .db import connect

_lock = threading.Lock()
_split_cache: dict[str, tuple[float, pd.Series]] = {}
STMT_TTL = 12 * 3600


# ----------------------------------------------------------------------------- yardımcılar
def _big(v: float | None, ccy: str = "") -> str:
    if v is None:
        return "—"
    a = abs(v)
    s = f"{v / 1e9:,.1f} milyar" if a >= 1e9 else f"{v / 1e6:,.1f} milyon" if a >= 1e6 else f"{v:,.0f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} {ccy}".strip()


def _pct(v: float, digits: int = 0) -> str:
    return f"%{abs(v):.{digits}f}".replace(".", ",")


def _short(symbol: str) -> str:
    return symbol.replace(".IS", "")


def _statements(symbol: str) -> dict:
    return fundamentals.statements(symbol)


def _row(df: pd.DataFrame | None, names: list[str]) -> pd.Series:
    if df is None or df.empty:
        return pd.Series(dtype=float)
    for n in names:
        if n in df.index:
            s = pd.to_numeric(df.loc[n], errors="coerce").dropna()
            if len(s):
                s.index = pd.to_datetime(s.index)
                return s.sort_index()
    return pd.Series(dtype=float)


def _yoy(s: pd.Series) -> tuple[float, float, pd.Timestamp] | None:
    """Son değer ve bir yıl önceki aynı dönemin değeri."""
    if len(s) < 2:
        return None
    d = s.index[-1]
    prev = s[(s.index >= d - pd.Timedelta(days=380)) & (s.index <= d - pd.Timedelta(days=350))]
    if prev.empty:
        return None
    return float(s.iloc[-1]), float(prev.iloc[-1]), d


def _quarter(d: pd.Timestamp) -> str:
    return f"{d.year} {(d.month - 1) // 3 + 1}. çeyrek"


def _growth(now: float, prev: float) -> float | None:
    return (now / prev - 1) * 100 if prev and prev > 0 and now is not None else None


# ----------------------------------------------------------------------------- bilanço özeti
def digest(symbol: str) -> dict:
    symbol = symbol.upper()
    if market.market_of(symbol) not in ("bist", "us"):
        raise HTTPException(400, "Bilanço özeti yalnızca hisse senetleri için hazırlanabilir.")
    summ = fundamentals.summary(symbol, with_statements=False)
    r = summ["ratios"]
    st = _statements(symbol)
    ccy = summ.get("financial_currency") or summ["currency"]
    is_bank = "bank" in (summ.get("industry") or "").lower() or "Bank" in (summ.get("sector") or "")
    infl = None
    if market.currency_of(symbol) == "TRY" and ccy == "TRY":
        try:
            infl = float(quant.cpi()["yearly"].iloc[-1])
        except Exception:
            infl = None

    points: list[dict] = []
    period = None

    def add(key, icon, title, text, tone):
        points.append({"key": key, "icon": icon, "title": title, "text": text, "tone": tone})

    # 1) Satışlar
    rev = _row(st.get("inc"), ["Total Revenue", "Operating Revenue"])
    y = _yoy(rev)
    label = "Son çeyrekte"
    if not y:
        y = _yoy(_row(st.get("ainc"), ["Total Revenue", "Operating Revenue"]))
        label = "Son yılda"
    if y:
        now, prev, d = y
        period = period or (_quarter(d) if label == "Son çeyrekte" else str(d.year))
        g = _growth(now, prev)
        if g is not None:
            text = f"{label} satışlar geçen yılın aynı dönemine göre {_pct(g)} {'arttı' if g >= 0 else 'azaldı'} ({_big(now, ccy)})."
            tone = "good" if g >= 10 else "bad" if g < 0 else "neutral"
            if infl is not None and g >= 0:
                if g < infl:
                    text += f" Ancak yıllık enflasyon {_pct(infl)} olduğundan reel olarak küçülme olabilir."
                    tone = "neutral" if g > infl * 0.7 else "bad"
                elif g > infl + 10:
                    text += f" Bu artış yıllık enflasyonun ({_pct(infl)}) de üzerinde."
                    tone = "good"
            add("sales", "🛒", "Satışlar", text, tone)

    # 2) Kâr ve marj
    net = _row(st.get("inc"), ["Net Income", "Net Income Common Stockholders"])
    y = _yoy(net)
    if not y:
        y = _yoy(_row(st.get("ainc"), ["Net Income", "Net Income Common Stockholders"]))
    if y:
        now, prev, d = y
        if now > 0 and prev > 0:
            g = _growth(now, prev)
            text = f"Net kâr {_big(now, ccy)}; geçen yılın aynı dönemine göre {_pct(g)} {'arttı' if g >= 0 else 'azaldı'}."
            tone = "good" if g >= 15 else "bad" if g < -10 else "neutral"
        elif now > 0 >= prev:
            text, tone = f"Şirket zarardan kâra geçti: net kâr {_big(now, ccy)} (geçen yıl {_big(prev, ccy)} zarar).", "good"
        elif now <= 0 < prev:
            text, tone = f"Şirket kârdan zarara geçti: net zarar {_big(abs(now), ccy)} (geçen yıl {_big(prev, ccy)} kâr).", "bad"
        else:
            text, tone = f"Zarar sürüyor: net zarar {_big(abs(now), ccy)} (geçen yıl {_big(abs(prev), ccy)}).", "bad"
        rv = _row(st.get("inc"), ["Total Revenue", "Operating Revenue"])
        if d in rv.index and rv[d] > 0:
            m_now = now / rv[d] * 100
            pm = rv[(rv.index >= d - pd.Timedelta(days=380)) & (rv.index <= d - pd.Timedelta(days=350))]
            pn = net[(net.index >= d - pd.Timedelta(days=380)) & (net.index <= d - pd.Timedelta(days=350))]
            if len(pm) and len(pn) and pm.iloc[-1] > 0:
                m_prev = pn.iloc[-1] / pm.iloc[-1] * 100
                text += f" Net kâr marjı {_pct(m_now, 1)} (geçen yıl {_pct(m_prev, 1)})"
                text += " — kârlılık iyileşti." if m_now > m_prev + 1 else " — kârlılık geriledi." if m_now < m_prev - 1 else "."
        add("profit", "💰", "Kârlılık", text, tone)

    # 3) Borçluluk (bankalarda mevduat borç sayıldığından atlanır)
    if not is_bank:
        debt = _row(st.get("bal"), ["Total Debt"])
        eq = _row(st.get("bal"), ["Stockholders Equity", "Common Stock Equity"])
        cash = _row(st.get("bal"), ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
        if len(debt) and len(eq) and eq.iloc[-1] > 0:
            d_now, e_now = float(debt.iloc[-1]), float(eq.iloc[-1])
            c_now = float(cash.iloc[-1]) if len(cash) else 0.0
            de = d_now / e_now
            yd, ye = _yoy(debt), _yoy(eq)
            if c_now >= d_now:
                text, tone = f"Şirketin nakdi ({_big(c_now, ccy)}) toplam borcundan ({_big(d_now, ccy)}) fazla: net nakit pozisyonunda.", "good"
            else:
                text = f"Toplam borç {_big(d_now, ccy)}, borç/özkaynak oranı {de:.2f}".replace(".", ",")
                tone = "good" if de < 0.5 else "bad" if de > 1.5 else "neutral"
                if yd and ye:
                    gd, ge = _growth(yd[0], yd[1]), _growth(ye[0], ye[1])
                    if gd is not None and ge is not None:
                        text += f"; borç bir yılda {_pct(gd)} {'arttı' if gd >= 0 else 'azaldı'}, özkaynak {_pct(ge)} {'arttı' if ge >= 0 else 'azaldı'}"
                        if gd > ge + 15 and de > 0.8:
                            text += " — borç özkaynaktan hızlı büyüyor"
                            tone = "bad"
                        elif gd < ge - 10:
                            text += " — borç yükü hafifliyor"
                            tone = "good" if de < 1.5 else "neutral"
                text += "."
            add("debt", "🏦", "Borç durumu", text, tone)

    # 4) Nakit akışı (yoksa cari oran)
    fcf = _row(st.get("cf"), ["Free Cash Flow"])
    fcf_ttm = float(fcf.iloc[-4:].sum()) if len(fcf) >= 4 else None
    if fcf_ttm is None:
        afcf = _row(st.get("acf"), ["Free Cash Flow"])
        fcf_ttm = float(afcf.iloc[-1]) if len(afcf) else None
    if fcf_ttm is not None and not is_bank:
        if fcf_ttm > 0:
            add("cash", "💵", "Nakit üretimi", f"Faaliyetlerinden ve yatırımlarından sonra son 12 ayda {_big(fcf_ttm, ccy)} serbest nakit üretti.", "good")
        else:
            add("cash", "💵", "Nakit üretimi", f"Son 12 ayda serbest nakit akışı eksi ({_big(fcf_ttm, ccy)}): şirket büyüme ya da faaliyetleri için nakit tüketiyor.", "bad" if fcf_ttm < 0 else "neutral")
    elif r.get("current_ratio") is not None and not is_bank:
        cr = r["current_ratio"]
        add("cash", "💧", "Kısa vadeli ödeme gücü", f"Cari oran {cr:.2f}".replace(".", ",") + (": kısa vadeli borçlarını rahat karşılayabiliyor." if cr >= 1.5 else
            ": kısa vadeli borçlarını karşılamada sınırda." if cr >= 1 else ": dönen varlıkları kısa vadeli borçlarından az, dikkat."),
            "good" if cr >= 1.5 else "neutral" if cr >= 1 else "bad")

    # 5) Değerleme ve temettü
    pe, pb, dy = r.get("pe"), r.get("pb"), r.get("dividend_yield")
    if pe is not None or pb is not None:
        parts, tone = [], "neutral"
        if pe is not None:
            parts.append(f"F/K {pe:.1f}".replace(".", ","))
            tone = "good" if pe < 8 else "bad" if pe > 30 else "neutral"
        elif (r.get("eps") or 0) < 0:
            parts.append("son 12 ayda zarar ettiği için F/K hesaplanamıyor")
            tone = "bad"
        if pb is not None:
            parts.append(f"PD/DD {pb:.2f}".replace(".", ","))
        text = ", ".join(parts)
        text += (": kârına göre ucuz görünüyor." if tone == "good" else ": kârına göre pahalı fiyatlanıyor; piyasa yüksek büyüme bekliyor olabilir." if pe and pe > 30 else ".")
        if dy and dy >= 3:
            text += f" Son 12 ayda {_pct(dy, 1)} temettü verimi sağladı."
        add("valuation", "🏷️", "Değerleme", text, tone)

    if not points:
        raise HTTPException(404, "Bu şirket için özetlenecek finansal tablo verisi bulunamadı.")
    points = points[:5]
    good = sum(p["tone"] == "good" for p in points)
    bad = sum(p["tone"] == "bad" for p in points)
    if good >= bad + 2:
        verdict = {"tone": "good", "text": "Genel tablo olumlu: güçlü yönler zayıf yönlerden belirgin şekilde fazla."}
    elif bad >= good + 2:
        verdict = {"tone": "bad", "text": "Genel tablo zayıf: dikkat edilmesi gereken birden fazla nokta var."}
    else:
        verdict = {"tone": "neutral", "text": "Genel tablo karışık: güçlü ve zayıf yönler bir arada."}
    return {"symbol": symbol, "name": summ["name"], "period": period, "currency": ccy, "is_bank": is_bank,
            "points": points, "verdict": verdict, "good": good, "bad": bad}


# ----------------------------------------------------------------------------- benzer hisseler
def _closes_for(symbol: str) -> tuple[dict[str, pd.Series], dict[str, dict]]:
    m = market.market_of(symbol)
    if m in ("bist", "us"):
        series, _ = universe.closes(m)
        meta = {a["symbol"]: a for a in universe.UNIVERSE[m]}
        for a in market.CATALOG.get(m, []):
            if not a.get("index"):
                meta.setdefault(a["symbol"], {"symbol": a["symbol"], "name": a["name"], "sector": a.get("sector")})
    else:
        syms = [a["symbol"] for a in market.CATALOG.get(m, []) if not a.get("index")]
        frames = market.daily_frames(syms)
        series = {s: f["Close"].dropna() for s, f in frames.items() if f is not None and "Close" in f}
        meta = {a["symbol"]: {"symbol": a["symbol"], "name": a["name"], "sector": a.get("sector")} for a in market.CATALOG.get(m, [])}
    series = dict(series)
    if symbol not in series:
        try:
            c = market.to_frame(market.history(symbol, "1y", "1d"))["close"]
            series[symbol] = c
        except Exception:
            pass
    norm = {}
    for s, c in series.items():
        c = c.copy()
        c.index = market.local_days(c.index)
        norm[s] = c[~c.index.duplicated(keep="last")]
    return norm, meta


def similar(symbol: str, n: int = 8) -> dict:
    symbol = symbol.upper()
    series, meta = _closes_for(symbol)
    if symbol not in series:
        raise HTTPException(404, "Bu varlığın fiyat geçmişi bulunamadı.")
    prices = pd.DataFrame(series).sort_index().iloc[-130:]
    rets = prices.pct_change(fill_method=None).iloc[1:]
    target = rets[symbol]
    valid = rets.notna().sum() >= 60
    rets = rets.loc[:, valid]
    if symbol not in rets:
        raise HTTPException(400, "Benzerlik için yeterli fiyat geçmişi yok (en az 3 ay gerekir).")
    corr = rets.corrwith(target).drop(symbol, errors="ignore").dropna()

    def perf(s):
        c = prices[s].dropna()
        return float(c.iloc[-1] / c.iloc[0] - 1) * 100 if len(c) > 1 else None

    def vol(s):
        return float(rets[s].std() * math.sqrt(252) * 100)

    me = meta.get(symbol, {})
    my_sector, my_mcap = me.get("sector"), me.get("mcap")
    scored = []
    for s, c in corr.items():
        mt = meta.get(s, {})
        same_sec = bool(my_sector and mt.get("sector") == my_sector)
        size = None
        if my_mcap and mt.get("mcap"):
            size = max(0.0, 1 - abs(math.log10(mt["mcap"] / my_mcap)) / 2)
        score = 0.6 * max(float(c), 0) + 0.25 * same_sec + 0.15 * (size if size is not None else 0.4)
        scored.append((s, score, float(c), same_sec, size))
    scored.sort(key=lambda x: -x[1])
    top = scored[:n]

    syms = [symbol] + [t[0] for t in top]
    funds: dict[str, dict] = {}
    if market.market_of(symbol) in ("bist", "us"):
        ex = ThreadPoolExecutor(max_workers=3)
        futs = {ex.submit(fundamentals.summary, s, False): s for s in syms}
        # Liste hemen döner; yetişmeyen oranlar arka planda önbelleğe dolar ve arayüz kısa süre sonra tekrar ister
        done, _ = fut_wait(futs, timeout=2.5)
        for f in done:
            try:
                d = f.result()
                funds[futs[f]] = d["ratios"]
            except Exception:
                pass
        ex.shutdown(wait=False)
    my_f = funds.get(symbol, {})
    my_perf, my_vol = perf(symbol), vol(symbol)

    items = []
    for s, score, c, same_sec, size in top:
        mt = meta.get(s, {})
        fr = funds.get(s, {})
        reasons = [f"Fiyat hareketi {_pct(c * 100)} uyumlu" if c >= 0.3 else f"Fiyat hareketi zayıf uyumlu ({c:.2f})".replace(".", ",")]
        if same_sec:
            reasons.append(f"Aynı sektör ({my_sector})")
        if size is not None and size >= 0.75:
            reasons.append("Benzer büyüklükte")
        for key, label in (("pe", "F/K"), ("pb", "PD/DD")):
            a, b = my_f.get(key), fr.get(key)
            if a and b and a > 0 and b > 0 and abs(math.log(a / b)) < 0.25:
                reasons.append(f"{label} benzer ({b:.1f} / {a:.1f})".replace(".", ","))
        items.append({"symbol": s, "name": mt.get("name") or market.NAME_BY_SYMBOL.get(s, s), "sector": mt.get("sector"),
                      "score": round(score * 100), "corr": round(c, 3), "perf_6m": perf(s), "vol": vol(s),
                      "pe": fr.get("pe"), "pb": fr.get("pb"), "profit_margin": fr.get("profit_margin"),
                      "dividend_yield": fr.get("dividend_yield"), "reasons": reasons})
    return {"symbol": symbol, "name": me.get("name") or market.NAME_BY_SYMBOL.get(symbol, symbol), "sector": my_sector,
            "target": {"perf_6m": my_perf, "vol": my_vol, "pe": my_f.get("pe"), "pb": my_f.get("pb"),
                       "profit_margin": my_f.get("profit_margin"), "dividend_yield": my_f.get("dividend_yield")},
            "items": items, "universe": len(corr), "days": int(len(rets)),
            "pending": market.market_of(symbol) in ("bist", "us") and len(funds) < len(syms)}


# ----------------------------------------------------------------------------- olay etkisi
HORIZONS = [1, 5, 20, 60]
PATH_PRE, PATH_POST = 5, 20


def _splits(symbol: str) -> pd.Series:
    with _lock:
        hit = _split_cache.get(symbol)
    if hit and time.time() - hit[0] < STMT_TTL:
        return hit[1]
    try:
        with yahoo.slot():
            s = yf.Ticker(symbol).splits
        s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
        s = s[s > 1.01]
    except Exception:
        return hit[1] if hit else pd.Series(dtype=float)
    with _lock:
        _split_cache[symbol] = (time.time(), s)
    return s


def _rights_issues(symbol: str) -> list[tuple[pd.Timestamp, str]]:
    """SPK bültenlerinden bu şirkete ait bedelli sermaye artırımı onayları."""
    try:
        from . import ipo
        with connect() as con:
            rows = con.execute("SELECT date, company, bedelli, capital_current FROM spk_capital WHERE bedelli > 0").fetchall()
    except Exception:
        return []
    out = []
    for r in rows:
        try:
            if ipo.match_symbol(r["company"]) == symbol and r["date"]:
                pct = f" (%{r['bedelli'] / r['capital_current'] * 100:.0f})" if r["capital_current"] else ""
                out.append((pd.Timestamp(r["date"]), f"Bedelli sermaye artırımı SPK onayı{pct}"))
        except Exception:
            continue
    return out


def events(symbol: str) -> dict:
    symbol = symbol.upper()
    m = market.market_of(symbol)
    if m not in ("bist", "us"):
        raise HTTPException(400, "Olay etkisi analizi yalnızca hisse senetleri için yapılabilir.")
    px = market.to_frame(market.history(symbol, "max", "1d"))["close"]
    px.index = market.local_days(px.index)
    px = px[~px.index.duplicated(keep="last")].dropna()
    if len(px) < 30:
        raise HTTPException(404, "Bu hisse için yeterli fiyat geçmişi yok.")
    bench_sym = "XU100.IS" if m == "bist" else "^GSPC"
    try:
        b = market.to_frame(market.history(bench_sym, "max", "1d"))["close"]
        b.index = market.local_days(b.index)
        bench = b[~b.index.duplicated(keep="last")].reindex(px.index).ffill()
    except Exception:
        bench = None
    idx = px.index
    vals = px.values.astype(float)
    bvals = bench.values.astype(float) if bench is not None else None

    def measure(p: int, base_pos: int, add: float = 0.0) -> dict:
        base = vals[base_pos]
        res: dict = {}
        for h in HORIZONS:
            j = p + h - 1
            if j < len(vals) and base > 0:
                r = ((vals[j] + add) / base - 1) * 100
                res[f"r{h}"] = r
                if bvals is not None and not np.isnan(bvals[j]) and not np.isnan(bvals[base_pos]) and bvals[base_pos] > 0:
                    res[f"x{h}"] = r - (bvals[j] / bvals[base_pos] - 1) * 100
        path = []
        for k in range(-PATH_PRE, PATH_POST + 1):
            j = p + k
            if 0 <= j < len(vals) and base > 0:
                path.append(((vals[j] + (add if k >= 0 else 0)) / base - 1) * 100)
            else:
                path.append(None)
        res["path"] = path
        return res

    groups: dict[str, dict] = {}

    def record(kind: str, title: str, d: pd.Timestamp, detail: str, add: float = 0.0):
        p = int(idx.searchsorted(d))
        if p <= 0 or p >= len(idx) or (idx[p] - d).days > 7:
            return
        g = groups.setdefault(kind, {"kind": kind, "title": title, "events": []})
        g["events"].append({"date": idx[p].strftime("%Y-%m-%d"), "detail": detail, **measure(p, p - 1, add)})

    divs = fundamentals.dividends_series(symbol)
    for d, amt in divs.iloc[-40:].items():
        price = vals[max(0, int(idx.searchsorted(d)) - 1)]
        record("dividend", "Temettü (hak kullanım günü)", d,
               f"Hisse başı {amt:.4g} {market.currency_of(symbol)}".replace(".", ",")
               + (f" · verim %{amt / price * 100:.1f}".replace(".", ",") if price else ""), float(amt))
    for d, ratio in _splits(symbol).iloc[-20:].items():
        if m == "bist":
            record("split", "Bedelsiz sermaye artırımı", d, f"%{(ratio - 1) * 100:.0f} bedelsiz")
        else:
            record("split", "Hisse bölünmesi", d, f"1'e {ratio:g} bölünme")
    if m == "bist":
        for d, detail in _rights_issues(symbol):
            record("rights", "Bedelli sermaye artırımı (SPK onayı)", d, detail)

    # Halka arz: veri kaynağındaki ilk işlem günü (çok eski kayıtlar halka arz sayılmaz)
    first = idx[0]
    if first > pd.Timestamp("2003-01-01") and len(px) > 5:
        res = measure(1, 0) if len(vals) > 1 else {}
        r_ipo = {"date": first.strftime("%Y-%m-%d"), "detail": f"İlk kapanış {vals[0]:.4g} {market.currency_of(symbol)}".replace(".", ",")}
        for h in (5, 20, 60, 250):
            if h < len(vals):
                r_ipo[f"r{h}"] = (vals[h] / vals[0] - 1) * 100
        r_ipo["path"] = res.get("path")
        groups["ipo"] = {"kind": "ipo", "title": "Halka arz sonrası (ilk işlem gününden itibaren)", "events": [r_ipo], "ipo": True}

    out = []
    for g in groups.values():
        evs = g["events"]
        stats = {}
        keys = (5, 20, 60, 250) if g.get("ipo") else HORIZONS
        for h in keys:
            rs = [e[f"r{h}"] for e in evs if f"r{h}" in e]
            xs = [e[f"x{h}"] for e in evs if f"x{h}" in e]
            if rs:
                stats[str(h)] = {"avg": float(np.mean(rs)), "median": float(np.median(rs)), "hit": float(np.mean([x > 0 for x in rs]) * 100),
                                 "excess": float(np.mean(xs)) if xs else None, "n": len(rs)}
        paths = [e["path"] for e in evs if e.get("path") and not g.get("ipo")]
        avg_path = None
        if paths:
            arr = np.array([[np.nan if v is None else v for v in p] for p in paths], dtype=float)
            avg_path = [None if np.isnan(v) else round(float(v), 3) for v in np.nanmean(arr, axis=0)] if len(arr) else None
        g_out = {"kind": g["kind"], "title": g["title"], "count": len(evs), "stats": stats, "avg_path": avg_path,
                 "events": [{k: (round(float(v), 3) if isinstance(v, float) else v) for k, v in e.items() if k != "path"} for e in evs[::-1][:15]],
                 "insight": _event_insight(g["kind"], stats, len(evs))}
        out.append(g_out)
    order = {"dividend": 0, "split": 1, "rights": 2, "ipo": 3}
    out.sort(key=lambda g: order.get(g["kind"], 9))
    return {"symbol": symbol, "name": market.NAME_BY_SYMBOL.get(symbol) or (universe.asset(symbol) or {}).get("name", symbol),
            "benchmark": "BIST 100" if m == "bist" else "S&P 500", "path_from": -PATH_PRE, "groups": out,
            "since": idx[0].strftime("%Y-%m-%d")}


def _event_insight(kind: str, stats: dict, n: int) -> str:
    if not stats:
        return "Ölçüm için yeterli veri yok."
    if kind == "ipo":
        s20, s250 = stats.get("20"), stats.get("250")
        parts = []
        if s20:
            parts.append(f"ilk 20 işlem gününde {_pct(s20['avg'])} {'yükseldi' if s20['avg'] >= 0 else 'düştü'}")
        if s250:
            parts.append(f"ilk bir yılda {_pct(s250['avg'])} {'yükseldi' if s250['avg'] >= 0 else 'düştü'}")
        return ("Hisse ilk kapanışına göre " + " ve ".join(parts) + ".") if parts else "Ölçüm için yeterli veri yok."
    s1, s20 = stats.get("1"), stats.get("20")
    name = {"dividend": "temettü hak kullanım gününde", "split": "bedelsiz/bölünme gününde", "rights": "bedelli onayının ardından"}[kind]
    txt = f"Geçmişteki {n} olayda hisse {name}"
    if s1:
        txt += f" ortalama {_pct(s1['avg'], 1)} {'yükseldi' if s1['avg'] >= 0 else 'düştü'}"
        if kind == "dividend":
            txt += " (temettü dahil)"
    if s20:
        txt += f"; 20 işlem günü sonra ortalama getiri {'+' if s20['avg'] >= 0 else '−'}{_pct(s20['avg'], 1)}"
        txt += f" (pozitif sonuç oranı %{s20['hit']:.0f})"
        if s20.get("excess") is not None:
            txt += f", endekse göre {'+' if s20['excess'] >= 0 else '−'}%{abs(s20['excess']):.1f}".replace(".", ",")
    txt += "."
    if n < 4:
        txt += " Olay sayısı az olduğundan sonuç güvenilir bir genelleme değildir."
    return txt
