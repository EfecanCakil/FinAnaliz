"""Birden fazla sanal portföy: "Uzun vade", "Deneme", "Kripto" gibi ayrı bakiyeli portföyler ve karşılaştırması.

Her ek portföy, kişiye bağlı (users.parent_id) ve giriş yapılamayan ayrı bir hesap olarak tutulur. Böylece bakiye,
işlemler, emirler, botlar ve analizler mevcut kodla, portföy başına bağımsız çalışır. Favoriler, alarmlar, bildirimler
ve ayarlar kişiye aittir ve tüm portföylerde ortaktır."""
import json
import secrets

from fastapi import HTTPException

from . import account, auth, insights
from .db import connect

MAX_PORTFOLIOS = 8
MAIN_NAME_KEY = "main_portfolio_name"


def _main_name(person: int) -> str:
    with connect() as con:
        r = con.execute("SELECT value FROM user_prefs WHERE user_id=? AND key=?", (person, MAIN_NAME_KEY)).fetchone()
    return json.loads(r["value"]) if r else "Ana portföy"


def _check_name(name: str) -> str:
    name = (name or "").strip()
    if not 1 <= len(name) <= 30:
        raise HTTPException(400, "Portföy adı 1–30 karakter olmalı.")
    return name


def _stats(uid: int) -> dict:
    from .engine import holdings_value_try
    try:
        bal = account.balances(uid)
        value, items = holdings_value_try(uid)
        equity = bal["total_cash"] + value
        dep = bal["net_deposits"] or 0
        return {"equity": equity, "cash": bal["total_cash"], "invested": value, "net_deposits": dep,
                "return_pct": (equity / dep - 1) * 100 if dep else None, "positions": len([i for i in items if i["quantity"] > 0])}
    except Exception:
        return {"equity": None, "cash": None, "invested": None, "net_deposits": None, "return_pct": None, "positions": 0}


def list_all(person: int, with_stats: bool = True) -> dict:
    with connect() as con:
        subs = [dict(r) for r in con.execute("SELECT id, portfolio_name, created_at FROM users WHERE parent_id=? ORDER BY id", (person,))]
    items = [{"id": person, "name": _main_name(person), "main": True, "created_at": None}] + \
            [{"id": s["id"], "name": s["portfolio_name"] or f"Portföy {i + 2}", "main": False, "created_at": s["created_at"]}
             for i, s in enumerate(subs)]
    if with_stats:
        for it in items:
            it.update(_stats(it["id"]))
    return {"items": items, "max": MAX_PORTFOLIOS}


def create(person: int, name: str, initial: float) -> dict:
    name = _check_name(name)
    if not 1_000 <= initial <= 100_000_000:
        raise HTTPException(400, "Başlangıç bakiyesi 1.000 TL ile 100 milyon TL arasında olmalı.")
    with connect() as con:
        n = con.execute("SELECT COUNT(*) FROM users WHERE parent_id=?", (person,)).fetchone()[0]
        if n + 1 >= MAX_PORTFOLIOS:
            raise HTTPException(400, f"En fazla {MAX_PORTFOLIOS} portföy oluşturabilirsiniz.")
        owner = con.execute("SELECT username, is_guest FROM users WHERE id=?", (person,)).fetchone()
        # Giriş yapılamayan iç hesap: kullanıcı adı normal kayıtta kullanılamayan "~" içerir, parola karması geçersizdir
        username = f"{owner['username']}~{secrets.token_hex(4)}"
        cur = con.execute("INSERT INTO users (username, password_hash, parent_id, portfolio_name, is_guest) VALUES (?,?,?,?,0)",
                          (username, "!", person, name))
        pid = cur.lastrowid
    account.reset(pid, initial)
    return {"id": pid, "name": name}


def _owned(person: int, pid: int) -> None:
    with connect() as con:
        if not con.execute("SELECT 1 FROM users WHERE id=? AND parent_id=?", (pid, person)).fetchone():
            raise HTTPException(404, "Portföy bulunamadı.")


def rename(person: int, pid: int, name: str) -> dict:
    name = _check_name(name)
    if pid == person:
        with connect() as con:
            con.execute("INSERT OR REPLACE INTO user_prefs VALUES (?,?,?)", (person, MAIN_NAME_KEY, json.dumps(name)))
        return {"id": pid, "name": name}
    _owned(person, pid)
    with connect() as con:
        con.execute("UPDATE users SET portfolio_name=? WHERE id=?", (name, pid))
    return {"id": pid, "name": name}


def delete(person: int, pid: int) -> dict:
    if pid == person:
        raise HTTPException(400, "Ana portföy silinemez (hesabı sıfırlayabilirsiniz).")
    _owned(person, pid)
    with connect() as con:
        auth._delete_user(con, pid)
    return {"ok": True}


def compare(person: int) -> dict:
    """Her portföyün günlük toplam değer geçmişi (başlangıç bakiyesine göre %) ve özet istatistikler."""
    data = list_all(person)
    series = []
    for it in data["items"]:
        hist = insights.equity_history(it["id"])
        dep = it.get("net_deposits") or 0
        series.append({"id": it["id"], "name": it["name"],
                       "points": [{"day": h["day"], "value": h["equity"], "pct": (h["equity"] / dep - 1) * 100 if dep else None} for h in hist]})
    best = max((i for i in data["items"] if i.get("return_pct") is not None), key=lambda i: i["return_pct"], default=None)
    return {**data, "series": series, "best": best["name"] if best else None}
