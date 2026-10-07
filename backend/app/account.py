"""Sanal yatırım hesabı: TL nakit bakiyesi, takas (T+n) ve alım gücü.

* Her kullanıcı 100.000 TL sanal bakiyeyle başlar (sıfırlanabilir, para yatırılıp çekilebilir).
* Alımlarda tutar (yabancı varlıklarda işlem tarihindeki kurla TL'ye çevrilerek) nakitten düşer;
  satışlarda nakite eklenir. Tutar, piyasanın takas süresi sonunda kesinleşir:
  Borsa İstanbul T+2, ABD hisseleri T+1, döviz/emtia/kripto T+0 (hafta sonları sayılmaz).
* T0: bugün kesinleşmiş nakit; T1: yarın; T2: iki iş günü sonra kesinleşecek bakiye.
  Alım gücü, Türkiye'deki aracı kurumlarda olduğu gibi T2 bakiyesidir; yetersizse alım yapılamaz.
* Bakiye kapsamı dışında kalan (eski sürümde girilmiş) işlemler nakdi etkilemez.
"""
from datetime import date, datetime, timedelta

import pandas as pd
from fastapi import HTTPException

from . import market
from .db import connect, rows

INITIAL_CASH = 100_000.0
SETTLEMENT_DAYS = {"bist": 2, "us": 1, "fx": 0, "crypto": 0}


def tl(v: float) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " TL"


def add_business_days(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def settle_date(symbol: str, trade_date: date) -> date:
    return add_business_days(trade_date, SETTLEMENT_DAYS.get(market.market_of(symbol), 0))


def ensure_account(uid: int) -> None:
    with connect() as con:
        if not con.execute("SELECT 1 FROM cash_movements WHERE user_id=? LIMIT 1", (uid,)).fetchone():
            today = date.today().isoformat()
            con.execute("INSERT INTO cash_movements (user_id, kind, amount, date, settle_date, note) VALUES (?,?,?,?,?,?)",
                        (uid, "deposit", INITIAL_CASH, today, today, "Başlangıç sanal bakiyesi"))
        legacy = rows(con.execute("SELECT * FROM transactions WHERE user_id=? AND funded=0", (uid,)))
    if legacy:
        _absorb_legacy(uid, legacy)


def _absorb_legacy(uid: int, legacy: list[dict]) -> None:
    """Sanal hesaptan önce girilmiş işlemleri hesaba katar: işlem tutarı kadar bir "aktarım" kaydı eklenir.
    Böylece nakit değişmez ama bu varlıkların maliyeti yatırılan tutara eklenir ve kâr/zarar doğru hesaplanır."""
    from .portfolio import FxRates

    default_day = (date.today() - timedelta(days=365)).isoformat()
    fx = FxRates({market.currency_of(t["symbol"]) for t in legacy})
    with connect() as con:
        for t in legacy:
            day = t["date"] or default_day
            rate = fx.at(market.currency_of(t["symbol"]), pd.Timestamp(day)) or 1.0
            gross, fee = t["quantity"] * t["price"] * rate, (t["fee"] or 0) * rate
            amount = -(gross + fee) if t["side"] == "buy" else gross - fee
            con.execute("UPDATE transactions SET funded=1, amount_try=?, settle_date=?, date=? WHERE id=?", (amount, day, day, t["id"]))
            con.execute("INSERT INTO cash_movements (user_id, kind, amount, date, settle_date, note) VALUES (?,?,?,?,?,?)",
                        (uid, "transfer", -amount, day, day, f"Önceki kayıttan aktarım: {t['symbol']} {t['quantity']:g} adet"))


def fx_to_try(symbol: str) -> float:
    cur = market.currency_of(symbol)
    if cur == "TRY":
        return 1.0
    pair = {"USD": "USDTRY=X", "EUR": "EURTRY=X", "JPY": "JPYTRY=X"}.get(cur)
    q = market.quotes([pair])[0] if pair else None
    if not q or not q["price"]:
        raise HTTPException(502, "Döviz kuru alınamadı; işlem tutarı TL'ye çevrilemedi.")
    return q["price"]


def _flows(uid: int) -> list[dict]:
    """Nakdi etkileyen tüm hareketler: para yatırma/çekme ve bakiyeli alım-satım işlemleri."""
    ensure_account(uid)
    with connect() as con:
        moves = rows(con.execute("SELECT kind, amount, date, settle_date, note FROM cash_movements WHERE user_id=?", (uid,)))
        txs = rows(con.execute("SELECT id, symbol, side, quantity, amount_try, date, settle_date FROM transactions "
                               "WHERE user_id=? AND funded=1", (uid,)))
    flows = [{"kind": m["kind"], "amount": m["amount"], "date": m["date"], "settle_date": m["settle_date"], "note": m["note"]}
             for m in moves]
    for t in txs:
        flows.append({"kind": t["side"], "amount": t["amount_try"], "date": t["date"], "settle_date": t["settle_date"],
                      "note": f"{t['symbol']} {t['quantity']:g} adet {'alış' if t['side'] == 'buy' else 'satış'}"})
    return flows


def balances(uid: int) -> dict:
    flows = _flows(uid)
    today = date.today()
    horizon = {"t0": today, "t1": add_business_days(today, 1), "t2": add_business_days(today, 2)}
    out = {k: sum(f["amount"] for f in flows if f["settle_date"] <= d.isoformat()) for k, d in horizon.items()}
    total = sum(f["amount"] for f in flows)
    deposits = sum(f["amount"] for f in flows if f["kind"] in ("deposit", "withdraw", "transfer"))
    pending = sorted([f for f in flows if f["settle_date"] > today.isoformat()], key=lambda f: f["settle_date"])
    with connect() as con:  # açık limit alış emirlerinin bloke ettiği tutar
        reserved = float(con.execute("SELECT COALESCE(SUM(reserved_try),0) FROM orders WHERE user_id=? AND status='open'",
                                     (uid,)).fetchone()[0])
    return {**out, "buying_power": min(out["t2"], total) - reserved, "reserved": reserved, "total_cash": total, "net_deposits": deposits,
            "pending": pending, "settle_dates": {k: d.isoformat() for k, d in horizon.items()}}


def prepare_trade(uid: int, tx: dict) -> dict:
    """İşlemin TL tutarını ve takas tarihini hesaplar, bakiye/adet kontrolü yapar."""
    symbol = tx["symbol"].upper().strip()
    trade_day = date.fromisoformat(tx["date"]) if tx.get("date") else date.today()
    rate = fx_to_try(symbol)
    gross = tx["quantity"] * tx["price"] * rate
    fee = (tx.get("fee") or 0) * rate
    if tx["side"] == "buy":
        amount = -(gross + fee)
        bal = balances(uid)
        if bal["buying_power"] <= 0:
            raise HTTPException(400, "Alım gücünüz sıfır; alım yapılamaz. Profil sayfasından hesabınıza sanal para ekleyebilirsiniz.")
        if -amount > bal["buying_power"] + 1e-6:
            raise HTTPException(400, f"Yetersiz bakiye: işlem tutarı {tl(-amount)}, alım gücünüz {tl(bal['buying_power'])}.")
    else:
        amount = gross - fee
    return {"symbol": symbol, "amount_try": amount, "settle_date": settle_date(symbol, trade_day).isoformat(),
            "date": trade_day.isoformat(), "funded": 1}


def deposit(uid: int, amount: float, note: str | None = None) -> None:
    ensure_account(uid)
    today = date.today().isoformat()
    with connect() as con:
        con.execute("INSERT INTO cash_movements (user_id, kind, amount, date, settle_date, note) VALUES (?,?,?,?,?,?)",
                    (uid, "deposit", amount, today, today, note or "Sanal para yatırma"))


def withdraw(uid: int, amount: float) -> None:
    bal = balances(uid)
    if amount > bal["t0"] + 1e-6:
        raise HTTPException(400, "Yalnızca takası tamamlanmış (T0) bakiye çekilebilir.")
    today = date.today().isoformat()
    with connect() as con:
        con.execute("INSERT INTO cash_movements (user_id, kind, amount, date, settle_date, note) VALUES (?,?,?,?,?,?)",
                    (uid, "withdraw", -amount, today, today, "Sanal para çekme"))


def reset(uid: int, initial: float = INITIAL_CASH) -> None:
    """Hesabı sıfırlar: tüm işlemler ve nakit hareketleri silinir, başlangıç bakiyesi yeniden yüklenir."""
    with connect() as con:
        con.execute("DELETE FROM transactions WHERE user_id=?", (uid,))
        con.execute("DELETE FROM cash_movements WHERE user_id=?", (uid,))
        today = date.today().isoformat()
        con.execute("INSERT INTO cash_movements (user_id, kind, amount, date, settle_date, note) VALUES (?,?,?,?,?,?)",
                    (uid, "deposit", initial, today, today, "Başlangıç sanal bakiyesi"))


def summary(uid: int, holdings_value_try: float) -> dict:
    bal = balances(uid)
    equity = bal["total_cash"] + holdings_value_try
    return {**bal, "holdings_value_try": holdings_value_try, "equity_try": equity,
            "total_pnl_try": equity - bal["net_deposits"],
            "total_pnl_pct": (equity / bal["net_deposits"] - 1) * 100 if bal["net_deposits"] else None,
            "as_of": datetime.now().isoformat(timespec="seconds")}
