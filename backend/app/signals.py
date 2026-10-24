"""Teknik sinyallerin sicili: bir sinyal (ör. "RSI 30'un altına indi") bu varlıkta geçmişte verildiğinde fiyat
sonraki 5 ve 20 işlem gününde ne yaptı? Sonuçlar, hiçbir sinyale bakmadan rastgele bir günde alınsaydı elde
edilecek "olağan" getiriyle karşılaştırılır; böylece sinyalin gerçekten işe yarayıp yaramadığı görülür."""
import threading
import time

import numpy as np
import pandas as pd
from fastapi import HTTPException

from . import indicators as ind
from . import market

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
TTL = 6 * 3600
HORIZONS = (5, 20)
COOLDOWN = 5  # aynı sinyalin art arda günlerde tekrar sayılmaması için


def _cross_up(a: pd.Series, b) -> pd.Series:
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    return (a > b) & (a.shift(1) <= b.shift(1))


def _cross_down(a: pd.Series, b) -> pd.Series:
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    return (a < b) & (a.shift(1) >= b.shift(1))


def _definitions(df: pd.DataFrame) -> list[tuple[str, str, str, pd.Series, str]]:
    """(anahtar, ad, yön, olay serisi, açıklama). yön: 'up' = yükseliş beklentisi, 'down' = düşüş beklentisi."""
    c = df["close"]
    r = ind.rsi(c)
    m, sig, _ = ind.macd(c)
    s50, s200 = ind.sma(c, 50), ind.sma(c, 200)
    up, _, low = ind.bollinger(c)
    hi20 = df["high"].rolling(20).max().shift(1)
    lo20 = df["low"].rolling(20).min().shift(1)
    vol = df["volume"].replace(0, np.nan)
    vspike = (vol > vol.rolling(20).mean() * 2) & (c > c.shift(1))
    return [
        ("rsi_oversold", "RSI 30'un altına indi", "up", _cross_down(r, 30), "Aşırı satım: düşüşün aşırıya kaçtığı, tepki yükselişi gelebileceği düşünülür."),
        ("rsi_overbought", "RSI 70'in üzerine çıktı", "down", _cross_up(r, 70), "Aşırı alım: yükselişin yorulduğu, düzeltme gelebileceği düşünülür."),
        ("macd_buy", "MACD al kesişimi", "up", _cross_up(m, sig), "MACD çizgisi sinyal çizgisini yukarı kesti: momentum yükselişe döndü."),
        ("macd_sell", "MACD sat kesişimi", "down", _cross_down(m, sig), "MACD çizgisi sinyal çizgisini aşağı kesti: momentum düşüşe döndü."),
        ("golden", "Altın kesişim (SMA50 > SMA200)", "up", _cross_up(s50, s200), "Kısa vadeli ortalama uzun vadeliyi yukarı kesti: uzun vadeli yükseliş trendi işareti."),
        ("death", "Ölüm kesişimi (SMA50 < SMA200)", "down", _cross_down(s50, s200), "Kısa vadeli ortalama uzun vadeliyi aşağı kesti: uzun vadeli düşüş trendi işareti."),
        ("bb_low", "Bollinger alt bandının altına indi", "up", _cross_down(c, low), "Fiyat istatistiksel olarak alışılmadık ölçüde düştü."),
        ("bb_high", "Bollinger üst bandının üstüne çıktı", "down", _cross_up(c, up), "Fiyat istatistiksel olarak alışılmadık ölçüde yükseldi."),
        ("breakout", "20 günlük zirveyi kırdı", "up", _cross_up(c, hi20), "Kırılım: fiyat son 20 günün en yükseğinin üzerine çıktı."),
        ("breakdown", "20 günlük dibi kırdı", "down", _cross_down(c, lo20), "Fiyat son 20 günün en düşüğünün altına indi."),
        ("volume", "Yüksek hacimli yükseliş", "up", vspike, "Hacim ortalamanın 2 katından fazlayken fiyat yükseldi."),
    ]


def _events(flags: pd.Series) -> list[int]:
    pos, last = [], -10 ** 9
    for i in np.flatnonzero(flags.fillna(False).to_numpy()):
        if i - last >= COOLDOWN:
            pos.append(int(i))
            last = i
    return pos


def track(symbol: str) -> dict:
    symbol = symbol.upper()
    with _lock:
        hit = _cache.get(symbol)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    df = market.to_frame(market.history(symbol, "5y", "1d"))
    df.index = market.local_days(df.index)
    df = df[~df.index.duplicated(keep="last")]
    if len(df) < 260:
        raise HTTPException(400, "Sinyal sicili için en az 1 yıllık fiyat geçmişi gerekir.")
    c = df["close"].to_numpy(dtype=float)
    n = len(c)
    fwd = {h: np.full(n, np.nan) for h in HORIZONS}
    for h in HORIZONS:
        fwd[h][:-h] = (c[h:] / c[:-h] - 1) * 100
    base = {h: {"avg": float(np.nanmean(fwd[h])), "up": float(np.nanmean(fwd[h] > 0) * 100)} for h in HORIZONS}

    out = []
    for key, name, direction, flags, desc in _definitions(df):
        pos = _events(flags)
        stats = {}
        for h in HORIZONS:
            vals = np.array([fwd[h][p] for p in pos if not np.isnan(fwd[h][p])])
            if len(vals):
                success = (vals > 0) if direction == "up" else (vals < 0)
                base_success = base[h]["up"] if direction == "up" else 100 - base[h]["up"]
                stats[str(h)] = {"avg": float(vals.mean()), "success": float(success.mean() * 100), "n": int(len(vals)),
                                 "edge": float(vals.mean() - base[h]["avg"]), "base_success": base_success}
        s20 = stats.get("20")
        if not s20 or s20["n"] < 5:
            verdict, grade = "Yeterli örnek yok", "none"
        else:
            edge = s20["edge"] if direction == "up" else -s20["edge"]
            lift = s20["success"] - s20["base_success"]
            if edge > 1 and lift > 5:
                verdict, grade = "Bu hissede işe yaramış", "good"
            elif edge < -1 and lift < -5:
                verdict, grade = "Bu hissede ters çalışmış", "bad"
            else:
                verdict, grade = "Belirgin bir etkisi yok", "neutral"
        last = pos[-1] if pos else None
        out.append({"key": key, "name": name, "direction": direction, "description": desc, "count": len(pos), "stats": stats,
                    "verdict": verdict, "grade": grade,
                    "last_date": df.index[last].strftime("%Y-%m-%d") if last is not None else None,
                    "active": last is not None and last >= n - 3,
                    "recent": [{"date": df.index[p].strftime("%Y-%m-%d"),
                                "r5": None if np.isnan(fwd[5][p]) else round(float(fwd[5][p]), 2),
                                "r20": None if np.isnan(fwd[20][p]) else round(float(fwd[20][p]), 2)} for p in pos[-6:][::-1]]})
    order = {"good": 0, "neutral": 1, "bad": 2, "none": 3}
    out.sort(key=lambda s: (not s["active"], order[s["grade"]], -s["count"]))
    res = {"symbol": symbol, "since": df.index[0].strftime("%Y-%m-%d"), "days": n, "baseline": base, "signals": out,
           "active": [s["name"] for s in out if s["active"]],
           "note": "Başarı: yükseliş sinyallerinde sonraki getirinin pozitif, düşüş sinyallerinde negatif olması. "
                   "“Olağan” değerler, sinyale bakmadan herhangi bir günde alınsaydı elde edilecek ortalamadır."}
    with _lock:
        _cache[symbol] = (time.time(), res)
    return res
