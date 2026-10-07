"""Kullanıcı verilerinin tek dosyaya yedeklenmesi ve geri yüklenmesi."""
import json
from datetime import datetime

from fastapi import HTTPException

from .db import connect, rows
from .export import EXPORT_DIR

TABLES = ["watchlist", "transactions", "alerts", "targets", "cash_movements", "orders", "bots", "badges", "equity_snapshots"]
PROFILE = ["full_name", "email", "phone", "city", "risk_profile", "experience", "bio"]
VERSION = 1


def export_user(uid: int) -> dict:
    with connect() as con:
        user = dict(con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())
        data = {t: rows(con.execute(f"SELECT * FROM {t} WHERE user_id=?", (uid,))) for t in TABLES}
    for items in data.values():
        for r in items:
            r.pop("user_id", None)
    return {"app": "FinAnaliz", "version": VERSION, "created_at": datetime.now().isoformat(timespec="seconds"),
            "username": user["username"], "profile": {k: user.get(k) for k in PROFILE}, "data": data}


def save_file(uid: int) -> dict:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    payload = export_user(uid)
    path = EXPORT_DIR / f"FinAnaliz_Yedek_{payload['username']}_{datetime.now():%Y%m%d_%H%M%S}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {t: len(v) for t, v in payload["data"].items()}
    return {"path": str(path), "name": path.name, "folder": str(path.parent), "counts": counts}


def restore(uid: int, payload: dict) -> dict:
    if payload.get("app") != "FinAnaliz" or "data" not in payload:
        raise HTTPException(400, "Bu dosya bir FinAnaliz yedeği değil.")
    with connect() as con:
        for t in TABLES:
            con.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
        counts = {}
        for t in TABLES:
            items = payload["data"].get(t) or []
            cols = {r["name"] for r in con.execute(f"PRAGMA table_info({t})")}
            n = 0
            for r in items:
                r = {k: v for k, v in r.items() if k in cols and k != "id"}
                r["user_id"] = uid
                keys = list(r)
                con.execute(f"INSERT OR IGNORE INTO {t} ({', '.join(keys)}) VALUES ({', '.join('?' * len(keys))})", [r[k] for k in keys])
                n += 1
            counts[t] = n
        prof = payload.get("profile") or {}
        con.execute(f"UPDATE users SET {', '.join(f'{k}=?' for k in PROFILE)} WHERE id=?", [prof.get(k) for k in PROFILE] + [uid])
    return {"ok": True, "counts": counts}
