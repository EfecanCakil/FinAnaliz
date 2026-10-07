"""Teknik analiz göstergeleri (SMA, EMA, RSI, MACD, Bollinger, ATR) ve sinyal özeti."""
import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    delta = s.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100)


def macd(s: pd.Series, fast=12, slow=26, signal=9):
    line = ema(s, fast) - ema(s, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def bollinger(s: pd.Series, n=20, k=2.0):
    mid = sma(s, n)
    std = s.rolling(n).std()
    return mid + k * std, mid, mid - k * std


def atr(df: pd.DataFrame, n=14) -> pd.Series:
    prev = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def _series(df: pd.DataFrame, s: pd.Series) -> list[dict]:
    return [{"time": int(t), "value": round(float(v), 6)} for t, v in zip(df["time"], s) if pd.notna(v)]


def compute_all(df: pd.DataFrame) -> dict:
    c = df["close"]
    m_line, m_sig, m_hist = macd(c)
    up, mid, low = bollinger(c)
    return {
        "sma20": _series(df, sma(c, 20)),
        "sma50": _series(df, sma(c, 50)),
        "sma200": _series(df, sma(c, 200)),
        "ema12": _series(df, ema(c, 12)),
        "ema26": _series(df, ema(c, 26)),
        "rsi": _series(df, rsi(c)),
        "macd": _series(df, m_line),
        "macd_signal": _series(df, m_sig),
        "macd_hist": _series(df, m_hist),
        "bb_upper": _series(df, up),
        "bb_mid": _series(df, mid),
        "bb_lower": _series(df, low),
    }


def summary(df: pd.DataFrame) -> dict:
    """Son değerlere göre göstergelerin yorumunu ve genel eğilimi döndürür."""
    c = df["close"]
    last = float(c.iloc[-1])
    signals = []

    def add(name, value, verdict, note):
        signals.append({"name": name, "value": None if value is None or pd.isna(value) else round(float(value), 4),
                        "signal": verdict, "note": note})

    r = rsi(c).iloc[-1]
    if r >= 70:
        add("RSI (14)", r, "sat", "Aşırı alım bölgesi (≥70)")
    elif r <= 30:
        add("RSI (14)", r, "al", "Aşırı satım bölgesi (≤30)")
    else:
        add("RSI (14)", r, "nötr", "Nötr bölge (30–70)")

    line, sig, _ = macd(c)
    add("MACD (12,26,9)", line.iloc[-1], "al" if line.iloc[-1] > sig.iloc[-1] else "sat",
        "MACD sinyal çizgisinin " + ("üzerinde" if line.iloc[-1] > sig.iloc[-1] else "altında"))

    for n in (20, 50, 200):
        if len(c) >= n:
            v = sma(c, n).iloc[-1]
            add(f"SMA {n}", v, "al" if last > v else "sat", "Fiyat ortalamanın " + ("üzerinde" if last > v else "altında"))

    if len(c) >= 20:
        up, mid, low = bollinger(c)
        if last > up.iloc[-1]:
            add("Bollinger (20,2)", mid.iloc[-1], "sat", "Fiyat üst bandın üzerinde")
        elif last < low.iloc[-1]:
            add("Bollinger (20,2)", mid.iloc[-1], "al", "Fiyat alt bandın altında")
        else:
            add("Bollinger (20,2)", mid.iloc[-1], "nötr", "Fiyat bantların içinde")

    score = sum(1 if s["signal"] == "al" else -1 if s["signal"] == "sat" else 0 for s in signals)
    ratio = score / max(len(signals), 1)
    overall = "Güçlü Al" if ratio >= 0.6 else "Al" if ratio > 0.15 else "Güçlü Sat" if ratio <= -0.6 else "Sat" if ratio < -0.15 else "Nötr"

    returns = c.pct_change().dropna()
    stats = {
        "last": last,
        "change_1d": float(c.iloc[-1] / c.iloc[-2] - 1) * 100 if len(c) > 1 else None,
        "change_1m": float(c.iloc[-1] / c.iloc[-22] - 1) * 100 if len(c) > 22 else None,
        "change_period": float(c.iloc[-1] / c.iloc[0] - 1) * 100,
        "high": float(df["high"].max()),
        "low": float(df["low"].min()),
        "volatility": float(returns.tail(30).std() * np.sqrt(252) * 100) if len(returns) > 5 else None,
        "atr": float(atr(df).iloc[-1]),
    }
    return {"signals": signals, "score": score, "overall": overall, "stats": stats}
