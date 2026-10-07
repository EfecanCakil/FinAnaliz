"""Bekleyen emirler: limit alış/satış, zarar durdur (stop-loss) ve kâr al (take-profit).

Emirler arka planda dakikada bir güncel fiyatla kontrol edilir; koşul gerçekleşince sanal hesapta
işlem yapılır ve bildirim gönderilir. Limit alış emirleri, gerçekleşene kadar tutarları kadar alım
gücünü bloke eder.
"""
from datetime import date, datetime

from fastapi import HTTPException

from . import account, market, notifications, portfolio
from .db import connect, rows

TYPES = {
    "limit_buy": ("Limit alış", "buy", "Fiyat bu seviyeye veya altına inince al"),
    "limit_sell": ("Limit satış", "sell", "Fiyat bu seviyeye veya üstüne çıkınca sat"),
    "stop_loss": ("Zarar durdur", "sell", "Fiyat bu seviyeye veya altına inince sat"),
    "take_profit": ("Kâr al", "sell", "Fiyat bu seviyeye veya üstüne çıkınca sat"),
}


def reserved_try(uid: int) -> float:
    """Açık limit alış emirlerinin bloke ettiği tutar (TL)."""
    with connect() as con:
        return float(con.execute("SELECT COALESCE(SUM(reserved_try),0) FROM orders WHERE user_id=? AND status='open' "
                                 "AND type='limit_buy'", (uid,)).fetchone()[0])


def create(uid: int, o: dict) -> dict:
    if o["type"] not in TYPES:
        raise HTTPException(400, "Bilinmeyen emir tipi.")
    symbol = o["symbol"].upper().strip()
    side = TYPES[o["type"]][1]
    reserved = 0.0
    if side == "buy":
        reserved = o["quantity"] * o["price"] * account.fx_to_try(symbol)
        bp = account.balances(uid)["buying_power"]  # açık limit alışların blokesi zaten düşülmüş
        if reserved > bp + 1e-6:
            raise HTTPException(400, f"Yetersiz alım gücü: emir tutarı {account.tl(reserved)}, kullanılabilir {account.tl(bp)}.")
    else:
        held = portfolio.holding(uid, symbol)
        if held <= 0:
            raise HTTPException(400, f"{symbol} portföyünüzde yok; satış emri verilemez.")
        if o["quantity"] > held + 1e-9:
            raise HTTPException(400, f"Elinizde yalnızca {held:g} adet var.")
    with connect() as con:
        cur = con.execute("INSERT INTO orders (user_id, symbol, type, quantity, price, expires, note, reserved_try) "
                          "VALUES (?,?,?,?,?,?,?,?)",
                          (uid, symbol, o["type"], o["quantity"], o["price"], o.get("expires"), o.get("note"), reserved))
    return {"id": cur.lastrowid}


def list_orders(uid: int) -> list[dict]:
    with connect() as con:
        items = rows(con.execute("SELECT * FROM orders WHERE user_id=? ORDER BY status='open' DESC, id DESC LIMIT 200", (uid,)))
    for i in items:
        i["type_name"] = TYPES.get(i["type"], (i["type"],))[0]
    return items


def cancel(uid: int, oid: int) -> None:
    with connect() as con:
        con.execute("UPDATE orders SET status='cancelled', closed_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='open'",
                    (oid, uid))


def _triggered(o: dict, price: float) -> bool:
    return {"limit_buy": price <= o["price"], "stop_loss": price <= o["price"],
            "limit_sell": price >= o["price"], "take_profit": price >= o["price"]}[o["type"]]


def check(uid: int | None = None) -> list[dict]:
    with connect() as con:
        sql = "SELECT * FROM orders WHERE status='open'" + (" AND user_id=?" if uid is not None else "")
        open_orders = rows(con.execute(sql, (uid,) if uid is not None else ()))
    if not open_orders:
        return []
    today = date.today().isoformat()
    quotes = {q["symbol"]: q for q in market.quotes(sorted({o["symbol"] for o in open_orders}))}
    done = []
    for o in open_orders:
        if o["expires"] and o["expires"] < today:
            with connect() as con:
                con.execute("UPDATE orders SET status='expired', closed_at=CURRENT_TIMESTAMP WHERE id=?", (o["id"],))
            notifications.add(o["user_id"], "order", f"Emrin süresi doldu: {o['symbol']}", f"{TYPES[o['type']][0]} @ {o['price']:g}", "/portfoy")
            continue
        price = quotes.get(o["symbol"], {}).get("price")
        if price is None or not _triggered(o, price):
            continue
        side = TYPES[o["type"]][1]
        # Limit emirler limit fiyattan ya da daha iyi fiyattan, stop/kâr al emirleri o anki piyasa fiyatından gerçekleşir
        fill = min(o["price"], price) if o["type"] == "limit_buy" else max(o["price"], price) if o["type"] == "limit_sell" else price
        qty = o["quantity"] if side == "buy" else min(o["quantity"], portfolio.holding(o["user_id"], o["symbol"]))
        try:
            if qty <= 0:
                raise HTTPException(400, "Elde yeterli adet kalmadı.")
            with connect() as con:  # alım gücü kontrolünde kendi blokesi sayılmasın
                con.execute("UPDATE orders SET reserved_try=0 WHERE id=?", (o["id"],))
            portfolio.add_transaction(o["user_id"], {"symbol": o["symbol"], "side": side, "quantity": qty, "price": fill,
                                                     "date": today, "fee": 0, "note": f"{TYPES[o['type']][0]} emri #{o['id']}"})
            status, msg = "filled", f"{qty:g} adet @ {fill:,.4g}"
        except HTTPException as e:
            status, msg = "rejected", e.detail
        with connect() as con:
            con.execute("UPDATE orders SET status=?, filled_price=?, closed_at=CURRENT_TIMESTAMP, result=? WHERE id=?",
                        (status, fill if status == "filled" else None, msg, o["id"]))
        title = f"{TYPES[o['type']][0]} {'gerçekleşti' if status == 'filled' else 'reddedildi'}: {o['symbol'].replace('.IS', '')}"
        notifications.add(o["user_id"], "order", title, msg, "/portfoy")
        done.append({**o, "status": status, "message": msg})
    return done
