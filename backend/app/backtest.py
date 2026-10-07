"""Geçmiş veriler üzerinde basit (yalnızca alım yönlü) strateji testi."""
import numpy as np
import pandas as pd

from . import indicators as ind

STRATEGIES = {
    "sma_cross": "Hareketli Ortalama Kesişimi (SMA hızlı/yavaş)",
    "rsi": "RSI Aşırı Alım/Satım",
    "macd": "MACD Sinyal Kesişimi",
    "bollinger": "Bollinger Bandı Geri Dönüş",
    "buy_hold": "Al ve Tut",
}


def _positions(df: pd.DataFrame, strategy: str, p: dict) -> pd.Series:
    c = df["close"]
    if strategy == "sma_cross":
        fast, slow = int(p.get("fast", 20)), int(p.get("slow", 50))
        return (ind.sma(c, fast) > ind.sma(c, slow)).astype(int)
    if strategy == "macd":
        line, sig, _ = ind.macd(c)
        return (line > sig).astype(int)
    if strategy in ("rsi", "bollinger"):
        if strategy == "rsi":
            r = ind.rsi(c, int(p.get("period", 14)))
            buy, sell = r < float(p.get("lower", 30)), r > float(p.get("upper", 70))
        else:
            up, mid, low = ind.bollinger(c, int(p.get("period", 20)))
            buy, sell = c < low, c > mid
        pos, state = [], 0
        for b, s in zip(buy, sell):
            if state == 0 and b:
                state = 1
            elif state == 1 and s:
                state = 0
            pos.append(state)
        return pd.Series(pos, index=df.index)
    return pd.Series(1, index=df.index)


def run(df: pd.DataFrame, strategy: str, params: dict, capital: float = 10000, commission_pct: float = 0.1) -> dict:
    if strategy not in STRATEGIES:
        raise ValueError("Bilinmeyen strateji.")
    c = df["close"]
    # Sinyal gün sonunda oluşur, pozisyon ertesi gün açılır (ileriye bakma hatasını önler)
    pos = _positions(df, strategy, params).shift(1).fillna(0)
    ret = c.pct_change().fillna(0)
    trades_flag = pos.diff().abs().fillna(pos.iloc[0])
    strat_ret = pos * ret - trades_flag * commission_pct / 100
    equity = capital * (1 + strat_ret).cumprod()
    bench = capital * (1 + ret).cumprod()

    trades, entry = [], None
    for t, prev, cur, price in zip(df["time"], pos.shift(1).fillna(0), pos, c.shift(1).bfill()):
        if prev == 0 and cur == 1:
            entry = (int(t), float(price))
        elif prev == 1 and cur == 0 and entry:
            trades.append({"entry_time": entry[0], "entry_price": entry[1], "exit_time": int(t),
                           "exit_price": float(price), "return_pct": (float(price) / entry[1] - 1) * 100})
            entry = None
    if entry:
        trades.append({"entry_time": entry[0], "entry_price": entry[1], "exit_time": None,
                       "exit_price": float(c.iloc[-1]), "return_pct": (float(c.iloc[-1]) / entry[1] - 1) * 100})

    days = max((df.index[-1] - df.index[0]).days, 1)
    total = equity.iloc[-1] / capital - 1
    dd = (equity / equity.cummax() - 1).min()
    std = strat_ret.std()
    wins = [t for t in trades if t["return_pct"] > 0]
    return {
        "strategy": STRATEGIES[strategy],
        "metrics": {
            "final_equity": round(float(equity.iloc[-1]), 2),
            "total_return_pct": round(float(total * 100), 2),
            "benchmark_return_pct": round(float((bench.iloc[-1] / capital - 1) * 100), 2),
            "cagr_pct": round(float(((1 + total) ** (365 / days) - 1) * 100), 2),
            "max_drawdown_pct": round(float(dd * 100), 2),
            "sharpe": round(float(strat_ret.mean() / std * np.sqrt(252)), 2) if std > 0 else 0.0,
            "trade_count": len(trades),
            "win_rate_pct": round(len(wins) / len(trades) * 100, 2) if trades else 0.0,
            "exposure_pct": round(float(pos.mean() * 100), 2),
        },
        "equity": [{"time": int(t), "value": round(float(v), 2)} for t, v in zip(df["time"], equity)],
        "benchmark": [{"time": int(t), "value": round(float(v), 2)} for t, v in zip(df["time"], bench)],
        "trades": trades[-100:],
    }
