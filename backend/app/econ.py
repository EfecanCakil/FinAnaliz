"""Ekonomik takvim: haftanın önemli makroekonomik veri açıklamaları ve merkez bankası kararları.

Kaynak: ForexFactory'nin herkese açık haftalık takvim akışı (faireconomy.media).
Etkinlik adları sık kullanılanlar için Türkçeye çevrilir; özgün ad da korunur.
"""
import json
import re
import threading
import time
import urllib.request
from datetime import datetime

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
_cache: tuple[float, list] | None = None
_lock = threading.Lock()

COUNTRIES = {
    "USD": "ABD", "EUR": "Euro Bölgesi", "GBP": "İngiltere", "JPY": "Japonya", "CHF": "İsviçre", "CAD": "Kanada",
    "AUD": "Avustralya", "NZD": "Yeni Zelanda", "CNY": "Çin", "TRY": "Türkiye", "All": "Küresel",
}
IMPACT = {"High": "Yüksek", "Medium": "Orta", "Low": "Düşük", "Holiday": "Tatil", "Non-Economic": "Düşük"}

# Sık geçen etkinlik adlarının Türkçe karşılıkları (uzun ifadeler önce denenir)
TRANSLATIONS = [
    ("Non-Farm Employment Change", "Tarım Dışı İstihdam"),
    ("ADP Non-Farm Employment Change", "ADP Özel Sektör İstihdamı"),
    ("Federal Funds Rate", "FED Faiz Kararı"),
    ("FOMC Meeting Minutes", "FOMC Toplantı Tutanakları"),
    ("FOMC Statement", "FOMC Para Politikası Metni"),
    ("FOMC Press Conference", "FOMC Basın Toplantısı"),
    ("FOMC Economic Projections", "FOMC Ekonomik Projeksiyonlar"),
    ("Main Refinancing Rate", "ECB Faiz Kararı"),
    ("Monetary Policy Statement", "Para Politikası Metni"),
    ("ECB Press Conference", "ECB Basın Toplantısı"),
    ("Official Bank Rate", "BoE Faiz Kararı"),
    ("BOJ Policy Rate", "BoJ Faiz Kararı"),
    ("Core CPI", "Çekirdek TÜFE (Enflasyon)"),
    ("Core PCE Price Index", "Çekirdek PCE Fiyat Endeksi"),
    ("Core PPI", "Çekirdek ÜFE"),
    ("CPI", "TÜFE (Enflasyon)"),
    ("PPI", "ÜFE (Üretici Fiyatları)"),
    ("Unemployment Claims", "Haftalık İşsizlik Başvuruları"),
    ("Unemployment Rate", "İşsizlik Oranı"),
    ("Claimant Count Change", "İşsizlik Maaşı Başvuru Değişimi"),
    ("Employment Change", "İstihdam Değişimi"),
    ("Average Hourly Earnings", "Ortalama Saatlik Kazanç"),
    ("JOLTS Job Openings", "JOLTS Açık İş Pozisyonları"),
    ("Advance GDP", "GSYH (Öncü)"),
    ("Prelim GDP", "GSYH (Ön)"),
    ("Final GDP", "GSYH (Nihai)"),
    ("GDP", "GSYH (Büyüme)"),
    ("Core Retail Sales", "Çekirdek Perakende Satışlar"),
    ("Retail Sales", "Perakende Satışlar"),
    ("ISM Manufacturing PMI", "ISM İmalat PMI"),
    ("ISM Services PMI", "ISM Hizmet PMI"),
    ("Manufacturing PMI", "İmalat PMI"),
    ("Services PMI", "Hizmet PMI"),
    ("Industrial Production", "Sanayi Üretimi"),
    ("Trade Balance", "Dış Ticaret Dengesi"),
    ("Current Account", "Cari Denge"),
    ("Crude Oil Inventories", "Ham Petrol Stokları"),
    ("Natural Gas Storage", "Doğal Gaz Stokları"),
    ("CB Consumer Confidence", "Tüketici Güveni (CB)"),
    ("Consumer Confidence", "Tüketici Güveni"),
    ("UoM Consumer Sentiment", "Michigan Tüketici Güveni"),
    ("UoM Inflation Expectations", "Michigan Enflasyon Beklentileri"),
    ("Inflation Expectations", "Enflasyon Beklentileri"),
    ("Ivey PMI", "Ivey PMI"),
    ("PCE Price Index", "PCE Fiyat Endeksi"),
    ("Flash Manufacturing PMI", "İmalat PMI (Öncü)"),
    ("Flash Services PMI", "Hizmet PMI (Öncü)"),
    ("Building Permits", "İnşaat İzinleri"),
    ("Housing Starts", "Konut Başlangıçları"),
    ("Existing Home Sales", "Mevcut Konut Satışları"),
    ("New Home Sales", "Yeni Konut Satışları"),
    ("Durable Goods Orders", "Dayanıklı Mal Siparişleri"),
    ("German ifo Business Climate", "Almanya Ifo İş Ortamı"),
    ("ZEW Economic Sentiment", "ZEW Ekonomik Güven"),
    ("Bank Holiday", "Resmî Tatil"),
    ("OPEC-JMMC Meetings", "OPEC-JMMC Toplantıları"),
]
SPEAKS = re.compile(r"^(.*) Speaks$")


PREFIXES = {"Prelim": "(Ön)", "Final": "(Nihai)", "Flash": "(Öncü)", "Revised": "(Revize)", "Advance": "(Öncü)"}


REGIONS = {"German": "Almanya", "French": "Fransa", "Italian": "İtalya", "Spanish": "İspanya", "Japanese": "Japonya",
           "Chinese": "Çin", "Swiss": "İsviçre", "British": "İngiltere", "Tokyo": "Tokyo", "Caixin": "Caixin"}


def translate(title: str) -> str:
    words = title.split(" ")
    region = REGIONS.get(words[0])
    if region:
        words = words[1:]
    tags = [PREFIXES[w] for w in words if w in PREFIXES]
    words = [w for w in words if w not in PREFIXES]
    if region or tags:
        base = _translate_base(" ".join(words))
        return " ".join(x for x in [region, base, *tags] if x)
    return _translate_base(title)


def _translate_base(title: str) -> str:
    m = SPEAKS.match(title)
    if m:
        who = m.group(1).replace("Fed Chair", "FED Başkanı").replace("ECB President", "ECB Başkanı") \
            .replace("BOE Gov", "BoE Başkanı").replace("BOJ Gov", "BoJ Başkanı").replace("FOMC Member", "FOMC Üyesi")
        return f"{who} konuşması"
    suffix = ""
    for tag, tr in ((" m/m", " (aylık)"), (" q/q", " (çeyreklik)"), (" y/y", " (yıllık)")):
        if title.endswith(tag):
            title, suffix = title[: -len(tag)], tr
            break
    for en, tr in TRANSLATIONS:
        if title == en or title.endswith(" " + en) and len(title) - len(en) <= 12:
            prefix = title[: -len(en)].strip()
            return (f"{prefix} " if prefix else "") + tr + suffix
    return title + suffix


def week_events() -> dict:
    global _cache
    with _lock:
        if _cache and time.time() - _cache[0] < 3600:
            raw = _cache[1]
        else:
            raw = None
    error = None
    if raw is None:
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 FinAnaliz"})
            with urllib.request.urlopen(req, timeout=10) as r:
                raw = json.loads(r.read().decode("utf-8"))
            with _lock:
                _cache = (time.time(), raw)
        except Exception as e:
            raw = _cache[1] if _cache else []
            error = f"Takvim verisi alınamadı: {e}"

    events = []
    for e in raw:
        try:
            ts = int(datetime.fromisoformat(e["date"]).timestamp())
        except Exception:
            continue
        events.append({
            "time": ts, "country": e.get("country"), "country_name": COUNTRIES.get(e.get("country"), e.get("country")),
            "title": translate(e.get("title", "")), "title_original": e.get("title", ""),
            "impact": e.get("impact"), "impact_tr": IMPACT.get(e.get("impact"), e.get("impact")),
            "forecast": e.get("forecast") or None, "previous": e.get("previous") or None,
        })
    events.sort(key=lambda x: x["time"])
    return {"events": events, "source": "ForexFactory (faireconomy.media)", "error": error}
