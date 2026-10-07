"""Başarı rozetleri, aylık performans karnesi, günlük hesap değeri kayıtları ve işlem günlüğü istatistikleri."""
from collections import defaultdict
from datetime import date

from . import notifications
from .db import connect, rows

BADGES = [
    ("first_trade", "İlk Adım", "🚀", "İlk alım-satım işlemini yaptın."),
    ("first_profit", "İlk Kâr", "💰", "Kârla kapanan ilk satışını yaptın."),
    ("trades_10", "Aktif Yatırımcı", "📈", "10 işlem tamamladın."),
    ("trades_50", "Deneyimli Yatırımcı", "🏆", "50 işlem tamamladın."),
    ("diversified", "Çeşitlendirici", "🧺", "Aynı anda 5 farklı varlık taşıdın."),
    ("multi_market", "Dünya Vatandaşı", "🌍", "En az 3 farklı piyasada işlem yaptın."),
    ("profit_5", "Yüzde Beş", "⭐", "Toplam varlığın başlangıca göre %5 arttı."),
    ("profit_20", "Yüzde Yirmi", "🌟", "Toplam varlığın başlangıca göre %20 arttı."),
    ("journal_5", "Günlük Tutan", "📓", "5 işleme günlük notu ekledin."),
    ("first_order", "Planlı Yatırımcı", "🎯", "İlk limit / stop emrini verdin."),
    ("first_bot", "Otomasyon Ustası", "🤖", "İlk strateji botunu çalıştırdın."),
    ("win_streak_3", "Seri Galibiyet", "🔥", "Art arda 3 kârlı satış yaptın."),
    ("academy_3", "Öğrenci", "🎓", "Akademide 3 dersi tamamladın."),
    ("academy_all", "Akademi Mezunu", "🏛", "Akademideki tüm dersleri tamamladın."),
    ("oracle_5", "Kâhin", "🔮", "Tahmin oyununda 5 doğru tahmin yaptın."),
]


def snapshot(uid: int, equity: float, cash: float, invested: float) -> None:
    """Günün hesap değerini kaydeder (aylık karne ve grafik için)."""
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO equity_snapshots (user_id, day, equity, cash, invested) VALUES (?,?,?,?,?)",
                    (uid, date.today().isoformat(), equity, cash, invested))


def _sells_with_pnl(uid: int) -> list[dict]:
    from .portfolio import positions
    return [t for t in reversed(positions(uid)["transactions"]) if t["side"] == "sell" and t.get("realized_pnl_try") is not None]


def badges(uid: int, equity_pct: float | None = None) -> list[dict]:
    from . import market
    with connect() as con:
        txs = rows(con.execute("SELECT * FROM transactions WHERE user_id=? ORDER BY COALESCE(date,''), id", (uid,)))
        n_orders = con.execute("SELECT COUNT(*) FROM orders WHERE user_id=?", (uid,)).fetchone()[0]
        n_bots = con.execute("SELECT COUNT(*) FROM bots WHERE user_id=?", (uid,)).fetchone()[0]
        earned = {r["badge"]: r["earned_at"] for r in con.execute("SELECT * FROM badges WHERE user_id=?", (uid,))}
        n_lessons = con.execute("SELECT COUNT(*) FROM academy_progress WHERE user_id=?", (uid,)).fetchone()[0]
        n_correct = con.execute("SELECT COUNT(*) FROM predictions WHERE user_id=? AND result='correct'", (uid,)).fetchone()[0]
    sells = _sells_with_pnl(uid)
    max_concurrent, held = 0, defaultdict(float)
    for t in txs:
        held[t["symbol"]] += t["quantity"] if t["side"] == "buy" else -t["quantity"]
        max_concurrent = max(max_concurrent, sum(1 for v in held.values() if v > 1e-9))
    streak = best = 0
    for s in sells:
        streak = streak + 1 if s["realized_pnl_try"] > 0 else 0
        best = max(best, streak)
    cond = {
        "first_trade": len(txs) >= 1, "first_profit": any(s["realized_pnl_try"] > 0 for s in sells),
        "trades_10": len(txs) >= 10, "trades_50": len(txs) >= 50, "diversified": max_concurrent >= 5,
        "multi_market": len({market.market_of(t["symbol"]) for t in txs}) >= 3,
        "profit_5": (equity_pct or 0) >= 5, "profit_20": (equity_pct or 0) >= 20,
        "journal_5": sum(1 for t in txs if t.get("reason")) >= 5, "first_order": n_orders >= 1,
        "first_bot": n_bots >= 1, "win_streak_3": best >= 3,
        "academy_3": n_lessons >= 3, "academy_all": n_lessons >= 8, "oracle_5": n_correct >= 5,
    }
    out = []
    for key, name, icon, desc in BADGES:
        if cond[key] and key not in earned:
            with connect() as con:
                con.execute("INSERT OR IGNORE INTO badges (user_id, badge) VALUES (?,?)", (uid, key))
            earned[key] = date.today().isoformat()
            notifications.add(uid, "badge", f"Yeni rozet: {icon} {name}", desc, "/basarilar")
        out.append({"key": key, "name": name, "icon": icon, "description": desc, "earned": key in earned, "earned_at": earned.get(key)})
    return out


def monthly(uid: int) -> list[dict]:
    """Ay bazında işlem sayısı, gerçekleşen kâr/zarar, başarı oranı ve hesap değeri değişimi."""
    sells = _sells_with_pnl(uid)
    with connect() as con:
        txs = rows(con.execute("SELECT date, side FROM transactions WHERE user_id=?", (uid,)))
        snaps = rows(con.execute("SELECT day, equity FROM equity_snapshots WHERE user_id=? ORDER BY day", (uid,)))
    months: dict[str, dict] = defaultdict(lambda: {"trades": 0, "buys": 0, "sells": 0, "realized": 0.0, "wins": 0, "best": None, "worst": None})
    for t in txs:
        m = (t["date"] or "")[:7]
        if m:
            months[m]["trades"] += 1
            months[m]["buys" if t["side"] == "buy" else "sells"] += 1
    for s in sells:
        m = (s["date"] or "")[:7]
        if not m:
            continue
        d = months[m]
        d["realized"] += s["realized_pnl_try"]
        d["wins"] += s["realized_pnl_try"] > 0
        label = {"symbol": s["symbol"], "pnl": s["realized_pnl_try"]}
        if d["best"] is None or s["realized_pnl_try"] > d["best"]["pnl"]:
            d["best"] = label
        if d["worst"] is None or s["realized_pnl_try"] < d["worst"]["pnl"]:
            d["worst"] = label
    by_month_eq = {}
    for s in snaps:
        by_month_eq.setdefault(s["day"][:7], []).append(s["equity"])
    out = []
    for m in sorted(set(months) | set(by_month_eq), reverse=True):
        d = months[m]
        eq = by_month_eq.get(m)
        out.append({"month": m, **d, "win_rate": d["wins"] / d["sells"] * 100 if d["sells"] else None,
                    "equity_start": eq[0] if eq else None, "equity_end": eq[-1] if eq else None,
                    "equity_change_pct": (eq[-1] / eq[0] - 1) * 100 if eq and eq[0] else None})
    return out


def equity_history(uid: int) -> list[dict]:
    with connect() as con:
        return rows(con.execute("SELECT day, equity, cash, invested FROM equity_snapshots WHERE user_id=? ORDER BY day", (uid,)))


def journal_stats(uid: int) -> dict:
    """İşlem günlüğü: duygu durumu ve etikete göre kâr/zarar dağılımı."""
    sells = _sells_with_pnl(uid)
    with connect() as con:
        meta = {r["id"]: r for r in rows(con.execute("SELECT id, symbol, reason, emotion, tag, review FROM transactions WHERE user_id=?", (uid,)))}
    # Satışın sonucunu, aynı varlığın en son günlük notlu alışının duygu/etiketine bağla
    buys_by_symbol = defaultdict(list)
    for tid, m in sorted(meta.items()):
        buys_by_symbol[m["symbol"]].append(m)
    groups = {"emotion": defaultdict(lambda: {"count": 0, "pnl": 0.0, "wins": 0}), "tag": defaultdict(lambda: {"count": 0, "pnl": 0.0, "wins": 0})}
    for s in sells:
        prior = [b for b in buys_by_symbol[s["symbol"]] if b["id"] < s["id"] and (b["emotion"] or b["tag"])]
        src = meta.get(s["id"]) if (meta.get(s["id"]) or {}).get("emotion") or (meta.get(s["id"]) or {}).get("tag") else (prior[-1] if prior else None)
        for key in ("emotion", "tag"):
            label = (src or {}).get(key) or "Belirtilmemiş"
            g = groups[key][label]
            g["count"] += 1
            g["pnl"] += s["realized_pnl_try"]
            g["wins"] += s["realized_pnl_try"] > 0
    fmt = lambda d: sorted([{"label": k, **v, "win_rate": v["wins"] / v["count"] * 100} for k, v in d.items()], key=lambda x: -x["pnl"])
    return {"by_emotion": fmt(groups["emotion"]), "by_tag": fmt(groups["tag"]), "closed_trades": len(sells),
            "total_realized": sum(s["realized_pnl_try"] for s in sells)}
