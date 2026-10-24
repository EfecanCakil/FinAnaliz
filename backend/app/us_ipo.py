"""ABD halka arzları (kaynak: Nasdaq halka arz takvimi — herkese açık, e-posta/anahtar gerektirmez).

Durumlar Türkiye tarafıyla aynı mantıkta tutulur:
- filed     : SEC'e kayıt başvurusu yapıldı (onay bekleyen başvuru)
- upcoming  : fiyat aralığı ve fiyatlanma tarihi belli (yaklaşan halka arz)
- priced    : fiyatlandı ve işlem görmeye başladı (geçmiş halka arz; bugünkü getirisi hesaplanır)
- withdrawn : başvuru geri çekildi
"""
import re
import threading
import time
from datetime import date, datetime

from . import yahoo
from .db import connect, rows

URL = "https://api.nasdaq.com/api/ipo/calendar?date={}"
HISTORY_FROM = (2025, 1)
_ret = {"at": 0.0, "map": {}, "loading": False}


def _init() -> None:
    with connect() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS us_ipos (deal_id TEXT PRIMARY KEY, ticker TEXT, company TEXT, exchange TEXT,
            status TEXT, price REAL, price_low REAL, price_high REAL, shares REAL, offer_amount REAL, filed_date TEXT,
            expected_date TEXT, priced_date TEXT, withdrawn_date TEXT, first_seen TEXT, updated_at REAL)""")


def _num(v) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace("$", "").replace(",", ""))
    except ValueError:
        return None


def _date(v) -> str | None:
    if not v:
        return None
    try:
        return datetime.strptime(v.strip(), "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def _range(v) -> tuple[float | None, float | None]:
    if not v:
        return None, None
    parts = [_num(p) for p in str(v).split("-")]
    parts = [p for p in parts if p is not None]
    return (parts[0], parts[-1]) if parts else (None, None)


def fetch_month(year: int, month: int) -> dict:
    from curl_cffi import requests  # tarayıcı gibi istek atar; Nasdaq düz isteklere yanıt vermiyor
    r = requests.get(URL.format(f"{year}-{month:02d}"), impersonate="chrome", timeout=25)
    r.raise_for_status()
    return r.json().get("data") or {}


def _rows(data: dict) -> list[dict]:
    out = []
    for r in ((data.get("priced") or {}).get("rows") or []):
        lo, hi = _range(r.get("proposedSharePrice"))
        out.append({"deal_id": r["dealID"], "ticker": r.get("proposedTickerSymbol"), "company": r.get("companyName"),
                    "exchange": r.get("proposedExchange"), "status": "priced", "price": lo, "shares": _num(r.get("sharesOffered")),
                    "offer_amount": _num(r.get("dollarValueOfSharesOffered")), "priced_date": _date(r.get("pricedDate"))})
    for r in (((data.get("upcoming") or {}).get("upcomingTable") or {}).get("rows") or []):
        lo, hi = _range(r.get("proposedSharePrice"))
        out.append({"deal_id": r["dealID"], "ticker": r.get("proposedTickerSymbol"), "company": r.get("companyName"),
                    "exchange": r.get("proposedExchange"), "status": "upcoming", "price_low": lo, "price_high": hi,
                    "shares": _num(r.get("sharesOffered")), "offer_amount": _num(r.get("dollarValueOfSharesOffered")),
                    "expected_date": _date(r.get("expectedPriceDate"))})
    for r in ((data.get("filed") or {}).get("rows") or []):
        out.append({"deal_id": r["dealID"], "ticker": r.get("proposedTickerSymbol"), "company": r.get("companyName"),
                    "status": "filed", "offer_amount": _num(r.get("dollarValueOfSharesOffered")), "filed_date": _date(r.get("filedDate"))})
    for r in ((data.get("withdrawn") or {}).get("rows") or []):
        out.append({"deal_id": r["dealID"], "ticker": r.get("proposedTickerSymbol"), "company": r.get("companyName"),
                    "status": "withdrawn", "shares": _num(r.get("sharesOffered")), "offer_amount": _num(r.get("dollarValueOfSharesOffered")),
                    "filed_date": _date(r.get("filedDate")), "withdrawn_date": _date(r.get("withdrawDate"))})
    return out


RANK = {"filed": 0, "upcoming": 1, "priced": 2, "withdrawn": 2}
COLS = ("ticker", "company", "exchange", "status", "price", "price_low", "price_high", "shares", "offer_amount",
        "filed_date", "expected_date", "priced_date", "withdrawn_date")


def _upsert(con, r: dict) -> tuple[str | None, str]:
    """Kaydı ekler/günceller; (önceki durum, yeni durum) döner. Durum yalnızca ileri gider (başvuru → yaklaşan → fiyatlandı)."""
    old = con.execute("SELECT * FROM us_ipos WHERE deal_id=?", (r["deal_id"],)).fetchone()
    if old is None:
        con.execute(f"INSERT INTO us_ipos (deal_id, {', '.join(COLS)}, first_seen, updated_at) VALUES (?{', ?' * len(COLS)}, ?, ?)",
                    [r["deal_id"]] + [r.get(c) for c in COLS] + [date.today().isoformat(), time.time()])
        return None, r["status"]
    status = r["status"] if RANK[r["status"]] >= RANK[old["status"]] else old["status"]
    merged = {c: (r.get(c) if r.get(c) is not None else old[c]) for c in COLS}
    merged["status"] = status
    con.execute(f"UPDATE us_ipos SET {', '.join(f'{c}=?' for c in COLS)}, updated_at=? WHERE deal_id=?",
                [merged[c] for c in COLS] + [time.time(), r["deal_id"]])
    return old["status"], status


def _months(start: tuple[int, int], end: tuple[int, int]):
    y, m = start
    while (y, m) <= end:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def sync(meta, notify, users: list[int]) -> None:
    """Geçmişi (ilk sefer) ve son/gelecek ayı çeker; yeni gelişmelerde bildirim gönderir."""
    _init()
    today = date.today()
    nxt = (today.year + (today.month == 12), 1 if today.month == 12 else today.month + 1)
    prev = (today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1)
    baseline = meta("us_baseline") == "1"
    months = list(_months(HISTORY_FROM, nxt)) if not baseline else [prev, (today.year, today.month), nxt]
    events = []
    for y, m in months:
        try:
            data = fetch_month(y, m)
        except Exception:  # noqa: BLE001
            continue
        with connect() as con:
            for r in _rows(data):
                before, after = _upsert(con, r)
                if before != after:
                    events.append((after, r))
        time.sleep(0.3)
    if baseline:
        for status, r in events[:15]:
            tk = f" ({r['ticker']})" if r.get("ticker") else ""
            if status == "upcoming":
                rng = f"{r['price_low']:.2f}–{r['price_high']:.2f} $" if r.get("price_low") and r.get("price_high") and r["price_high"] != r["price_low"] \
                    else (f"{r['price_low']:.2f} $" if r.get("price_low") else "fiyat aralığı belirtilmedi")
                when = datetime.fromisoformat(r["expected_date"]).strftime("%d.%m.%Y") if r.get("expected_date") else "yakında"
                notify(users, "us", f"🗽 ABD halka arzı geliyor: {r['company']}{tk}",
                       f"Fiyat aralığı {rng} · beklenen fiyatlanma {when} · büyüklük {_usd(r.get('offer_amount'))}.", "approvals")
            elif status == "priced":
                notify(users, "us", f"🗽 ABD halka arzı fiyatlandı: {r['company']}{tk}",
                       f"Halka arz fiyatı {r['price']:.2f} $ · büyüklük {_usd(r.get('offer_amount'))}. Hisse işlem görmeye başlıyor." if r.get("price")
                       else "Halka arz fiyatlandı; hisse işlem görmeye başlıyor.", "approvals")
            elif status == "filed":
                notify(users, "us", f"🗽 Yeni ABD halka arz başvurusu: {r['company']}{tk}",
                       f"SEC'e kayıt başvurusu yapıldı · planlanan büyüklük {_usd(r.get('offer_amount'))}.", "applications")
    meta("us_baseline", "1")


def _usd(v: float | None) -> str:
    if not v:
        return "belirtilmedi"
    return f"{v / 1e9:.2f} milyar $" if v >= 1e9 else f"{v / 1e6:.0f} milyon $"


def _returns(tickers: list[str]) -> dict:
    """Fiyatlanmış halka arzların bugünkü fiyatı (arka planda, saatlik; sayfa beklemez)."""
    def load():
        # Yalnızca son fiyat gerekir: Yahoo'nun hızlı toplu "spark" sorgusu (20'şerli) kullanılır; sonuçlar paket paket görünür
        from . import universe
        try:
            out = dict(_ret["map"])
            for i in range(0, len(tickers), 20):
                for item in universe._spark(tickers[i:i + 20]):
                    try:
                        closes = [c for c in item["response"][0]["indicators"]["quote"][0]["close"] if c is not None]
                        if closes:
                            out[item["symbol"]] = float(closes[-1])
                    except Exception:
                        continue
                _ret["map"] = dict(out)
            _ret.update(map=out, at=time.time())
        except Exception:
            _ret["at"] = time.time() - 3300
        finally:
            _ret["loading"] = False
    if tickers and not _ret["loading"] and time.time() - _ret["at"] > 3600 and yahoo.available():
        _ret["loading"] = True
        threading.Thread(target=load, daemon=True).start()
    return _ret["map"]


def overview() -> dict:
    _init()
    with connect() as con:
        allr = rows(con.execute("SELECT * FROM us_ipos ORDER BY COALESCE(priced_date, expected_date, filed_date, withdrawn_date) DESC"))
    today = date.today()
    cutoff = date(today.year - 1, today.month, 1).isoformat()
    for r in allr:  # SPAC: ticari faaliyeti olmayan, birleşme amaçlı "açık çek" şirketleri
        r["spac"] = bool(re.search(r"\b(acquisition|spac|capital corp|merger)\b", (r["company"] or "").lower()))
    upcoming = sorted([r for r in allr if r["status"] == "upcoming"], key=lambda r: r["expected_date"] or "9999")
    priced = [r for r in allr if r["status"] == "priced" and (r["priced_date"] or "") >= cutoff]
    year_ago = date(today.year - 1, today.month, today.day if not (today.month == 2 and today.day == 29) else 28).isoformat()
    filed = [r for r in allr if r["status"] == "filed" and (r["filed_date"] or "") >= year_ago]  # bir yıldan eski hareketsiz başvurular gösterilmez
    withdrawn = [r for r in allr if r["status"] == "withdrawn"][:60]
    # Getiri yalnızca gerçek şirketler için hesaplanır (SPAC birimleri 10 $'dan işlem görür, Yahoo'da çoğu bulunmaz)
    prices = _returns(sorted({r["ticker"] for r in priced if r["ticker"] and not r["spac"]}))
    for r in priced:
        cur = prices.get(r["ticker"]) if r["ticker"] else None
        r["current_price"] = cur
        r["return_pct"] = (cur / r["price"] - 1) * 100 if cur and r["price"] else None
    for r in filed:
        r["waiting_days"] = (today - date.fromisoformat(r["filed_date"])).days if r["filed_date"] else None
    rets = [r["return_pct"] for r in priced if r["return_pct"] is not None]
    year = str(today.year)
    return {"upcoming": upcoming, "priced": priced, "filed": filed, "withdrawn": withdrawn, "prices_loading": _ret["loading"],
            "stats": {"upcoming": len(upcoming), "filed": len(filed), "priced_year": sum(1 for r in priced if (r["priced_date"] or "").startswith(year)),
                      "raised_year": sum((r["offer_amount"] or 0) for r in priced if (r["priced_date"] or "").startswith(year)),
                      "avg_return": sum(rets) / len(rets) if rets else None,
                      "positive_share": sum(1 for x in rets if x > 0) / len(rets) * 100 if rets else None}}
