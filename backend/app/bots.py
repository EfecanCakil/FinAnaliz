"""Otomatik strateji botları: strateji testindeki kurallar sanal hesapta canlı uygulanır.

Bot her kontrolde (dakikada bir) günlük verilerle stratejinin güncel sinyalini hesaplar:
sinyal "pozisyonda ol" ise ve bot pozisyonda değilse, belirlenen TL tutarı kadar alır;
sinyal "pozisyondan çık" ise ve bot pozisyondaysa, botun aldığı adedi satar.
Aynı gün içinde bir bot en fazla bir işlem yapar.
"""
import json
from datetime import date

from fastapi import HTTPException

from . import account, backtest, market, notifications, portfolio
from .db import connect, rows


def create(uid: int, b: dict) -> dict:
    if b["strategy"] not in backtest.STRATEGIES or b["strategy"] == "buy_hold":
        raise HTTPException(400, "Bu strateji bot olarak çalıştırılamaz.")
    with connect() as con:
        cur = con.execute("INSERT INTO bots (user_id, symbol, strategy, params, amount_try, active) VALUES (?,?,?,?,?,1)",
                          (uid, b["symbol"].upper(), b["strategy"], json.dumps(b.get("params") or {}), b["amount_try"]))
    return {"id": cur.lastrowid}


def list_bots(uid: int) -> list[dict]:
    with connect() as con:
        items = rows(con.execute("SELECT * FROM bots WHERE user_id=? ORDER BY id DESC", (uid,)))
    for b in items:
        b["params"] = json.loads(b["params"] or "{}")
        b["strategy_name"] = backtest.STRATEGIES.get(b["strategy"], b["strategy"])
        with connect() as con:
            b["trades"] = rows(con.execute("SELECT id, side, quantity, price, date, amount_try FROM transactions "
                                           "WHERE user_id=? AND note LIKE ? ORDER BY id DESC LIMIT 20", (uid, f"Bot #{b['id']}%")))
    return items


def set_active(uid: int, bid: int, active: bool) -> None:
    with connect() as con:
        con.execute("UPDATE bots SET active=? WHERE id=? AND user_id=?", (int(active), bid, uid))


def delete(uid: int, bid: int) -> None:
    with connect() as con:
        con.execute("DELETE FROM bots WHERE id=? AND user_id=?", (bid, uid))


def signal(symbol: str, strategy: str, params: dict) -> int:
    df = market.to_frame(market.history(symbol, "1y", "1d"))
    return int(backtest._positions(df, strategy, params).iloc[-1])


def check(uid: int | None = None) -> list[dict]:
    with connect() as con:
        sql = "SELECT * FROM bots WHERE active=1" + (" AND user_id=?" if uid is not None else "")
        bots = rows(con.execute(sql, (uid,) if uid is not None else ()))
    today = date.today().isoformat()
    actions = []
    for b in bots:
        if b["last_action_date"] == today:
            continue
        try:
            sig = signal(b["symbol"], b["strategy"], json.loads(b["params"] or "{}"))
        except Exception:
            continue
        in_pos = b["position_qty"] > 1e-9
        side = "buy" if sig == 1 and not in_pos else "sell" if sig == 0 and in_pos else None
        if not side:
            continue
        q = market.quotes([b["symbol"]])[0]
        price = q["price"]
        if not price:
            continue
        if side == "buy":
            rate = account.fx_to_try(b["symbol"])
            qty = b["amount_try"] / rate / price
            if not any(b["symbol"].endswith(x) for x in ("-USD", "=X", "=F")) and not b["symbol"].startswith("GRAM-"):
                qty = int(qty)
        else:
            qty = min(b["position_qty"], portfolio.holding(b["user_id"], b["symbol"]))
        try:
            if qty <= 0:
                raise HTTPException(400, "Tutar bir adet almaya yetmiyor.")
            portfolio.add_transaction(b["user_id"], {"symbol": b["symbol"], "side": side, "quantity": qty, "price": price,
                                                     "date": today, "fee": 0, "note": f"Bot #{b['id']} ({b['strategy']})"})
            new_pos = b["position_qty"] + qty if side == "buy" else b["position_qty"] - qty
            with connect() as con:
                con.execute("UPDATE bots SET position_qty=?, last_action_date=?, last_message=? WHERE id=?",
                            (new_pos, today, f"{'Alış' if side == 'buy' else 'Satış'}: {qty:g} @ {price:.4g}", b["id"]))
            notifications.add(b["user_id"], "bot", f"Bot #{b['id']} {'aldı' if side == 'buy' else 'sattı'}: {b['symbol'].replace('.IS', '')}",
                              f"{qty:g} adet @ {price:.4g} · {backtest.STRATEGIES[b['strategy']]}", "/botlar")
            actions.append({"bot": b["id"], "side": side, "qty": qty})
        except HTTPException as e:
            with connect() as con:
                con.execute("UPDATE bots SET last_action_date=?, last_message=? WHERE id=?", (today, f"İşlem yapılamadı: {e.detail}", b["id"]))
            notifications.add(b["user_id"], "bot", f"Bot #{b['id']} işlem yapamadı", str(e.detail), "/botlar")
    return actions
