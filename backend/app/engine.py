"""Arka plan motoru: dakikada bir bekleyen emirleri, botları, alarmları ve takasları işler;
her kullanıcı için günlük hesap değerini kaydeder ve rozetleri günceller."""
import threading
import time
from datetime import date

from . import academy, account, ai_tools, alerts, bots, insights, notifications, orders, portfolio
from .db import connect, rows

INTERVAL = 60
_started = False
_lock = threading.Lock()


def holdings_value_try(uid: int) -> tuple[float, list[dict]]:
    items = portfolio.positions(uid)["items"]
    total = 0.0
    for i in items:
        rate = account.fx_to_try(i["symbol"]) if i["currency"] != "TRY" else 1.0
        i["value_try"] = (i["value"] if i["value"] is not None else i["cost"]) * rate
        total += i["value_try"]
    return total, items


def _settlements() -> None:
    today = date.today().isoformat()
    with connect() as con:
        due = rows(con.execute("SELECT id, user_id, symbol, side, quantity, amount_try FROM transactions "
                               "WHERE funded=1 AND settled_notified=0 AND settle_date<=? AND settle_date>date(?, '-7 day')",
                               (today, today)))
        con.execute("UPDATE transactions SET settled_notified=1 WHERE settled_notified=0 AND (settle_date<=? OR settle_date IS NULL)", (today,))
    for t in due:
        notifications.add(t["user_id"], "settlement", f"Takas tamamlandı: {t['symbol'].replace('.IS', '')}",
                          f"{t['quantity']:g} adet {'alış' if t['side'] == 'buy' else 'satış'} · {account.tl(abs(t['amount_try']))} T0 bakiyesine geçti",
                          "/portfoy")


def _daily_user_tasks() -> None:
    with connect() as con:
        users = [r["id"] for r in con.execute("SELECT id FROM users")]
    for uid in users:
        try:
            bal = account.balances(uid)
            value, _ = holdings_value_try(uid)
            equity = bal["total_cash"] + value
            insights.snapshot(uid, equity, bal["total_cash"], value)
            insights.badges(uid, (equity / bal["net_deposits"] - 1) * 100 if bal["net_deposits"] else None)
        except Exception:
            continue


def _weekly_reports() -> None:
    """Pazartesi günleri her kullanıcı için haftalık kişisel rapor üretir, bildirir ve (ayarlıysa) Telegram'a gönderir."""
    import json
    today = date.today()
    if today.weekday() != 0:
        return
    week = today.isoformat()
    with connect() as con:
        users = [r["id"] for r in con.execute("SELECT id FROM users")]
        done = {r["user_id"] for r in con.execute("SELECT user_id FROM weekly_reports WHERE week=?", (week,))}
    for uid in users:
        if uid in done:
            continue
        try:
            with connect() as con:
                if not con.execute("SELECT 1 FROM transactions WHERE user_id=? LIMIT 1", (uid,)).fetchone():
                    continue
            rep = ai_tools.weekly_report(uid)
            with connect() as con:
                con.execute("INSERT OR REPLACE INTO weekly_reports VALUES (?,?,?)", (uid, week, json.dumps(rep, ensure_ascii=False, default=float)))
            notifications.add(uid, "system", "📊 Haftalık kişisel raporunuz hazır", rep["data"]["donem"], "/basarilar")
            alerts.send_telegram(rep["text"][:3900])
        except Exception:
            continue


_counter = {"n": 0}


def tick() -> None:
    for step in (orders.check, bots.check, alerts.check):
        try:
            step(None)
        except Exception:
            pass
    _counter["n"] += 1
    slow = [_settlements, _daily_user_tasks]
    if _counter["n"] % 10 == 1:  # yaklaşık 10 dakikada bir
        slow += [ai_tools.smart_alerts, academy.resolve, _weekly_reports]
    for step in slow:
        try:
            step()
        except Exception:
            pass


def _loop() -> None:
    time.sleep(15)  # uygulama açılışını yavaşlatmamak için
    while True:
        tick()
        time.sleep(INTERVAL)


def start() -> None:
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, daemon=True, name="finanaliz-engine").start()
