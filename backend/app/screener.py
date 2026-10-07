"""Teknik tarama (screener): piyasalardaki varlıklar için gösterge değerlerini hesaplar.

Filtreleme arayüzde yapılır; burada her varlık için karşılaştırılabilir bir
metrik satırı üretilir (RSI, ortalamalara uzaklık, kesişimler, hacim oranı,
bileşik teknik skor vb.).

Kapsam:
- "featured": öne çıkan varlıklar (tam OHLCV, hacim dahil)
- "all": Borsa İstanbul'daki tüm paylar ve S&P 500 (toplu çekilen 1 yıllık kapanışlardan);
  öne çıkan semboller için yine tam OHLCV kullanılır.
"""
import threading
import time

import numpy as np
import pandas as pd

from . import indicators as ind
from . import market, universe

CACHE_TTL = 60
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = threading.Lock()


def _crossed(fast: pd.Series, slow: pd.Series, days: int) -> tuple[bool, bool]:
    """Son `days` gün içinde hızlı serinin yavaşı yukarı (True, _) veya aşağı (_, True) kesip kesmediği."""
    diff = (fast - slow).dropna()
    if len(diff) < days + 1:
        return False, False
    recent = np.sign(diff.iloc[-(days + 1):].values)
    up = any(recent[i - 1] <= 0 < recent[i] for i in range(1, len(recent)))
    down = any(recent[i - 1] >= 0 > recent[i] for i in range(1, len(recent)))
    return up, down


def _signal(ratio: float) -> str:
    # indicators.summary ile aynı eşikler
    return "Güçlü Al" if ratio >= 0.6 else "Al" if ratio > 0.15 else "Güçlü Sat" if ratio <= -0.6 else "Sat" if ratio < -0.15 else "Nötr"


def _row(symbol: str, f: pd.DataFrame | None, info: dict | None = None) -> dict | None:
    if f is None or "Close" not in f:
        return None
    f = f[f["Close"].notna()]
    if len(f) < 60:
        return None
    c = f["Close"].astype(float)
    h = f["High"].astype(float).fillna(c) if "High" in f else c
    l = f["Low"].astype(float).fillna(c) if "Low" in f else c
    v = f["Volume"] if "Volume" in f else None
    has_volume = v is not None and float(v.fillna(0).tail(21).sum()) > 0
    last = float(c.iloc[-1])
    sma20, sma50, sma200 = ind.sma(c, 20), ind.sma(c, 50), ind.sma(c, 200)
    macd_line, macd_sig, macd_hist = ind.macd(c)
    up_b, _, low_b = ind.bollinger(c)
    rsi_s = ind.rsi(c)
    rsi = float(rsi_s.iloc[-1])
    golden, death = _crossed(sma50, sma200, 10) if len(c) >= 210 else (False, False)
    p200_up, p200_down = _crossed(c, sma200, 5) if len(c) >= 205 else (False, False)
    macd_up, macd_down = _crossed(macd_line, macd_sig, 3)
    info = info or market.ASSET_BY_SYMBOL.get(symbol) or universe.asset(symbol) or {}

    vol_ratio = None
    if has_volume:
        vv = v.fillna(0).astype(float)
        vol_avg = float(vv.tail(21).iloc[:-1].mean())
        if vol_avg > 0 and vv.iloc[-1] > 0:
            vol_ratio = float(vv.iloc[-1]) / vol_avg

    def dist(s):
        x = s.iloc[-1]
        return None if pd.isna(x) else (last / float(x) - 1) * 100

    def chg(n):
        return (last / float(c.iloc[-1 - n]) - 1) * 100 if len(c) > n else None

    s200 = sma200.iloc[-1]
    trend = "Yükseliş" if (not pd.isna(s200) and last > sma50.iloc[-1] > s200) else \
        "Düşüş" if (not pd.isna(s200) and last < sma50.iloc[-1] < s200) else "Yatay"

    # Bileşik teknik skor: Teknik Analiz sayfasındaki özetle aynı mantık (RSI, MACD, SMA20/50/200, Bollinger)
    votes = [1 if rsi <= 30 else -1 if rsi >= 70 else 0,
             1 if macd_line.iloc[-1] > macd_sig.iloc[-1] else -1]
    for s in (sma20, sma50, sma200):
        if not pd.isna(s.iloc[-1]):
            votes.append(1 if last > s.iloc[-1] else -1)
    if last > up_b.iloc[-1]:
        votes.append(-1)
    elif last < low_b.iloc[-1]:
        votes.append(1)
    else:
        votes.append(0)
    ratio = sum(votes) / len(votes)
    bb_range = float(up_b.iloc[-1] - low_b.iloc[-1])

    return {
        "symbol": symbol, "name": info.get("name", symbol), "market": market.market_of(symbol),
        "sector": info.get("sector") or "Diğer", "currency": market.currency_of(symbol),
        "featured": symbol in market.ASSET_BY_SYMBOL,
        "price": last, "change_pct": chg(1), "change_1w": chg(5), "change_1m": chg(21), "change_3m": chg(63),
        "rsi": round(rsi, 2), "rsi_prev": None if pd.isna(rsi_s.iloc[-2]) else round(float(rsi_s.iloc[-2]), 2),
        "dist_sma20": dist(sma20), "dist_sma50": dist(sma50), "dist_sma200": dist(sma200),
        "golden_cross": golden, "death_cross": death, "macd_cross_up": macd_up, "macd_cross_down": macd_down,
        "sma200_cross_up": p200_up, "sma200_cross_down": p200_down,
        "macd_above": bool(macd_line.iloc[-1] > macd_sig.iloc[-1]), "macd_hist": float(macd_hist.iloc[-1]),
        "bb_pct": (last - float(low_b.iloc[-1])) / bb_range * 100 if bb_range > 0 else None,
        "bb_width": bb_range / last * 100 if last else None,
        "vol_ratio": vol_ratio, "has_volume": has_volume,
        "dist_high_52w": (last / float(h.max()) - 1) * 100, "dist_low_52w": (last / float(l.min()) - 1) * 100,
        "volatility": float(c.pct_change().tail(30).std() * np.sqrt(252) * 100),
        "trend": trend, "score": round(ratio * 100), "signal": _signal(ratio),
        "last_date": str(c.index[-1].date()) if hasattr(c.index[-1], "date") else None,
    }


def _clean(r: dict) -> dict:
    out = {}
    for k, v in r.items():
        if isinstance(v, (float, np.floating)):
            v = None if not np.isfinite(v) else round(float(v), 4)
        elif isinstance(v, np.bool_):
            v = bool(v)
        out[k] = v
    return out


def _compute(markets: tuple[str, ...], scope: str) -> dict:
    featured = [a["symbol"] for m in markets for a in market.CATALOG.get(m, []) if not a.get("index")]
    frames = market.daily_frames(featured)
    rows, seen, fetched = [], set(), None
    for s in featured:
        try:
            r = _row(s, frames.get(s))
        except Exception:
            r = None
        if r:
            rows.append(_clean(r))
            seen.add(s)
    if scope == "all":
        for m in markets:
            if m not in universe.UNIVERSE:
                continue
            series, at = universe.closes(m)
            fetched = max(fetched or 0, at or 0) or None
            for a in universe.UNIVERSE[m]:
                s = a["symbol"]
                if s in seen or s not in series:
                    continue
                try:
                    r = _row(s, pd.DataFrame({"Close": series[s]}), a)
                except Exception:
                    r = None
                if r:
                    rows.append(_clean(r))
                    seen.add(s)
    every = set(featured)
    if scope == "all":
        every |= {a["symbol"] for m in markets for a in universe.UNIVERSE.get(m, [])}
    total = len(every)
    return {"rows": rows, "scanned": len(rows), "universe": total, "computed_at": time.time(), "data_at": fetched}


def scan_full(markets: list[str], scope: str = "featured", force: bool = False) -> dict:
    key = (tuple(sorted(set(markets))), scope)
    with _lock:
        hit = _cache.get(key)
    if hit and not force and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    if force:
        market.invalidate([a["symbol"] for m in key[0] for a in market.CATALOG.get(m, [])])
        for m in key[0]:
            if scope == "all" and m in universe.UNIVERSE:
                universe.refresh_async(m)
    res = _compute(key[0], scope)
    with _lock:
        _cache[key] = (time.time(), res)
    return res


def scan(markets: list[str], scope: str = "featured") -> list[dict]:
    return scan_full(markets, scope)["rows"]
