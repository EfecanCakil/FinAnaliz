"""Gelişmiş alarmlar: fiyat, yüzde değişim, RSI, kesişimler, hacim, 52 hafta zirve/dip ve KAP bildirimi.

Alarmlar uygulama açıkken arayüz tarafından, sistem tepsisi modunda ise arka planda
dakikada bir kontrol edilir. Tetiklenen alarmlar isteğe bağlı olarak Telegram'a da gönderilir.
"""
import json
import threading
import time
import urllib.parse
import urllib.request

from . import assistant, kap, market, screener
from .db import connect, rows

CONDITIONS = {
    "above": ("Fiyat üzerine çıkarsa", True),
    "below": ("Fiyat altına inerse", True),
    "change_up": ("Günlük yükseliş en az %", True),
    "change_down": ("Günlük düşüş en az %", True),
    "rsi_below": ("RSI altına inerse", True),
    "rsi_above": ("RSI üzerine çıkarsa", True),
    "volume_spike": ("Hacim ortalamanın en az … katı", True),
    "golden_cross": ("Altın kesişim (SMA50 > SMA200)", False),
    "death_cross": ("Ölüm kesişimi (SMA50 < SMA200)", False),
    "macd_up": ("MACD al sinyali", False),
    "macd_down": ("MACD sat sinyali", False),
    "high_52w": ("52 haftanın zirvesi kırılırsa", False),
    "low_52w": ("52 haftanın dibi kırılırsa", False),
    "kap": ("Yeni KAP bildirimi", False),
}
REPEAT_COOLDOWN = 20 * 3600  # tekrarlayan alarmlar en fazla günde bir kez tetiklenir
_lock = threading.Lock()


def describe(a: dict) -> str:
    c = a["condition"]
    t = a.get("target")
    return {
        "above": f"fiyat {t:g} üzerine çıktı", "below": f"fiyat {t:g} altına indi",
        "change_up": f"günlük %{t:g}'den fazla yükseldi", "change_down": f"günlük %{t:g}'den fazla düştü",
        "rsi_below": f"RSI {t:g} altına indi", "rsi_above": f"RSI {t:g} üzerine çıktı",
        "volume_spike": f"hacim ortalamanın {t:g} katını aştı", "golden_cross": "altın kesişim oluştu",
        "death_cross": "ölüm kesişimi oluştu", "macd_up": "MACD al sinyali verdi", "macd_down": "MACD sat sinyali verdi",
        "high_52w": "52 haftanın zirvesini kırdı", "low_52w": "52 haftanın dibini kırdı", "kap": "yeni KAP bildirimi yayımlandı",
    }.get(c, c)


def _metrics(symbols: list[str]) -> dict[str, dict]:
    frames = market.daily_frames(symbols)
    out = {}
    for s in symbols:
        f = frames.get(s)
        row = None
        try:
            row = screener._row(s, f) if f is not None else None
        except Exception:
            row = None
        q = market._quote_from(s, f)
        out[s] = {**(row or {}), "price": q["price"], "change_pct": q["change_pct"],
                  "high_prev": float(f["High"].iloc[:-1].max()) if f is not None and len(f) > 2 else None,
                  "low_prev": float(f["Low"].iloc[:-1].min()) if f is not None and len(f) > 2 else None}
    return out


def _hit(a: dict, m: dict) -> tuple[bool, float | None]:
    c, t, p = a["condition"], a.get("target"), m.get("price")
    if p is None:
        return False, None
    if c == "above":
        return p >= t, p
    if c == "below":
        return p <= t, p
    if c == "change_up":
        return (m.get("change_pct") or 0) >= t, m.get("change_pct")
    if c == "change_down":
        return (m.get("change_pct") or 0) <= -abs(t), m.get("change_pct")
    if c == "rsi_below":
        return m.get("rsi") is not None and m["rsi"] <= t, m.get("rsi")
    if c == "rsi_above":
        return m.get("rsi") is not None and m["rsi"] >= t, m.get("rsi")
    if c == "volume_spike":
        return (m.get("vol_ratio") or 0) >= t, m.get("vol_ratio")
    if c in ("golden_cross", "death_cross", "macd_up", "macd_down"):
        key = {"golden_cross": "golden_cross", "death_cross": "death_cross", "macd_up": "macd_cross_up", "macd_down": "macd_cross_down"}[c]
        return bool(m.get(key)), p
    if c == "high_52w":
        return m.get("high_prev") is not None and p > m["high_prev"], p
    if c == "low_52w":
        return m.get("low_prev") is not None and p < m["low_prev"], p
    return False, None


def check(uid: int | None = None) -> list[dict]:
    """Aktif alarmları değerlendirir; tetiklenenleri kaydeder, Telegram'a gönderir ve döndürür."""
    with _lock:
        with connect() as con:
            sql = "SELECT * FROM alerts WHERE (triggered=0 OR repeat=1)" + (" AND user_id=?" if uid is not None else "")
            active = rows(con.execute(sql, (uid,) if uid is not None else ()))
        now = time.time()
        active = [a for a in active if not (a["repeat"] and a["last_fired"] and now - a["last_fired"] < REPEAT_COOLDOWN)]
        if not active:
            return []
        price_syms = sorted({a["symbol"] for a in active if a["condition"] != "kap"})
        metrics = _metrics(price_syms) if price_syms else {}
        fired = []
        with connect() as con:
            for a in active:
                try:
                    if a["condition"] == "kap":
                        latest = kap.latest_id(a["symbol"])
                        last_seen = a.get("last_value")
                        if last_seen is None and latest is not None:  # ilk kontrol: mevcut son bildirimi referans al
                            con.execute("UPDATE alerts SET last_value=? WHERE id=?", (latest, a["id"]))
                            continue
                        hit, value = (latest is not None and latest > last_seen), latest
                    else:
                        hit, value = _hit(a, metrics.get(a["symbol"], {}))
                except Exception:
                    continue
                if not hit:
                    continue
                if a["condition"] == "kap":
                    con.execute("UPDATE alerts SET last_value=?, last_fired=?, triggered=CASE WHEN repeat=1 THEN 0 ELSE 1 END, "
                                "triggered_at=CURRENT_TIMESTAMP WHERE id=?", (value, now, a["id"]))
                else:
                    con.execute("UPDATE alerts SET triggered=CASE WHEN repeat=1 THEN 0 ELSE 1 END, last_fired=?, "
                                "triggered_at=CURRENT_TIMESTAMP WHERE id=?", (now, a["id"]))
                price = metrics.get(a["symbol"], {}).get("price")
                item = {**a, "price": price, "value": value, "message": f"{a['symbol'].replace('.IS', '')} {describe(a)}"}
                fired.append(item)
    from . import notifications
    for f in fired:
        notifications.add(f["user_id"], "alert", f"Alarm: {f['message']}",
                          (f"Fiyat: {f['price']:.4g}" if f.get("price") else "") + (f" · Not: {f['note']}" if f.get("note") else ""),
                          f"/analiz?s={f['symbol']}")
        send_telegram(f"🔔 FinAnaliz alarmı: {f['message']}" + (f" (fiyat: {f['price']:.4g})" if f.get("price") else "")
                      + (f"\nNot: {f['note']}" if f.get("note") else ""))
    return fired


# ----------------------------------------------------------------------------- Telegram
def telegram_config() -> tuple[str | None, str | None]:
    s = assistant.load_settings()
    return s.get("telegram_bot_token"), s.get("telegram_chat_id")


def send_telegram(text: str, token: str | None = None, chat_id: str | None = None) -> tuple[bool, str]:
    if token is None or chat_id is None:
        token, chat_id = telegram_config()
    if not token or not chat_id:
        return False, "Telegram ayarları eksik."
    try:
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=10) as r:
            ok = json.loads(r.read()).get("ok", False)
        return ok, "Gönderildi." if ok else "Telegram isteği reddetti."
    except Exception as e:  # noqa: BLE001
        return False, f"Gönderilemedi: {e}"
