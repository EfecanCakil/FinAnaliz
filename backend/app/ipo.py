"""Halka arz ve sermaye artırımı takibi (kaynak: SPK ve KAP).

- Onay bekleyen ilk halka arz başvuruları (SPK başvuru listesi),
- SPK bülteniyle onaylanan halka arzlar (satış fiyatı, büyüklük, ortak satışı),
- Geçmiş halka arzların bugünkü getirisi (sonradan yapılan bedelsiz artırımlara göre düzeltilmiş),
- Halka açık şirketlerin bedelli / bedelsiz sermaye artırımı onayları,
- İlgili KAP duyuruları.
Arka planda düzenli kontrol edilir; yeni onay veya başvuru olduğunda kullanıcılara bildirim gönderilir.
"""
import json
import re
import threading
import time
from datetime import date, datetime
from pathlib import Path

from . import kap, notifications, spk, universe, us_ipo
from .db import connect, rows

SEED = Path(__file__).resolve().parent / "data" / "spk_history.json"
SYNC_EVERY = 30 * 60
DEFAULT_PREFS = {"approvals": True, "applications": False, "capital": True, "us": True}
PREF_KEY = "finanaliz_ipo_notify"
KAP_WORDS = ("halka arz", "sermaye artırım", "pay alma hakkı", "rüçhan", "bedelli", "bedelsiz", "talep toplama", "izahname", "satış sonuç")

_lock = threading.Lock()
_state = {"running": False, "last_sync": None, "last_error": None}


def _init() -> None:
    with connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS spk_bulletins (no TEXT PRIMARY KEY, date TEXT, url TEXT, processed_at REAL);
        CREATE TABLE IF NOT EXISTS spk_ipos (id INTEGER PRIMARY KEY AUTOINCREMENT, bulletin TEXT, date TEXT, company TEXT,
            capital_current REAL, capital_new REAL, increase REAL, sale_existing REAL, sale_extra REAL, price REAL, price_max REAL,
            notes TEXT, UNIQUE(bulletin, company));
        CREATE TABLE IF NOT EXISTS spk_capital (id INTEGER PRIMARY KEY AUTOINCREMENT, bulletin TEXT, date TEXT, company TEXT,
            capital_current REAL, capital_new REAL, bedelli REAL, bedelsiz_ic REAL, bedelsiz_kar REAL, sale_type TEXT,
            UNIQUE(bulletin, company));
        CREATE TABLE IF NOT EXISTS spk_pending (company TEXT PRIMARY KEY, applied TEXT, first_seen TEXT, last_seen TEXT,
            active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS spk_meta (key TEXT PRIMARY KEY, value TEXT);
        """)


def _meta(key: str, value: str | None = None) -> str | None:
    with connect() as con:
        if value is not None:
            con.execute("INSERT OR REPLACE INTO spk_meta VALUES (?,?)", (key, value))
            return value
        r = con.execute("SELECT value FROM spk_meta WHERE key=?", (key,)).fetchone()
        return r["value"] if r else None


def _insert_bulletin(con, b: dict, parsed: dict) -> tuple[list[dict], list[dict]]:
    con.execute("INSERT OR REPLACE INTO spk_bulletins VALUES (?,?,?,?)", (b["no"], parsed["date"], b["url"], time.time()))
    new_ipos, new_caps = [], []
    for i in parsed["ipos"]:
        i = {**i, "company": spk._clean_name(i["company"])}
        cur = con.execute("""INSERT OR IGNORE INTO spk_ipos (bulletin, date, company, capital_current, capital_new, increase,
                             sale_existing, sale_extra, price, price_max, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                          (b["no"], parsed["date"], i["company"], i["capital_current"], i["capital_new"], i["increase"],
                           i["sale_existing"], i["sale_extra"], i["price"], i.get("price_max"), i.get("notes")))
        if cur.rowcount:
            new_ipos.append({**i, "date": parsed["date"], "bulletin": b["no"]})
    for c in parsed["capital"]:
        c = {**c, "company": spk._clean_name(c["company"])}
        cur = con.execute("""INSERT OR IGNORE INTO spk_capital (bulletin, date, company, capital_current, capital_new, bedelli,
                             bedelsiz_ic, bedelsiz_kar, sale_type) VALUES (?,?,?,?,?,?,?,?,?)""",
                          (b["no"], parsed["date"], c["company"], c["capital_current"], c["capital_new"], c["bedelli"],
                           c["bedelsiz_ic"], c["bedelsiz_kar"], c["sale_type"]))
        if cur.rowcount:
            new_caps.append({**c, "date": parsed["date"], "bulletin": b["no"]})
    return new_ipos, new_caps


def _seed() -> None:
    """İlk açılışta uygulamayla gelen 2024–2026 geçmişi yüklenir (bildirim gönderilmez)."""
    with connect() as con:
        if con.execute("SELECT COUNT(*) FROM spk_bulletins").fetchone()[0]:
            return
        if not SEED.exists():
            return
        data = json.loads(SEED.read_text(encoding="utf-8"))
        by_no = {b["no"]: {"date": b["date"], "ipos": [], "capital": []} for b in data["bulletins"]}
        for i in data["ipos"]:
            by_no.setdefault(i["bulletin"], {"date": i["date"], "ipos": [], "capital": []})["ipos"].append(i)
        for c in data["capital"]:
            by_no.setdefault(c["bulletin"], {"date": c["date"], "ipos": [], "capital": []})["capital"].append(c)
        urls = {b["no"]: b["url"] for b in data["bulletins"]}
        for no, parsed in by_no.items():
            _insert_bulletin(con, {"no": no, "url": urls.get(no)}, parsed)


# ----------------------------------------------------------------------------- bildirim tercihleri
def get_prefs(uid: int) -> dict:
    with connect() as con:
        r = con.execute("SELECT value FROM user_prefs WHERE user_id=? AND key=?", (uid, PREF_KEY)).fetchone()
    try:
        return {**DEFAULT_PREFS, **(json.loads(r["value"]) if r else {})}
    except Exception:
        return dict(DEFAULT_PREFS)


def set_prefs(uid: int, prefs: dict) -> dict:
    cur = {**get_prefs(uid), **{k: bool(v) for k, v in prefs.items() if k in DEFAULT_PREFS}}
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO user_prefs VALUES (?,?,?)", (uid, PREF_KEY, json.dumps(cur)))
    return cur


def _users() -> list[int]:
    with connect() as con:
        return [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id IS NULL")]


# ----------------------------------------------------------------------------- şirket adı → borsa kodu
_STOP = {"aş", "a", "ş", "taş", "ve", "sanayi", "san", "ticaret", "tic", "anonim", "şirketi", "şti", "the", "ltd"}


def _tokens(name: str) -> list[str]:
    t = name.replace("İ", "i").replace("I", "ı").lower()
    t = re.sub(r"a\.\s?ş\.?|t\.a\.ş\.?", " ", t)
    return [w for w in re.findall(r"[0-9a-zçğıöşü]+", t) if w not in _STOP]


_index: dict | None = None


def match_symbol(company: str) -> str | None:
    global _index
    if _index is None:
        _index = {}
        for a in universe.UNIVERSE.get("bist", []):
            tk = _tokens(a["name"])
            if tk:
                _index.setdefault(tuple(tk[:2]), a["symbol"])
                _index.setdefault(("1", tk[0]), a["symbol"] if ("1", tk[0]) not in _index else None)
    tk = _tokens(company)
    if not tk:
        return None
    return _index.get(tuple(tk[:2])) or (_index.get(("1", tk[0])) if len(tk[0]) >= 5 else None)


def _same_company(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    return bool(ta and tb) and ta[:2] == tb[:2]


# ----------------------------------------------------------------------------- senkronizasyon
def _notify(users: list[int], kind_pref: str, title: str, body: str, link: str = "/halka-arz", only: set[int] | None = None) -> None:
    for uid in users:
        if only is not None and uid not in only:
            continue
        if get_prefs(uid).get(kind_pref):
            notifications.add(uid, "ipo", title, body, link)


def _money(v: float | None) -> str:
    if not v:
        return "—"
    return (f"{v / 1e9:,.2f} milyar TL" if v >= 1e9 else f"{v / 1e6:,.1f} milyon TL").replace(",", "X").replace(".", ",").replace("X", ".")


def sync(force: bool = False) -> dict:
    """SPK başvuru listesini ve yeni bültenleri kontrol eder; yenilikleri kaydedip bildirim gönderir."""
    _init()
    with _lock:
        if _state["running"]:
            return status()
        last = _state["last_sync"]
        if not force and last and time.time() - last < 5 * 60:
            return status()
        _state["running"] = True
    try:
        _seed()
        users = _users()
        baseline = _meta("baseline") == "1"
        today = date.today().isoformat()

        # 1) Onay bekleyen başvurular
        pending = spk.pending_applications()
        with connect() as con:
            known = {r["company"] for r in con.execute("SELECT company FROM spk_pending")}
            con.execute("UPDATE spk_pending SET active=0")
            new_apps = []
            for p in pending:
                if p["company"] in known:
                    con.execute("UPDATE spk_pending SET active=1, last_seen=?, applied=? WHERE company=?", (today, p["applied"], p["company"]))
                else:
                    con.execute("INSERT INTO spk_pending VALUES (?,?,?,?,1)", (p["company"], p["applied"], today, today))
                    new_apps.append(p)
        if baseline and known:
            for p in new_apps[:10]:
                _notify(users, "applications", f"📝 Yeni halka arz başvurusu: {p['company']}",
                        f"Şirket {datetime.fromisoformat(p['applied']).strftime('%d.%m.%Y')} tarihinde SPK'ya başvurdu. "
                        f"Onay bekleyen başvuru sayısı: {len(pending)}.")

        # 2) Yeni SPK bültenleri (bu yıl ve yıl başında geçen yıl)
        years = [date.today().year] + ([date.today().year - 1] if date.today().month == 1 else [])
        with connect() as con:
            done = {r["no"] for r in con.execute("SELECT no FROM spk_bulletins")}
        holders = _holders_watchers()
        for y in years:
            for b in sorted(spk.bulletin_index(y, stop_at=done), key=lambda x: x["number"]):
                if b["no"] in done:
                    continue
                parsed = spk.parse_bulletin(spk.bulletin_text(b["url"]))
                with connect() as con:
                    new_ipos, new_caps = _insert_bulletin(con, b, parsed)
                if not baseline:
                    continue
                for i in new_ipos:
                    size = ((i["increase"] or 0) + (i["sale_existing"] or 0) + (i["sale_extra"] or 0)) * (i["price"] or 0)
                    price = f"{i['price']:,.2f} TL".replace(",", "X").replace(".", ",").replace("X", ".") if i["price"] else "belirtilmedi"
                    _notify(users, "approvals", f"🚀 SPK halka arzı onayladı: {i['company']}",
                            f"Satış fiyatı {price} · Halka arz büyüklüğü yaklaşık {_money(size)} (SPK Bülteni {b['no']}).")
                for c in new_caps:
                    sym = match_symbol(c["company"])
                    if not sym or not c["capital_current"]:
                        continue
                    parts = []
                    if c["bedelli"]:
                        parts.append(f"%{c['bedelli'] / c['capital_current'] * 100:.0f} bedelli")
                    bz = (c["bedelsiz_ic"] or 0) + (c["bedelsiz_kar"] or 0)
                    if bz:
                        parts.append(f"%{bz / c['capital_current'] * 100:.0f} bedelsiz")
                    if not parts:
                        continue
                    interested = holders.get(sym, set())
                    _notify(users, "capital", f"📈 {sym.replace('.IS', '')}: {' ve '.join(parts)} sermaye artırımı onaylandı",
                            f"{c['company']} için SPK onayı (Bülten {b['no']}). Portföyünüzde veya favorilerinizde olduğu için bildiriliyor.",
                            only=interested)
        _meta("baseline", "1")
        _state.update(last_sync=time.time(), last_error=None)
    except Exception as e:  # noqa: BLE001
        _state["last_error"] = str(e)[:200]
        _state["last_sync"] = time.time()
    try:  # ABD halka arzları (Nasdaq takvimi); SPK tarafındaki bir hata bunu engellemez
        def us_notify(users_, _kind, title, body, pref):
            for uid in users_:
                p = get_prefs(uid)
                if p.get("us") and p.get(pref):
                    notifications.add(uid, "ipo", title, body, "/halka-arz?pazar=abd")
        us_ipo.sync(_meta, us_notify, _users())
    except Exception as e:  # noqa: BLE001
        _state["last_error"] = str(e)[:200]
        _state["last_sync"] = time.time()
    finally:
        _state["running"] = False
    return status()


def _holders_watchers() -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    with connect() as con:
        for r in con.execute("SELECT DISTINCT user_id, symbol FROM watchlist"):
            out.setdefault(r["symbol"], set()).add(r["user_id"])
        for r in con.execute("SELECT user_id, symbol FROM transactions GROUP BY user_id, symbol "
                             "HAVING SUM(CASE WHEN side='buy' THEN quantity ELSE -quantity END) > 0"):
            out.setdefault(r["symbol"], set()).add(r["user_id"])
    return out


def status() -> dict:
    return {"last_sync": _state["last_sync"], "running": _state["running"], "error": _state["last_error"]}


def sync_async(force: bool = False) -> None:
    threading.Thread(target=sync, args=(force,), daemon=True).start()


_kap = {"at": 0.0, "items": [], "loading": False}


def _kap_items() -> list[dict]:
    """İlgili KAP duyuruları (son 7 gün). KAP yanıtı büyük ve yavaş olabildiği için arka planda çekilir; sayfa beklemez."""
    def load():
        try:
            items = [d for d in kap.disclosures(7)
                     if any(w in (d.get("title") or "").lower() for w in KAP_WORDS)
                     or any(w in (d.get("summary") or "").lower() for w in ("halka arz", "bedelli", "bedelsiz", "pay alma hakkı"))][:60]
            _kap.update(items=items, at=time.time())
        except Exception:
            _kap["at"] = time.time() - 25 * 60  # hata: 5 dk sonra tekrar dene
        finally:
            _kap["loading"] = False
    if not _kap["loading"] and time.time() - _kap["at"] > 30 * 60:
        _kap["loading"] = True
        threading.Thread(target=load, daemon=True).start()
    return _kap["items"]


# ----------------------------------------------------------------------------- arayüz verisi
def overview(uid: int) -> dict:
    _init()
    _seed()
    if _state["last_sync"] is None or time.time() - _state["last_sync"] > SYNC_EVERY:
        sync_async()
    with connect() as con:
        ipos = rows(con.execute("SELECT * FROM spk_ipos ORDER BY date DESC, id DESC"))
        caps = rows(con.execute("SELECT * FROM spk_capital ORDER BY date DESC, id DESC"))
        pend = rows(con.execute("SELECT * FROM spk_pending WHERE active=1 ORDER BY applied, company"))
        removed = rows(con.execute("SELECT * FROM spk_pending WHERE active=0 ORDER BY last_seen DESC LIMIT 30"))
    quotes = {}
    try:
        quotes = {q["symbol"]: q for q in universe.cached_quotes("bist")}
    except Exception:
        pass
    today = date.today()
    holders = _holders_watchers()

    for i in ipos:
        i["size_try"] = ((i["increase"] or 0) + (i["sale_existing"] or 0) + (i["sale_extra"] or 0)) * (i["price"] or 0) or None
        i["float_pct"] = ((i["increase"] or 0) + (i["sale_existing"] or 0) + (i["sale_extra"] or 0)) / i["capital_new"] * 100 if i["capital_new"] else None
        sym = match_symbol(i["company"])
        i["symbol"] = sym
        q = quotes.get(sym) if sym else None
        i["current_price"] = q["price"] if q else None
        # Halka arz sonrası bedelsiz artırımlar fiyatı böler; getiri karşılaştırması için halka arz fiyatı aynı oranda düzeltilir
        factor = 1.0
        for c in caps:
            if c["date"] and i["date"] and c["date"] > i["date"] and _same_company(c["company"], i["company"]) \
                    and ((c["bedelsiz_ic"] or 0) + (c["bedelsiz_kar"] or 0)) > 0 and c["capital_current"]:
                factor *= 1 + ((c["bedelsiz_ic"] or 0) + (c["bedelsiz_kar"] or 0)) / c["capital_current"]
        i["adj_price"] = i["price"] / factor if i["price"] else None
        i["return_pct"] = (i["current_price"] / i["adj_price"] - 1) * 100 if i["current_price"] and i["adj_price"] else None
        i["split_adjusted"] = factor > 1.0001
    for c in caps:
        cur = c["capital_current"]
        c["bedelli_pct"] = c["bedelli"] / cur * 100 if cur and c["bedelli"] else None
        bz = (c["bedelsiz_ic"] or 0) + (c["bedelsiz_kar"] or 0)
        c["bedelsiz_pct"] = bz / cur * 100 if cur and bz else None
        c["symbol"] = match_symbol(c["company"])
        c["mine"] = bool(c["symbol"] and uid in holders.get(c["symbol"], set()))
    for p in pend:
        p["waiting_days"] = (today - date.fromisoformat(p["applied"])).days if p["applied"] else None
        p["is_new"] = bool(p["first_seen"] and (today - date.fromisoformat(p["first_seen"])).days <= 14 and _meta("baseline") == "1")
    # Listeden çıkan başvurular: onaylananlarla eşleşenler "onaylandı", diğerleri "listeden çıktı (geri çekilmiş olabilir)"
    for r in removed:
        r["approved"] = any(_same_company(r["company"], i["company"]) for i in ipos)

    kap_items = _kap_items()

    year = str(today.year)
    rets = [i["return_pct"] for i in ipos if i["return_pct"] is not None]
    return {
        "ipos": ipos, "capital": caps, "pending": pend, "removed": removed, "kap": kap_items,
        "stats": {"pending": len(pend), "approved_year": sum(1 for i in ipos if (i["date"] or "").startswith(year)),
                  "approved_total": len(ipos), "avg_return": sum(rets) / len(rets) if rets else None,
                  "positive_share": sum(1 for r in rets if r > 0) / len(rets) * 100 if rets else None,
                  "last_ipo": ipos[0] if ipos else None},
        "sync": status(), "prefs": get_prefs(uid), "kap_loading": _kap["loading"], "us": us_ipo.overview(),
    }
