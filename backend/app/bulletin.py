"""Günlük piyasa bülteni.

Endeksler, kurlar, emtialar, kripto paralar, günün öne çıkan hareketleri, genel haber
duygusu ve ekonomik takvimden bir özet hazırlanır. LLM anahtarı varsa bülten Claude
tarafından yazılır; yoksa aynı veriden şablon tabanlı bir metin üretilir. Bültenler
günlük olarak data/bulletins klasöründe saklanır.
"""
import json
import time
from datetime import datetime, timedelta, timezone

from . import assistant, econ, market, news
from .db import DATA_DIR

KEY = [("XU100.IS", "BIST 100"), ("XU030.IS", "BIST 30"), ("^GSPC", "S&P 500"), ("^IXIC", "NASDAQ"),
       ("USDTRY=X", "Dolar/TL"), ("EURTRY=X", "Euro/TL"), ("GRAM-ALTIN", "Gram altın"), ("BZ=F", "Brent petrol"),
       ("BTC-USD", "Bitcoin"), ("ETH-USD", "Ethereum")]
TR = timezone(timedelta(hours=3))


def _f(v, d=2):
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _p(v):
    return ("+" if v > 0 else "") + _f(v) + "%"


def gather() -> dict:
    qs = market.quotes([s for s, _ in KEY])
    key = [{"ad": n, "sembol": q["symbol"], "fiyat": q["price"], "gunluk_%": q["change_pct"], "haftalik_%": q["change_1w"]}
           for (s, n), q in zip(KEY, qs) if q["price"] is not None]
    movers = {}
    for m in ("bist", "us", "crypto"):
        lst = [q for q in market.market_quotes(m) if not q["is_index"] and q["change_pct"] is not None]
        lst.sort(key=lambda q: q["change_pct"], reverse=True)
        movers[m] = {"yukselenler": [{"sembol": q["symbol"].replace(".IS", ""), "ad": q["name"], "%": q["change_pct"]} for q in lst[:3]],
                     "dusenler": [{"sembol": q["symbol"].replace(".IS", ""), "ad": q["name"], "%": q["change_pct"]} for q in lst[-3:][::-1]],
                     "yukselen_sayisi": sum(q["change_pct"] > 0 for q in lst), "dusen_sayisi": sum(q["change_pct"] < 0 for q in lst)}
    try:
        n = news.get_news(None, 15)
        headlines = {"ozet": n["summary"], "basliklar": [i["title"] for i in n["items"][:8]]}
    except Exception:
        headlines = None
    try:
        now = time.time()
        events = [e for e in econ.week_events()["events"] if e["impact"] == "High" and e["time"] > now - 3600][:5]
        cal = [{"zaman": datetime.fromtimestamp(e["time"], TR).strftime("%d.%m %H:%M"), "ulke": e["country_name"],
                "etkinlik": e["title"], "beklenti": e["forecast"], "onceki": e["previous"]} for e in events]
    except Exception:
        cal = []
    return {"tarih": datetime.now(TR).strftime("%d.%m.%Y"), "gostergeler": key, "hareketliler": movers,
            "haberler": headlines, "takvim": cal}


def template(d: dict) -> str:
    g = {x["sembol"]: x for x in d["gostergeler"]}
    lines = [f"## Günün Piyasa Bülteni – {d['tarih']}", ""]

    def line(sym, label):
        x = g.get(sym)
        return f"**{label}** {_f(x['fiyat'])} ({_p(x['gunluk_%'])})" if x else None

    tr = [s for s in (line("XU100.IS", "BIST 100"), line("XU030.IS", "BIST 30")) if s]
    if tr:
        b = d["hareketliler"]["bist"]
        lines += ["### Borsa İstanbul", f"{', '.join(tr)}. Takip edilen hisselerden {b['yukselen_sayisi']} tanesi yükselirken "
                  f"{b['dusen_sayisi']} tanesi geriledi. Günün öne çıkanları: "
                  + ", ".join(f"{x['sembol']} ({_p(x['%'])})" for x in b["yukselenler"])
                  + "; en çok düşenler: " + ", ".join(f"{x['sembol']} ({_p(x['%'])})" for x in b["dusenler"]) + ".", ""]
    us = [s for s in (line("^GSPC", "S&P 500"), line("^IXIC", "NASDAQ")) if s]
    if us:
        u = d["hareketliler"]["us"]
        lines += ["### ABD Borsaları", f"{', '.join(us)}. Öne çıkanlar: "
                  + ", ".join(f"{x['ad']} ({_p(x['%'])})" for x in u["yukselenler"]) + ".", ""]
    fx = [s for s in (line("USDTRY=X", "Dolar/TL"), line("EURTRY=X", "Euro/TL"), line("GRAM-ALTIN", "Gram altın"),
                      line("BZ=F", "Brent petrol")) if s]
    if fx:
        lines += ["### Döviz ve Emtia", ", ".join(fx) + ".", ""]
    cr = [s for s in (line("BTC-USD", "Bitcoin"), line("ETH-USD", "Ethereum")) if s]
    if cr:
        c = d["hareketliler"]["crypto"]
        lines += ["### Kripto Paralar", f"{', '.join(cr)}. Takip edilen {c['yukselen_sayisi'] + c['dusen_sayisi']} kripto paranın "
                  f"{c['yukselen_sayisi']} tanesi günü artıda geçiriyor.", ""]
    h = d.get("haberler")
    if h and h.get("ozet"):
        o = h["ozet"]
        lines += ["### Haber Gündemi", f"Son haber başlıklarının genel tonu **{o['label'].lower()}** "
                  f"({o['positive']} olumlu, {o['negative']} olumsuz, {o['neutral']} nötr). Öne çıkan başlıklar:"]
        lines += [f"- {t}" for t in h["basliklar"][:4]] + [""]
    if d["takvim"]:
        lines += ["### Takvimde Öne Çıkanlar"] + [f"- {e['zaman']} · {e['ulke']}: {e['etkinlik']}" for e in d["takvim"]] + [""]
    lines.append("_Bu bülten otomatik olarak şablon tabanlı üretilmiştir; yatırım tavsiyesi değildir._")
    return "\n".join(lines)


def llm(d: dict) -> str | None:
    key = assistant.api_key()
    if not key:
        return None
    try:
        import anthropic

        resp = anthropic.Anthropic(api_key=key).messages.create(
            model=assistant.load_settings().get("model") or assistant.DEFAULT_MODEL, max_tokens=1600,
            system=assistant.SYSTEM_PROMPT,
            messages=[{"role": "user", "content":
                       "Aşağıdaki verilerle Türkçe, kısa ve akıcı bir 'Günün Piyasa Bülteni' yaz. Başlık olarak "
                       f"'## Günün Piyasa Bülteni – {d['tarih']}' kullan; ardından Borsa İstanbul, ABD Borsaları, Döviz ve Emtia, "
                       "Kripto Paralar, Haber Gündemi ve Takvimde Öne Çıkanlar için ### alt başlıkları kullan. Sayıları verideki "
                       "gibi kullan, veri dışında bilgi uydurma, yatırım tavsiyesi verme. Toplam 250-350 kelime.\n\n"
                       + json.dumps(d, ensure_ascii=False, default=float)}])
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    except Exception:
        return None


def get(refresh: bool = False) -> dict:
    folder = DATA_DIR / "bulletins"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{datetime.now(TR):%Y-%m-%d}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    d = gather()
    text = llm(d)
    result = {"date": d["tarih"], "created_at": datetime.now(TR).strftime("%H:%M"),
              "text": text or template(d), "source": "llm" if text else "şablon", "data": d}
    path.write_text(json.dumps(result, ensure_ascii=False, default=float), encoding="utf-8")
    return result


def history(limit: int = 14) -> list[dict]:
    folder = DATA_DIR / "bulletins"
    if not folder.exists():
        return []
    out = []
    for f in sorted(folder.glob("*.json"), reverse=True)[:limit]:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            out.append({"file": f.stem, "date": d["date"], "source": d["source"]})
        except Exception:
            pass
    return out


def by_date(day: str) -> dict:
    path = DATA_DIR / "bulletins" / f"{day}.json"
    if not path.exists() or not day.replace("-", "").isdigit():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
