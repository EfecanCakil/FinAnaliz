"""Bilanço takvimi ve bildirimleri.

- Portföydeki (ve favorilerdeki) şirketler için son bilanço dönemi, varsa açıklanması beklenen tarih ve
  KAP'taki son finansal rapor bildirimleri.
- BIST şirketi KAP'ta finansal rapor yayımladığında ve veri kaynağında yeni dönem bilançosu belirdiğinde
  bildirim gönderilir; ikincisinde bildirim, otomatik bilanço özetinin ilk maddelerini içerir.
İlk çalıştırmada mevcut durum "görüldü" sayılır; yalnızca sonradan gelen yeni raporlar bildirilir."""
import threading
import time
from datetime import date, datetime

import pandas as pd
import yfinance as yf

from . import fundamentals, kap, market, notifications, research, yahoo
from .db import connect, rows

_cal_cache: dict[str, tuple[float, str | None]] = {}
_lock = threading.Lock()


def init() -> None:
    with connect() as con:
        con.execute("CREATE TABLE IF NOT EXISTS earnings_seen (user_id INTEGER NOT NULL, key TEXT NOT NULL, "
                    "created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, key))")


def _family(uid: int) -> list[int]:
    with connect() as con:
        return [uid] + [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id=?", (uid,))]


def _symbols(uid: int, include_watchlist: bool = True) -> list[str]:
    fam = _family(uid)
    q = ",".join("?" * len(fam))
    with connect() as con:
        held = [r["symbol"] for r in con.execute(
            f"SELECT symbol FROM transactions WHERE user_id IN ({q}) GROUP BY symbol "
            "HAVING SUM(CASE WHEN side='buy' THEN quantity ELSE -quantity END) > 1e-9", fam)]
        fav = [r["symbol"] for r in con.execute("SELECT symbol FROM watchlist WHERE user_id=?", (uid,))] if include_watchlist else []
    return [s for s in dict.fromkeys(held + fav) if market.market_of(s) in ("bist", "us")]


def _held(uid: int) -> set[str]:
    return set(_symbols(uid, include_watchlist=False))


def _next_date(symbol: str) -> str | None:
    """Veri kaynağında varsa bir sonraki bilanço açıklama tarihi (genelde ABD şirketlerinde bulunur)."""
    with _lock:
        hit = _cal_cache.get(symbol)
    if hit and time.time() - hit[0] < 12 * 3600:
        return hit[1]
    val = None
    try:
        with yahoo.slot():
            cal = yf.Ticker(symbol).calendar
        dates = (cal or {}).get("Earnings Date") if isinstance(cal, dict) else None
        if dates:
            d = pd.Timestamp(dates[0]).date()
            val = d.isoformat() if d >= date.today() else None
    except Exception:
        val = hit[1] if hit else None
    with _lock:
        _cal_cache[symbol] = (time.time(), val)
    return val


def _last_period(symbol: str, force: bool = False) -> str | None:
    st = fundamentals.statements(symbol, force=force)
    for key in ("inc", "bal"):
        df = st.get(key)
        if df is not None and not df.empty:
            return pd.Timestamp(max(df.columns)).strftime("%Y-%m-%d")
    return None


def _quarter(p: str | None) -> str | None:
    if not p:
        return None
    d = pd.Timestamp(p)
    return f"{d.year} {(d.month - 1) // 3 + 1}. çeyrek"


def calendar(uid: int) -> dict:
    syms = _symbols(uid)
    held = _held(uid)
    try:
        fr = [d for d in kap.disclosures(30) if d["class"] == "FR"]
    except Exception:
        fr = []
    from concurrent.futures import ThreadPoolExecutor

    def one(s):
        code = s.replace(".IS", "")
        try:
            period = _last_period(s)
        except Exception:
            period = None
        nxt = _next_date(s)
        reports = [{"title": d["title"], "time": d["time"], "url": d["url"]} for d in fr if code in d["codes"]][:3] if s.endswith(".IS") else []
        return {"symbol": s, "name": market.NAME_BY_SYMBOL.get(s, s), "held": s in held, "last_period": period,
                "last_period_label": _quarter(period), "next_date": nxt, "kap_reports": reports}
    with ThreadPoolExecutor(max_workers=4) as ex:
        items = list(ex.map(one, syms))
    today = date.today().isoformat()
    upcoming = sorted([i for i in items if i["next_date"] and i["next_date"] >= today], key=lambda i: i["next_date"])
    recent = sorted([i for i in items if i["kap_reports"]], key=lambda i: -(i["kap_reports"][0]["time"] or 0))
    return {"items": sorted(items, key=lambda i: (not i["held"], i["symbol"])), "upcoming": upcoming, "recent": recent,
            "note": "BIST şirketleri için açıklama tarihleri önceden bilinmez; şirket KAP'ta finansal rapor yayımladığında bildirim alırsınız. "
                    "Bilanço özeti, veri kaynağı yeni dönemi yansıttığında (genellikle birkaç gün içinde) ayrıca bildirilir."}


def _seen(uid: int) -> set[str]:
    with connect() as con:
        return {r["key"] for r in con.execute("SELECT key FROM earnings_seen WHERE user_id=?", (uid,))}


def _mark(uid: int, keys: list[str]) -> None:
    if keys:
        with connect() as con:
            con.executemany("INSERT OR IGNORE INTO earnings_seen (user_id, key) VALUES (?,?)", [(uid, k) for k in keys])


def check_kap() -> None:
    """KAP'ta yeni finansal rapor yayımlayan, portföydeki BIST şirketlerini bildirir (motor ~10 dakikada bir çağırır)."""
    try:
        fr = [d for d in kap.disclosures(3) if d["class"] == "FR"]
    except Exception:
        return
    with connect() as con:
        people = [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id IS NULL")]
    for uid in people:
        held = {s.replace(".IS", "") for s in _held(uid) if s.endswith(".IS")}
        if not held:
            continue
        seen = _seen(uid)
        first = "init:kap" not in seen
        new = [d for d in fr if held.intersection(d["codes"]) and f"kap:{d['id']}" not in seen]
        if not first:
            for d in new:
                code = next(c for c in d["codes"] if c in held)
                notifications.add(uid, "kap", f"📑 {code} finansal raporunu açıkladı", (d["title"] or "Finansal rapor")[:160],
                                  f"/temel?s={code}.IS")
        _mark(uid, [f"kap:{d['id']}" for d in new] + (["init:kap"] if first else []))


def check_periods() -> None:
    """Günde bir: veri kaynağında yeni bilanço dönemi belirdiyse otomatik özetle birlikte bildirir."""
    today = date.today().isoformat()
    with connect() as con:
        people = [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id IS NULL")]
    checked: dict[str, str | None] = {}
    for uid in people:
        seen = _seen(uid)
        if f"day:{today}" in seen:
            continue
        new_keys = [f"day:{today}"]
        for s in sorted(_held(uid)):
            if market.market_of(s) not in ("bist", "us"):
                continue
            if s not in checked:
                try:
                    checked[s] = _last_period(s, force=True)
                except Exception:
                    checked[s] = None
            period = checked[s]
            if not period:
                continue
            key = f"period:{s}:{period}"
            if key in seen:
                continue
            known = any(k.startswith(f"period:{s}:") for k in seen)
            new_keys.append(key)
            if not known:
                continue  # ilk kez görülen hisse: mevcut dönem bildirilmez
            try:
                dg = research.digest(s)
                body = " ".join(p["text"] for p in dg["points"][:2])[:220]
                title = f"📑 {s.replace('.IS', '')} {_quarter(period)} bilanço özeti hazır"
            except Exception:
                body, title = "Yeni dönem finansal tabloları yayımlandı.", f"📑 {s.replace('.IS', '')} yeni bilanço"
            notifications.add(uid, "kap", title, body, f"/temel?s={s}")
        _mark(uid, new_keys)
