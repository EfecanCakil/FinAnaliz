"""Düzenli alım planları: "her ayın 1'inde 2.000 TL'lik THYAO al" gibi tekrarlayan otomatik alımlar (sanal portföyde).
Plan günü geldiğinde, ilgili piyasa açıkken o anki fiyattan alım yapılır; uygulama kapalıysa ilk açılışta yapılır."""
import calendar
import math
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from fastapi import HTTPException

from . import account, market, notifications, portfolio
from .db import connect, rows

FREQS = {"monthly": "Her ay", "weekly": "Her hafta", "biweekly": "İki haftada bir"}
WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"]


def init() -> None:
    with connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS dca_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            symbol TEXT NOT NULL, amount REAL NOT NULL, freq TEXT NOT NULL, day INTEGER NOT NULL,
            next_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            runs INTEGER NOT NULL DEFAULT 0, last_run TEXT, last_result TEXT);
        """)


def _next(freq: str, day: int, after: date, first: bool = False) -> date:
    """'after' gününden sonraki (dahil değil) ilk plan günü. İki haftalık planlarda, bir alımdan sonra bir hafta atlanır."""
    if freq == "monthly":
        y, m = after.year, after.month
        for _ in range(3):
            d = date(y, m, min(day, calendar.monthrange(y, m)[1]))
            if d > after:
                return d
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    d = after + timedelta(days=1)
    while d.weekday() != day:
        d += timedelta(days=1)
    return d + timedelta(days=7) if freq == "biweekly" and not first else d


def _first(freq: str, day: int) -> date:
    return _next(freq, day, date.today() - timedelta(days=1), first=True)


def _market_open(symbol: str, now: datetime) -> bool:
    m = market.market_of(symbol)
    if m == "crypto":
        return True
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    if m == "bist":
        return 10 * 60 + 15 <= mins < 18 * 60
    if m == "us":
        return 16 * 60 + 45 <= mins < 22 * 60 + 50  # TR saatiyle (yaz/kış saati farkına karşı güvenli aralık)
    return 1 * 60 <= mins < 23 * 60


def _fmt_day(freq: str, day: int) -> str:
    return f"ayın {day}. günü" if freq == "monthly" else WEEKDAYS[day]


def create(uid: int, symbol: str, amount: float, freq: str, day: int) -> dict:
    symbol = symbol.upper().strip()
    if freq not in FREQS:
        raise HTTPException(400, "Geçersiz sıklık.")
    if freq == "monthly" and not 1 <= day <= 28:
        raise HTTPException(400, "Aylık planlarda gün 1 ile 28 arasında olmalı.")
    if freq != "monthly" and not 0 <= day <= 4:
        raise HTTPException(400, "Haftalık planlarda gün Pazartesi–Cuma arasında olmalı.")
    if not 10 <= amount <= 10_000_000:
        raise HTTPException(400, "Tutar 10 TL ile 10 milyon TL arasında olmalı.")
    q = market.quotes([symbol])[0]
    if not q.get("price"):
        raise HTTPException(404, f"{symbol} için fiyat bulunamadı.")
    with connect() as con:
        if con.execute("SELECT COUNT(*) FROM dca_plans WHERE user_id=?", (uid,)).fetchone()[0] >= 20:
            raise HTTPException(400, "En fazla 20 düzenli alım planı oluşturabilirsiniz.")
        cur = con.execute("INSERT INTO dca_plans (user_id, symbol, amount, freq, day, next_date) VALUES (?,?,?,?,?,?)",
                          (uid, symbol, amount, freq, day, _first(freq, day).isoformat()))
    return {"id": cur.lastrowid}


def toggle(uid: int, pid: int) -> dict:
    with connect() as con:
        row = con.execute("SELECT * FROM dca_plans WHERE id=? AND user_id=?", (pid, uid)).fetchone()
        if not row:
            raise HTTPException(404, "Plan bulunamadı.")
        active = 0 if row["active"] else 1
        nxt = row["next_date"] if not active or row["next_date"] >= date.today().isoformat() else _first(row["freq"], row["day"]).isoformat()
        con.execute("UPDATE dca_plans SET active=?, next_date=? WHERE id=?", (active, nxt, pid))
    return {"active": bool(active)}


def delete(uid: int, pid: int) -> None:
    with connect() as con:
        con.execute("DELETE FROM dca_plans WHERE id=? AND user_id=?", (pid, uid))


def _quantity(symbol: str, amount_try: float, price: float) -> float:
    unit = price * account.fx_to_try(symbol)
    qty = amount_try / unit
    if market.market_of(symbol) in ("crypto", "fx"):
        return math.floor(qty * 1e6) / 1e6
    return float(math.floor(qty))


def run_due(uid: int | None = None) -> list[dict]:
    """Günü gelmiş ve piyasası açık planları uygular (arka plan motoru dakikada bir çağırır)."""
    now = datetime.now()
    today = now.date().isoformat()
    with connect() as con:
        sql = "SELECT * FROM dca_plans WHERE active=1 AND next_date<=?" + (" AND user_id=?" if uid else "")
        due = rows(con.execute(sql, (today, uid) if uid else (today,)))
    if not due:
        return []
    due = [p for p in due if _market_open(p["symbol"], now)]
    quotes = {q["symbol"]: q for q in market.quotes(sorted({p["symbol"] for p in due}))} if due else {}
    out = []
    for p in due:
        sym = p["symbol"]
        price = quotes.get(sym, {}).get("price")
        nxt = _next(p["freq"], p["day"], now.date()).isoformat()
        name = sym.replace(".IS", "")
        if not price:
            continue  # fiyat yoksa bir sonraki dakikada tekrar denenir
        try:
            qty = _quantity(sym, p["amount"], price)
            if qty <= 0:
                raise HTTPException(400, f"{account.tl(p['amount'])} tutar 1 adet {name} almaya yetmiyor (fiyat {price:,.2f}).")
            portfolio.add_transaction(p["user_id"], {"symbol": sym, "side": "buy", "quantity": qty, "price": price, "fee": 0,
                                                     "note": f"Düzenli alım planı #{p['id']}"})
            result = f"{qty:g} adet @ {price:,.4g}"
            notifications.add(p["user_id"], "order", f"🔁 Düzenli alım yapıldı: {name}", f"{result} · sonraki alım {nxt}", "/portfoy?tab=dca")
            with connect() as con:
                con.execute("UPDATE dca_plans SET next_date=?, runs=runs+1, last_run=?, last_result=? WHERE id=?", (nxt, today, result, p["id"]))
        except HTTPException as e:
            result = f"Yapılamadı: {e.detail}"
            notifications.add(p["user_id"], "order", f"Düzenli alım yapılamadı: {name}", f"{e.detail} Sonraki deneme {nxt}.", "/portfoy?tab=dca")
            with connect() as con:
                con.execute("UPDATE dca_plans SET next_date=?, last_run=?, last_result=? WHERE id=?", (nxt, today, result, p["id"]))
        out.append({"plan": p["id"], "result": result})
    return out


def list_plans(uid: int) -> dict:
    with connect() as con:
        plans = rows(con.execute("SELECT * FROM dca_plans WHERE user_id=? ORDER BY active DESC, id", (uid,)))
        txs = rows(con.execute("SELECT id, symbol, quantity, price, date, note FROM transactions WHERE user_id=? AND note LIKE 'Düzenli alım planı #%' "
                               "ORDER BY COALESCE(date,''), id", (uid,)))
    syms = sorted({p["symbol"] for p in plans})
    quotes = {q["symbol"]: q for q in market.quotes(syms)} if syms else {}
    for p in plans:
        mine = [t for t in txs if t["note"] == f"Düzenli alım planı #{p['id']}"]
        qty = sum(t["quantity"] for t in mine)
        cost = sum(t["quantity"] * t["price"] for t in mine)
        price = quotes.get(p["symbol"], {}).get("price")
        avg, running, q_acc, c_acc = None, [], 0.0, 0.0
        for t in mine:
            q_acc += t["quantity"]
            c_acc += t["quantity"] * t["price"]
            running.append({"date": t["date"], "price": t["price"], "avg_cost": c_acc / q_acc, "quantity": t["quantity"]})
        if qty:
            avg = cost / qty
        p.update({"name": market.NAME_BY_SYMBOL.get(p["symbol"], p["symbol"]), "freq_label": FREQS[p["freq"]],
                  "day_label": _fmt_day(p["freq"], p["day"]), "currency": market.currency_of(p["symbol"]),
                  "quantity": qty, "cost": cost, "avg_cost": avg, "price": price,
                  "value": qty * price if price else None, "pnl_pct": (price / avg - 1) * 100 if price and avg else None,
                  "executions": running[::-1][:24]})
    return {"plans": plans, "freqs": FREQS, "weekdays": WEEKDAYS}


def simulate(symbol: str, amount: float, years: int = 3, freq: str = "monthly") -> dict:
    """Geçmişte bu plan uygulansaydı: düzenli alım ile aynı toplam parayı ilk gün tek seferde yatırmanın karşılaştırması."""
    symbol = symbol.upper()
    years = max(1, min(years, 10))
    c = market.daily_closes(symbol, "max" if years > 5 else "5y")
    if market.currency_of(symbol) != "TRY":
        usd = market.daily_closes("USDTRY=X", "max" if years > 5 else "5y")
        c = (c * usd.reindex(c.index).ffill()).dropna()
    start = c.index[-1] - pd.DateOffset(years=years)
    c = c[c.index >= start]
    if len(c) < 40:
        raise HTTPException(400, "Bu süre için yeterli fiyat geçmişi yok.")
    # Takvime göre: her ayın / haftanın ilk işlem günü (kripto gibi her gün işlem gören varlıklarda da doğru aralık)
    idx = pd.DatetimeIndex(c.index)
    key = idx.to_period("M") if freq == "monthly" else idx.to_period("W")
    first = ~pd.Series(key).duplicated().to_numpy()
    buys = [i for i in np.flatnonzero(first)]
    if freq == "biweekly":
        buys = buys[::2]
    units = sum(amount / float(c.iloc[i]) for i in buys)
    invested = amount * len(buys)
    lump_units = invested / float(c.iloc[0])
    last = float(c.iloc[-1])
    series, u, inv = [], 0.0, 0.0
    bset = set(buys)
    for i, (d, px) in enumerate(c.items()):
        if i in bset:
            u += amount / float(px)
            inv += amount
        if i % 3 == 0 or i == len(c) - 1:
            series.append({"time": int(pd.Timestamp(d).timestamp()), "value": round(u * float(px), 2), "invested": round(inv, 2),
                           "lump": round(lump_units * float(px), 2)})
    return {"symbol": symbol, "years": years, "buys": len(buys), "invested": invested, "dca_value": units * last,
            "dca_return": (units * last / invested - 1) * 100, "lump_value": lump_units * last,
            "lump_return": (lump_units * last / invested - 1) * 100, "avg_cost": invested / units, "last_price": last,
            "series": series, "rate_note": "Döviz cinsinden varlık TL'ye çevrilerek hesaplandı." if market.currency_of(symbol) != "TRY" else None}
