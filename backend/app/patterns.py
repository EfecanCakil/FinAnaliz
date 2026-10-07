"""Mum formasyonları, destek/direnç seviyeleri ve çoklu zaman dilimi özeti."""
import numpy as np
import pandas as pd

from . import indicators as ind
from . import market

PATTERNS = {
    "doji": ("Doji", "nötr", "Açılış ve kapanış neredeyse aynı; kararsızlık"),
    "hammer": ("Çekiç", "yükseliş", "Uzun alt gölge, düşüş sonrası dönüş sinyali"),
    "shooting_star": ("Kayan Yıldız", "düşüş", "Uzun üst gölge, yükseliş sonrası dönüş sinyali"),
    "bull_engulfing": ("Yutan Boğa", "yükseliş", "Yeşil mum önceki kırmızı mumu tamamen yutuyor"),
    "bear_engulfing": ("Yutan Ayı", "düşüş", "Kırmızı mum önceki yeşil mumu tamamen yutuyor"),
    "morning_star": ("Sabah Yıldızı", "yükseliş", "Üç mumluk dipten dönüş formasyonu"),
    "evening_star": ("Akşam Yıldızı", "düşüş", "Üç mumluk tepeden dönüş formasyonu"),
    "three_soldiers": ("Üç Beyaz Asker", "yükseliş", "Art arda üç güçlü yeşil mum"),
    "three_crows": ("Üç Kara Karga", "düşüş", "Art arda üç güçlü kırmızı mum"),
}


def candle_patterns(df: pd.DataFrame, lookback: int = 120) -> list[dict]:
    o, h, l, c = (df[k].values for k in ("open", "high", "low", "close"))
    t = df["time"].values
    n = len(df)
    body = np.abs(c - o)
    rng = np.maximum(h - l, 1e-12)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - l
    avg_body = pd.Series(body).rolling(14, min_periods=5).mean().values
    trend = pd.Series(c).pct_change(5).values  # kısa vadeli eğilim (önceki 5 gün)
    out = []

    def add(i, key):
        name, direction, desc = PATTERNS[key]
        out.append({"time": int(t[i]), "key": key, "name": name, "direction": direction, "description": desc,
                    "price": float(c[i])})

    for i in range(max(3, n - lookback), n):
        ab = avg_body[i] if not np.isnan(avg_body[i]) else body[i]
        prev_trend = trend[i - 1] if not np.isnan(trend[i - 1]) else 0
        green, red = c[i] > o[i], c[i] < o[i]
        if i >= 2 and c[i - 2] < o[i - 2] and body[i - 2] > ab and body[i - 1] < ab * 0.5 \
                and green and body[i] > ab and c[i] > (o[i - 2] + c[i - 2]) / 2:
            add(i, "morning_star")
            continue
        if i >= 2 and c[i - 2] > o[i - 2] and body[i - 2] > ab and body[i - 1] < ab * 0.5 \
                and red and body[i] > ab and c[i] < (o[i - 2] + c[i - 2]) / 2:
            add(i, "evening_star")
            continue
        if i >= 2 and all(c[j] > o[j] and body[j] > ab * 0.8 and c[j] > c[j - 1] for j in (i - 2, i - 1, i)) \
                and all(upper[j] < body[j] * 0.4 for j in (i - 2, i - 1, i)):
            add(i, "three_soldiers")
            continue
        if i >= 2 and all(c[j] < o[j] and body[j] > ab * 0.8 and c[j] < c[j - 1] for j in (i - 2, i - 1, i)) \
                and all(lower[j] < body[j] * 0.4 for j in (i - 2, i - 1, i)):
            add(i, "three_crows")
            continue
        if green and c[i - 1] < o[i - 1] and o[i] <= c[i - 1] and c[i] >= o[i - 1] and body[i] > body[i - 1] * 1.1:
            add(i, "bull_engulfing")
            continue
        if red and c[i - 1] > o[i - 1] and o[i] >= c[i - 1] and c[i] <= o[i - 1] and body[i] > body[i - 1] * 1.1:
            add(i, "bear_engulfing")
            continue
        if body[i] > 0 and lower[i] >= 2 * body[i] and upper[i] <= body[i] * 0.6 and prev_trend < -0.02:
            add(i, "hammer")
            continue
        if body[i] > 0 and upper[i] >= 2 * body[i] and lower[i] <= body[i] * 0.6 and prev_trend > 0.02:
            add(i, "shooting_star")
            continue
        if body[i] <= rng[i] * 0.08 and rng[i] > ab * 0.8:
            add(i, "doji")
    return out


def support_resistance(df: pd.DataFrame, window: int = 5, max_levels: int = 3) -> list[dict]:
    """Yerel tepe/diplerden kümelenmiş yatay seviyeler; son fiyata en yakın destek ve dirençler döndürülür."""
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    last = float(c[-1])
    pivots = []
    for i in range(window, len(df) - window):
        if h[i] == h[i - window: i + window + 1].max():
            pivots.append(h[i])
        if l[i] == l[i - window: i + window + 1].min():
            pivots.append(l[i])
    if not pivots:
        return []
    tol = float(ind.atr(df).iloc[-1]) * 0.6 or last * 0.01
    clusters: list[list[float]] = []
    for p in sorted(pivots):
        if clusters and p - np.mean(clusters[-1]) <= tol:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    levels = [{"price": float(np.mean(cl)), "touches": len(cl)} for cl in clusters if len(cl) >= 2]
    supports = sorted([x for x in levels if x["price"] < last], key=lambda x: -x["price"])[:max_levels]
    resist = sorted([x for x in levels if x["price"] >= last], key=lambda x: x["price"])[:max_levels]
    return [{**x, "type": "destek", "distance_pct": (x["price"] / last - 1) * 100} for x in supports] + \
           [{**x, "type": "direnç", "distance_pct": (x["price"] / last - 1) * 100} for x in resist]


TIMEFRAMES = [
    ("Saatlik", "1mo", "1h"),
    ("Günlük", "1y", "1d"),
    ("Haftalık", "5y", "1wk"),
    ("Aylık", "max", "1mo"),
]


def multi_timeframe(symbol: str) -> list[dict]:
    out = []
    for label, period, interval in TIMEFRAMES:
        try:
            df = market.to_frame(market.history(symbol, period, interval))
            if len(df) < 30:
                raise ValueError("yetersiz veri")
            s = ind.summary(df)
            c = df["close"]
            sig = {x["name"].split(" ")[0]: x["signal"] for x in s["signals"]}
            out.append({
                "timeframe": label, "overall": s["overall"], "score": s["score"], "count": len(s["signals"]),
                "rsi": round(float(ind.rsi(c).iloc[-1]), 1), "macd": sig.get("MACD"),
                "trend": "Yükseliş" if c.iloc[-1] > ind.sma(c, 20).iloc[-1] > ind.sma(c, 50).iloc[-1] else
                         "Düşüş" if c.iloc[-1] < ind.sma(c, 20).iloc[-1] < ind.sma(c, 50).iloc[-1] else "Yatay",
                "change_pct": float(c.iloc[-1] / c.iloc[-2] - 1) * 100,
            })
        except Exception as e:  # noqa: BLE001
            out.append({"timeframe": label, "error": str(e)})
    return out
