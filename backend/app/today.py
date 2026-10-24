"""Ana sayfadaki "Bugün ne oldu?" özeti: piyasalar, portföy, favoriler ve alarmlar için birkaç sade cümle."""
from datetime import datetime

from . import account, market, portfolio
from .db import connect

INDICES = [("XU100.IS", "BIST 100"), ("^GSPC", "S&P 500"), ("USDTRY=X", "Dolar/TL"), ("GC=F", "Altın"), ("BTC-USD", "Bitcoin")]


def _pct(v: float) -> str:
    return f"%{abs(v):.2f}".replace(".", ",")


def _move(v: float | None) -> str:
    if v is None:
        return "veri yok"
    if abs(v) < 0.15:
        return "yatay"
    return f"{_pct(v)} {'yükseldi' if v > 0 else 'düştü'}"


def summary(uid: int) -> dict:
    from .auth import person_of
    person = person_of(uid)  # favoriler ve bildirimler kişiye, portföy verileri etkin portföye aittir
    with connect() as con:
        favs = [r["symbol"] for r in con.execute("SELECT symbol FROM watchlist WHERE user_id=?", (person,))]
        today = datetime.now().strftime("%Y-%m-%d")
        fired = [r["title"] for r in con.execute(
            "SELECT title FROM notifications WHERE user_id=? AND kind='alert' AND date(created_at, 'localtime')=? ORDER BY id DESC",
            (person, today))]
    syms = [s for s, _ in INDICES] + [f for f in favs if f not in dict(INDICES)]
    q = {x["symbol"]: x for x in market.quotes(syms)}

    lines: list[dict] = []
    bist, spx = q.get("XU100.IS", {}).get("change_pct"), q.get("^GSPC", {}).get("change_pct")
    mood = None
    if bist is not None:
        lines.append({"icon": "🏛", "text": f"Borsa İstanbul (BIST 100) bugün {_move(bist)}.", "tone": "up" if bist > 0 else "down" if bist < 0 else ""})
        mood = "olumlu" if bist > 0.5 else "olumsuz" if bist < -0.5 else "sakin"
    if spx is not None:
        lines.append({"icon": "🗽", "text": f"ABD'de S&P 500 {_move(spx)}.", "tone": "up" if spx > 0 else "down" if spx < 0 else ""})
    usd, gold = q.get("USDTRY=X", {}), q.get("GC=F", {})
    if usd.get("price"):
        lines.append({"icon": "💵", "text": f"Dolar/TL {usd['price']:.2f} ({_move(usd.get('change_pct'))}).".replace(".", ",", 1), "tone": ""})
    if gold.get("change_pct") is not None:
        lines.append({"icon": "🥇", "text": f"Altın {_move(gold['change_pct'])}.", "tone": ""})

    # Portföy: bugünkü kâr/zarar (TL)
    try:
        pos = portfolio.positions(uid)["items"]
    except Exception:
        pos = []
    if pos:
        usdtry = usd.get("price") or 1
        day = 0.0
        for p in pos:
            pct, val = p.get("day_change_pct"), p.get("value")
            if pct is None or val is None:
                continue
            rate = 1 if p.get("currency") == "TRY" else usdtry
            day += val * pct / (100 + pct) * rate
        best = max((p for p in pos if p.get("day_change_pct") is not None), key=lambda p: p["day_change_pct"], default=None)
        txt = f"Portföyün bugün {'+' if day >= 0 else '−'}{account.tl(abs(day))} {'kazandırdı' if day >= 0 else 'kaybettirdi'}."
        if best and best["day_change_pct"] > 0:
            txt += f" En iyi giden: {best['symbol'].replace('.IS', '')} ({_pct(best['day_change_pct'])} ↑)."
        lines.append({"icon": "💼", "text": txt, "tone": "up" if day > 0 else "down" if day < 0 else ""})

    # Favoriler: en çok hareket eden
    fav_q = [q[f] for f in favs if f in q and q[f].get("change_pct") is not None]
    if fav_q:
        top = max(fav_q, key=lambda x: abs(x["change_pct"]))
        if abs(top["change_pct"]) >= 1:
            lines.append({"icon": "⭐", "text": f"Favorilerinden {top['symbol'].replace('.IS', '')} bugün {_move(top['change_pct'])}.",
                          "tone": "up" if top["change_pct"] > 0 else "down", "symbol": top["symbol"]})

    if fired:
        lines.append({"icon": "🔔", "text": f"Bugün {len(fired)} alarmın çaldı: " + "; ".join(t.replace('Alarm: ', '') for t in fired[:2])
                      + ("…" if len(fired) > 2 else "."), "tone": ""})

    hour = datetime.now().hour
    greet = "Günaydın" if 5 <= hour < 12 else "İyi günler" if hour < 18 else "İyi akşamlar"
    headline = {"olumlu": "Piyasalar bugün olumlu seyrediyor.", "olumsuz": "Piyasalar bugün satıcılı.",
                "sakin": "Piyasalar bugün sakin."}.get(mood or "", "")
    return {"greeting": greet, "headline": headline, "lines": lines, "as_of": int(datetime.now().timestamp())}
