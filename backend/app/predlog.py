"""Tahmin günlüğü: YZ Tahmin'in verdiği her ertesi gün tahmini kaydedilir; hedef gün kapandıktan sonra gerçekleşen
fiyatla karşılaştırılıp doğru/yanlış işaretlenir. Böylece modellerin gerçek zamanlı (ileriye dönük) sicili oluşur.
Kullanıcı bir varlığı "her gün tahmin et" listesine eklerse tahmin, seans kapandıktan sonra otomatik üretilir."""
from datetime import date, datetime

import pandas as pd

from . import market
from .db import connect, rows

MAX_WATCH = 10


def init() -> None:
    with connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS prediction_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, symbol TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, data_date TEXT NOT NULL, target_date TEXT NOT NULL,
            model TEXT, up_prob REAL NOT NULL, expected_ret REAL, last_price REAL NOT NULL, auto INTEGER DEFAULT 0,
            actual_price REAL, actual_ret REAL, correct INTEGER, resolved_at TEXT,
            UNIQUE(user_id, symbol, target_date));
        CREATE TABLE IF NOT EXISTS prediction_watch (
            user_id INTEGER NOT NULL, symbol TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id, symbol));
        CREATE INDEX IF NOT EXISTS ix_prediction_log_open ON prediction_log(correct, target_date);
        """)


def record(uid: int, symbol: str, res: dict, auto: bool = False) -> None:
    f = res.get("forecast") or {}
    if not f.get("target_date"):
        return
    with connect() as con:
        con.execute("""INSERT INTO prediction_log (user_id, symbol, data_date, target_date, model, up_prob, expected_ret, last_price, auto)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(user_id, symbol, target_date) DO UPDATE SET data_date=excluded.data_date, model=excluded.model,
                       up_prob=excluded.up_prob, expected_ret=excluded.expected_ret, last_price=excluded.last_price,
                       created_at=CURRENT_TIMESTAMP WHERE prediction_log.correct IS NULL""",
                    (uid, symbol.upper(), f.get("data_date"), f["target_date"], res.get("best_model"), f["up_probability"],
                     f.get("expected_return_pct"), f["last_price"], int(auto)))


def resolve() -> int:
    """Hedef günü geçmiş (kapanışı kesinleşmiş) tahminleri sonuçlandırır."""
    today = date.today().isoformat()
    with connect() as con:
        pending = rows(con.execute("SELECT * FROM prediction_log WHERE correct IS NULL AND target_date < ?", (today,)))
    done = 0
    closes: dict[str, pd.Series] = {}
    for p in pending:
        sym = p["symbol"]
        try:
            if sym not in closes:
                closes[sym] = market.daily_closes(sym, "3mo")
            c = closes[sym]
        except Exception:
            continue
        day = pd.Timestamp(p["target_date"])
        if day not in c.index:
            later = c[c.index > day]
            if later.empty or (later.index[0] - day).days > 5:
                continue  # henüz veri yok
            day = later.index[0]  # tatil vb. nedeniyle işlem olmadıysa sonraki ilk işlem günü
        actual = float(c.loc[day])
        ret = (actual / p["last_price"] - 1) * 100
        correct = int((ret > 0) == (p["up_prob"] >= 50)) if abs(ret) > 1e-9 else int(p["up_prob"] < 50)
        with connect() as con:
            con.execute("UPDATE prediction_log SET actual_price=?, actual_ret=?, correct=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?",
                        (actual, ret, correct, p["id"]))
        done += 1
    return done


def journal(uid: int) -> dict:
    with connect() as con:
        items = rows(con.execute("SELECT * FROM prediction_log WHERE user_id=? ORDER BY target_date DESC, id DESC LIMIT 200", (uid,)))
        watch = [r["symbol"] for r in con.execute("SELECT symbol FROM prediction_watch WHERE user_id=? ORDER BY created_at", (uid,))]
    done = [i for i in items if i["correct"] is not None]
    hits = sum(i["correct"] for i in done)
    by_sym: dict[str, dict] = {}
    for i in done:
        b = by_sym.setdefault(i["symbol"], {"symbol": i["symbol"], "n": 0, "hits": 0})
        b["n"] += 1
        b["hits"] += i["correct"]
    for b in by_sym.values():
        b["accuracy"] = b["hits"] / b["n"] * 100
    confident = [i for i in done if i["up_prob"] >= 60 or i["up_prob"] <= 40]
    last30 = done[:30]
    streak = 0
    for i in done:
        if i["correct"]:
            streak += 1
        else:
            break
    return {"items": items, "watch": watch, "max_watch": MAX_WATCH,
            "stats": {"total": len(items), "resolved": len(done), "pending": len(items) - len(done), "hits": hits,
                      "accuracy": hits / len(done) * 100 if done else None,
                      "last30_accuracy": sum(i["correct"] for i in last30) / len(last30) * 100 if last30 else None,
                      "confident_accuracy": sum(i["correct"] for i in confident) / len(confident) * 100 if confident else None,
                      "confident_n": len(confident), "streak": streak},
            "by_symbol": sorted(by_sym.values(), key=lambda b: -b["n"])}


def set_watch(uid: int, symbol: str, on: bool) -> dict:
    from fastapi import HTTPException
    symbol = symbol.upper().strip()
    with connect() as con:
        if on:
            n = con.execute("SELECT COUNT(*) FROM prediction_watch WHERE user_id=?", (uid,)).fetchone()[0]
            if n >= MAX_WATCH:
                raise HTTPException(400, f"En fazla {MAX_WATCH} varlık otomatik tahmin listesine eklenebilir.")
            con.execute("INSERT OR IGNORE INTO prediction_watch (user_id, symbol) VALUES (?,?)", (uid, symbol))
        else:
            con.execute("DELETE FROM prediction_watch WHERE user_id=? AND symbol=?", (uid, symbol))
    return {"ok": True}


def auto_predict() -> None:
    """Otomatik tahmin listesindeki varlıklar için günde bir tahmin üretir (seans kapandıktan sonra)."""
    from . import ml
    now = datetime.now()
    with connect() as con:
        watch = rows(con.execute("SELECT user_id, symbol FROM prediction_watch"))
    cache: dict[str, dict] = {}
    for w in watch:
        sym = w["symbol"]
        m = market.market_of(sym)
        # Kapanış kesinleşmeden tahmin üretilmez (TR saati): BIST 19:00–09:00, ABD 01:00–12:00 arası; kripto/döviz her saat
        if m == "bist" and 9 <= now.hour < 19 or m == "us" and not 1 <= now.hour < 12:
            continue
        try:
            if sym not in cache:
                df = market.to_frame(market.history(sym, "2y", "1d"))
                target = ml._next_session(df)
                tday = (pd.Timestamp(target, unit="s") + pd.Timedelta(hours=12)).strftime("%Y-%m-%d")
                with connect() as con:
                    if con.execute("SELECT 1 FROM prediction_log WHERE user_id=? AND symbol=? AND target_date=?",
                                   (w["user_id"], sym, tday)).fetchone():
                        continue
                cache[sym] = ml.predict(df)
            record(w["user_id"], sym, cache[sym], auto=True)
        except Exception:
            continue
