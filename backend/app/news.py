"""Haber toplama ve duygu (sentiment) analizi.

Haber başlıkları Google Haberler RSS akışından çekilir (BIST ve döviz için
Türkçe, ABD hisseleri ve kripto için İngilizce). Duygu analizi:
  * LLM anahtarı varsa Claude ile başlık bazında (olumlu / olumsuz / nötr ve -1..1 skor),
  * yoksa Türkçe ve İngilizce finans sözlüğüne dayalı kural tabanlı yöntemle yapılır.
"""
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from . import assistant, market

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
CACHE_TTL = 900

# --- Sözlük tabanlı duygu analizi -------------------------------------------------
POS_TR = ["yüksel", "rekor", "artış", "arttı", "artı", "kazan", "kâr", "kar açıkla", "kârlılık", "büyüme", "büyüdü",
          "olumlu", "toparlan", "ralli", "zirve", "hedef fiyat", "al tavsiye", "temettü", "anlaşma", "ihale",
          "sipariş", "güçlü", "pozitif", "yatırım yap", "ihracat art", "talep art", "prim yap", "tavan", "coştu", "uçtu"]
NEG_TR = ["düş", "geriledi", "gerile", "kayıp", "zarar", "satış baskı", "çöküş", "çöktü", "olumsuz", "endişe",
          "dava", "ceza", "soruşturma", "iflas", "konkordato", "zayıf", "kesinti", "grev", "panik", "değer kaybı",
          "taban", "eridi", "sert satış", "negatif", "uyarı", "risk", "tedirgin", "kriz", "durgunluk", "geri çağır"]
POS_EN = ["surge", "soar", "jump", "rally", "gain", "beat", "record", "rise", "rising", "rises", "upgrade", "strong",
          "profit", "growth", "bullish", "outperform", "boost", "climb", "high", "approval", "wins", "buy rating", "tops"]
NEG_EN = ["fall", "falls", "drop", "plunge", "slump", "miss", "loss", "cut", "downgrade", "weak", "lawsuit", "probe",
          "bearish", "sell-off", "selloff", "decline", "crash", "fear", "recession", "tumble", "sink", "slide",
          "warn", "risk", "layoff", "fraud", "investigation", "bankrupt", "low", "concern"]


def _tr_lower(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def lexicon_sentiment(title: str) -> tuple[str, float]:
    t = _tr_lower(title)
    pos = sum(t.count(w) for w in POS_TR) + sum(len(re.findall(rf"\b{re.escape(w)}", t)) for w in POS_EN)
    neg = sum(t.count(w) for w in NEG_TR) + sum(len(re.findall(rf"\b{re.escape(w)}", t)) for w in NEG_EN)
    if pos == neg:
        return "nötr", 0.0
    score = (pos - neg) / (pos + neg)
    return ("olumlu" if score > 0 else "olumsuz"), round(score, 2)


def llm_sentiment(titles: list[str]) -> list[tuple[str, float]] | None:
    key = assistant.api_key()
    if not key or not titles:
        return None
    try:
        import anthropic

        listing = "\n".join(f"{i}. {t}" for i, t in enumerate(titles))
        resp = anthropic.Anthropic(api_key=key).messages.create(
            model=assistant.load_settings().get("model") or assistant.DEFAULT_MODEL,
            max_tokens=1500,
            system="Sen bir finansal haber duygu analizi sınıflandırıcısısın. Yalnızca geçerli JSON döndür.",
            messages=[{"role": "user", "content":
                       "Aşağıdaki finans haber başlıklarının ilgili varlığın fiyatı açısından duygusunu sınıflandır. "
                       'Yanıt olarak yalnızca şu biçimde bir JSON dizisi ver: [{"i": 0, "label": "olumlu|olumsuz|nötr", '
                       '"score": -1.0 ile 1.0 arası}]\n\n' + listing}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        data = json.loads(text[text.index("["): text.rindex("]") + 1])
        out = [("nötr", 0.0)] * len(titles)
        for d in data:
            i = int(d["i"])
            if 0 <= i < len(titles):
                label = d.get("label", "nötr")
                out[i] = (label if label in ("olumlu", "olumsuz", "nötr") else "nötr", float(d.get("score", 0)))
        return out
    except Exception:
        return None


# --- Haber kaynağı -----------------------------------------------------------------
def _query_for(symbol: str | None) -> tuple[str, str]:
    """Sembol için (arama sorgusu, dil) döndürür."""
    if not symbol:
        return "Borsa İstanbul OR piyasalar OR dolar OR altın", "tr"
    m = market.market_of(symbol)
    name = market.NAME_BY_SYMBOL.get(symbol, symbol.split(".")[0].split("-")[0])
    if m == "bist":
        return f'"{name}" OR {symbol.replace(".IS", "")} hisse', "tr"
    if m == "fx":
        return name.split("(")[0].strip(), "tr"
    if m == "crypto":
        return f"{name} crypto", "en"
    return f'"{name}" stock', "en"


def _fetch_rss(query: str, lang: str) -> list[dict]:
    params = {"q": query + " when:7d", "hl": "tr" if lang == "tr" else "en-US",
              "gl": "TR" if lang == "tr" else "US", "ceid": "TR:tr" if lang == "tr" else "US:en"}
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 FinAnaliz"})
    with urllib.request.urlopen(req, timeout=10) as r:
        root = ET.fromstring(r.read())
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            ts = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:
            ts = None
        items.append({"title": title, "link": it.findtext("link"), "source": source, "time": ts})
    items.sort(key=lambda x: x["time"] or 0, reverse=True)
    return items


def get_news(symbol: str | None, limit: int = 20) -> dict:
    key = symbol or "_genel"
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    query, lang = _query_for(symbol)
    try:
        items = _fetch_rss(query, lang)[:limit]
    except Exception as e:
        return {"symbol": symbol, "items": [], "summary": None, "method": None, "error": f"Haberler alınamadı: {e}"}

    llm = llm_sentiment([i["title"] for i in items])
    for idx, item in enumerate(items):
        item["sentiment"], item["score"] = llm[idx] if llm else lexicon_sentiment(item["title"])

    n = len(items)
    summary = None
    if n:
        pos = sum(i["sentiment"] == "olumlu" for i in items)
        neg = sum(i["sentiment"] == "olumsuz" for i in items)
        avg = sum(i["score"] for i in items) / n
        summary = {"count": n, "positive": pos, "negative": neg, "neutral": n - pos - neg, "avg_score": round(avg, 3),
                   "label": "Olumlu" if avg > 0.15 else "Olumsuz" if avg < -0.15 else "Nötr"}
    result = {"symbol": symbol, "name": market.NAME_BY_SYMBOL.get(symbol, symbol) if symbol else "Genel Piyasa",
              "language": lang, "items": items, "summary": summary,
              "method": "Yapay zekâ (LLM)" if llm else "Sözlük tabanlı", "error": None}
    with _lock:
        _cache[key] = (time.time(), result)
    return result
