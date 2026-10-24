"""SPK (Sermaye Piyasası Kurulu) kaynaklarından halka arz ve sermaye artırımı verisi.

- Onay bekleyen ilk halka arz başvuruları: SPK'nın "İlk Halka Arz Başvurusu" sayfasındaki resmi tablo.
- Onaylanan halka arzlar ve halka açık şirketlerin bedelli/bedelsiz sermaye artırımları: haftalık SPK Bülteni
  (PDF) "A. İzahname / İhraç Belgesi Onaylanan Sermaye Piyasası Araçları" bölümündeki tablolar.
"""
import html
import io
import re
import urllib.request

BASE = "https://spk.gov.tr"
PENDING_URL = BASE + "/istatistikler/basvurular/ilk-halka-arz-basvurusu"
BULLETINS_URL = BASE + "/spk-bultenleri/{year}-yili-spk-bultenleri"
UA = {"User-Agent": "Mozilla/5.0 (TradeMetrix; egitim amacli)"}

NUM = r"(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?|-)"
FOOT = r"(?:\s*\(\d+\))*"
NAME = r"(?P<name>\S[^\n]*?\s(?:T\.?\s?)?A\.?\s?Ş\.?)(?=\s)"
IPO_ROW = re.compile(NAME + FOOT + r"\s+(?P<cur>" + NUM + r")" + FOOT + r"\s+(?P<new>" + NUM + r")" + FOOT
                     + r"\s+(?P<bedelli>" + NUM + r")" + FOOT + r"\s+(?P<bedelsiz>" + NUM + r")" + FOOT
                     + r"\s+(?P<sale>" + NUM + r")" + FOOT + r"\s+(?P<extra>" + NUM + r")" + FOOT
                     + r"\s+(?P<price>\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?|-)" + FOOT)
SALE_TYPES = r"(?:Tahsisli/Nitelikli Yatırımcı|Nitelikli Yatırımcı|Tahsisli|Halka Arz|Borsada Satış|-)"
CAP_ROW = re.compile(NAME + FOOT + r"\s+(?P<cur>" + NUM + r")" + FOOT + r"\s+(?P<new>" + NUM + r")" + FOOT
                     + r"\s+(?P<bedelli>" + NUM + r")" + FOOT + r"\s+(?P<ic>" + NUM + r")" + FOOT
                     + r"\s+(?P<kar>" + NUM + r")" + FOOT + r"(?:\s+(?P<type>" + SALE_TYPES + r"))?")


def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url.replace(" ", "%20"), headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _num(v: str | None) -> float | None:
    if not v or v.strip() == "-":
        return None
    v = v.strip().replace(".", "").replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None


HEADER_TAIL = re.compile(r"^.*\b(?:Payından|Türü|Fiyatı|Kaynaklardan|Satışı|Artırımı)\s+")


def _clean_name(n: str) -> str:
    """Şirket adını sadeleştirir; tablo başlığı iki satıra bölündüğünde ada yapışan başlık kelimelerini atar."""
    n = re.sub(r"\s+", " ", n).strip(" -")
    n = HEADER_TAIL.sub("", n)
    return re.sub(r"\bA\.?\s?Ş\.?$", "AŞ", n)


# ----------------------------------------------------------------------------- onay bekleyen başvurular
def pending_applications() -> list[dict]:
    page = _get(PENDING_URL).decode("utf8", "ignore")
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    out = []
    for row in re.findall(r"<tr.*?</tr>", page, flags=re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh].*?</t[dh]>", row, flags=re.S)]
        if len(cells) >= 3 and re.match(r"\d{2}\.\d{2}\.\d{4}", cells[2]):
            d, m, y = cells[2][:10].split(".")
            out.append({"company": re.sub(r"\s+", " ", cells[1]), "applied": f"{y}-{m}-{d}"})
    if not out:
        raise RuntimeError("SPK başvuru listesi okunamadı.")
    return out


# ----------------------------------------------------------------------------- bültenler
def bulletin_index(year: int, max_pages: int = 6, stop_at: set[str] | None = None) -> list[dict]:
    """Yılın bültenleri: [{no: '2026/56', number: 56, year, url}] (en yeniden eskiye).
    Sayfa başına 30 bülten listelenir; stop_at içindeki (zaten işlenmiş) bir bültene gelince sonraki sayfalara geçilmez."""
    seen, out = set(), []
    for s in range(1, max_pages + 1):
        page = _get(BULLETINS_URL.format(year=year) + (f"?s={s}" if s > 1 else "")).decode("utf8", "ignore")
        found = 0
        for url, y, n in re.findall(r'href="((?:https://spk\.gov\.tr)?/data/[^"]+/(\d{4})-(\d+)\.pdf)"', page):
            if int(y) != year or n in seen:
                continue
            seen.add(n)
            found += 1
            out.append({"no": f"{y}/{int(n)}", "number": int(n), "year": int(y), "url": url if url.startswith("http") else BASE + url})
        if not found or (stop_at and any(b["no"] in stop_at for b in out)) or f'?s={s + 1}"' not in page:
            break
    return sorted(out, key=lambda b: -b["number"])


def bulletin_text(url: str, limit: int = 120) -> str:
    """Bülten PDF'ini indirip metnini çıkarır. Sunucu yanıtı takılırsa en fazla `limit` saniye beklenir."""
    import threading

    import pypdf
    box: dict = {}

    def run():
        try:
            reader = pypdf.PdfReader(io.BytesIO(_get(url, 60)))
            box["text"] = "\n".join(p.extract_text() or "" for p in reader.pages)
        except Exception as e:  # noqa: BLE001
            box["error"] = e
    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(limit)
    if t.is_alive():
        raise TimeoutError("SPK bülteni zamanında indirilemedi.")
    if "error" in box:
        raise box["error"]
    return box["text"]


def _section(text: str, start_pat: str) -> str:
    """'A.' bölümündeki bir alt tabloyu (ör. 'İlk Halka Arzlar') sonraki alt başlığa/bölüme kadar döndürür."""
    a_start = text.find("A. İZAHNAME")
    if a_start < 0:
        return ""
    a_end = re.search(r"\n\s*B\.\s+[A-ZÇĞİÖŞÜ]", text[a_start:])
    a = text[a_start: a_start + a_end.start()] if a_end else text[a_start:]
    m = re.search(r"\n\s*\d+\.\s*" + start_pat, a)
    if not m:
        return ""
    rest = a[m.end():]
    nxt = re.search(r"\n\s*\d+\.\s+[A-ZÇĞİÖŞÜ][^\n]{3,60}\n", rest)
    return rest[: nxt.start()] if nxt else rest


def _table_body(sec: str) -> str:
    lines = []
    for ln in sec.splitlines():
        s = ln.strip()
        if not s or s.startswith("Ortaklık") or s.startswith("NOT") or s.startswith("İç Kaynak") or s.startswith("____"):
            continue
        if re.search(r"Mevcut Sermaye|Yeni Sermaye|Satış Türü|Satış Fiyatı|Kâr Payından|Bedelli Sermaye Artırımı Bedelsiz", s):
            continue  # iki satıra bölünmüş tablo başlığı
        if re.match(r"^\(\d+\)", s):  # dipnotlar tablonun altındadır
            break
        if s.startswith("MERKEZ") or s.startswith("İSTANBUL TEMSİLCİLİĞİ") or re.fullmatch(r"\d+", s):
            continue
        lines.append(s)
    return " ".join(lines)


def _footnotes(sec: str) -> dict[str, str]:
    notes = {}
    for m in re.finditer(r"\((\d+)\)\s+([^\n(]+(?:\n(?!\s*\(\d+\))[^\n]+)*)", sec):
        notes.setdefault(m.group(1), re.sub(r"\s+", " ", m.group(2)).strip())
    return notes


def parse_bulletin(text: str) -> dict:
    """Bülten metninden ilk halka arz ve sermaye artırımı tablolarını çıkarır."""
    date_m = re.search(r"(\d{4}/\d+)\s+(\d{2})/(\d{2})/(\d{4})", text)
    date = f"{date_m.group(4)}-{date_m.group(3)}-{date_m.group(2)}" if date_m else None
    ipos, caps = [], []
    sec = _section(text, r"İlk Halka Arzlar?")
    if sec:
        notes = _footnotes(sec)
        for m in IPO_ROW.finditer(_table_body(sec)):
            price_txt = m.group("price")
            lo = _num(re.split(r"[-–]", price_txt)[0]) if price_txt != "-" else None
            hi = _num(re.split(r"[-–]", price_txt)[-1]) if price_txt != "-" else None
            ipos.append({"company": _clean_name(m.group("name")), "capital_current": _num(m.group("cur")),
                         "capital_new": _num(m.group("new")), "increase": _num(m.group("bedelli")),
                         "sale_existing": _num(m.group("sale")), "sale_extra": _num(m.group("extra")),
                         "price": lo, "price_max": hi if hi != lo else None,
                         "notes": " ".join(v for v in notes.values())[:1500] or None})
    sec = _section(text, r"Halka Açık Ortaklıkların Pay İhraçları")
    if sec:
        for m in CAP_ROW.finditer(_table_body(sec)):
            caps.append({"company": _clean_name(m.group("name")), "capital_current": _num(m.group("cur")),
                         "capital_new": _num(m.group("new")), "bedelli": _num(m.group("bedelli")),
                         "bedelsiz_ic": _num(m.group("ic")), "bedelsiz_kar": _num(m.group("kar")),
                         "sale_type": (m.group("type") or "").strip("- ") or None})
    return {"date": date, "ipos": ipos, "capital": caps}
