"""Bildirim merkezi: alarmlar, gerçekleşen emirler, bot işlemleri, takaslar ve rozetler tek yerde."""
from .db import connect, rows

ICONS = {"alert": "🔔", "order": "📋", "bot": "🤖", "settlement": "💸", "kap": "📢", "badge": "🏅", "system": "ℹ️"}


def add(uid: int, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    with connect() as con:
        con.execute("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?,?,?,?,?)",
                    (uid, kind, title, body, link))


def recent(uid: int, limit: int = 50) -> dict:
    with connect() as con:
        items = rows(con.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?", (uid, limit)))
        unread = con.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0", (uid,)).fetchone()[0]
    for i in items:
        i["icon"] = ICONS.get(i["kind"], "ℹ️")
    return {"items": items, "unread": unread}


def since(uid: int | None, last_id: int) -> list[dict]:
    with connect() as con:
        if uid is None:
            return rows(con.execute("SELECT * FROM notifications WHERE id>? ORDER BY id", (last_id,)))
        return rows(con.execute("SELECT * FROM notifications WHERE user_id=? AND id>? ORDER BY id", (uid, last_id)))


def mark_read(uid: int, ids: list[int] | None = None) -> None:
    with connect() as con:
        if ids:
            con.executemany("UPDATE notifications SET read=1 WHERE user_id=? AND id=?", [(uid, i) for i in ids])
        else:
            con.execute("UPDATE notifications SET read=1 WHERE user_id=?", (uid,))


def clear(uid: int) -> None:
    with connect() as con:
        con.execute("DELETE FROM notifications WHERE user_id=?", (uid,))
