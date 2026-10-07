"""KAP (Kamuyu Aydınlatma Platformu) bildirimleri.

kap.org.tr'nin kendi arayüzünün kullandığı bildirim listesi servisinden son günlerin
bildirimleri çekilir ve kısa süre önbellekte tutulur. Her bildirim KAP'taki
orijinal sayfasına bağlanır.
"""
import json
import threading
import time
import urllib.request
from datetime import datetime, timedelta

URL = "https://www.kap.org.tr/tr/api/disclosure/list/main"
DETAIL_URL = "https://www.kap.org.tr/tr/Bildirim/{}"
CLASSES = {"ODA": "Özel Durum Açıklaması", "FR": "Finansal Rapor", "DG": "Diğer", "DUY": "Borsa Duyurusu"}
CACHE_TTL = 300

_cache: dict[int, tuple[float, list[dict]]] = {}
_lock = threading.Lock()


def _fetch(days: int) -> list[dict]:
    today = datetime.now()
    body = json.dumps({"fromDate": (today - timedelta(days=days - 1)).strftime("%d.%m.%Y"), "toDate": today.strftime("%d.%m.%Y"),
                       "disclosureTypes": None, "memberTypes": ["IGS", "DDK"], "mkkMemberOid": None}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 FinAnaliz", "Referer": "https://www.kap.org.tr/tr"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = json.loads(r.read())
    out = []
    for x in raw:
        b = x.get("disclosureBasic") or {}
        codes = [c.strip() for c in (b.get("stockCode") or "").split(",") if c.strip()]
        related = [c.strip() for c in (b.get("relatedStocks") or "").split(",") if c.strip()]
        try:
            ts = int(datetime.strptime(b.get("publishDate", ""), "%d.%m.%Y %H:%M:%S").timestamp())
        except ValueError:
            ts = None
        out.append({
            "id": b.get("disclosureIndex"), "time": ts, "title": b.get("title"), "summary": b.get("summary"),
            "company": b.get("companyTitle"), "codes": codes + [c for c in related if c not in codes],
            "class": b.get("disclosureClass"), "class_name": CLASSES.get(b.get("disclosureClass"), b.get("disclosureClass")),
            "attachments": b.get("attachmentCount") or 0, "url": DETAIL_URL.format(b.get("disclosureIndex")),
        })
    out.sort(key=lambda d: d["id"] or 0, reverse=True)
    return out


def disclosures(days: int = 7) -> list[dict]:
    days = max(1, min(days, 30))
    with _lock:
        hit = _cache.get(days)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        data = _fetch(days)
    except Exception:
        if hit:
            return hit[1]
        raise
    with _lock:
        _cache[days] = (time.time(), data)
    return data


def for_codes(codes: list[str], days: int = 7) -> list[dict]:
    wanted = {c.upper().replace(".IS", "") for c in codes}
    return [d for d in disclosures(days) if wanted.intersection(d["codes"])]


def latest_id(code: str) -> int | None:
    items = for_codes([code], 7)
    return items[0]["id"] if items else None
