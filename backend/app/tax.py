"""Yurt dışı (ABD) hisse senedi kazançları için tahmini vergi hesabı (eğitim amaçlı).

Uygulanan kurallar (Gelir Vergisi Kanunu, değer artış kazancı):
- Satılan hisselerin maliyeti "ilk giren ilk çıkar" (FIFO) yöntemiyle bulunur.
- Alış ve satış tutarları işlem günlerindeki kurla TL'ye çevrilir (burada piyasa kuru kullanılır; resmî hesapta TCMB döviz alış kuru esas alınır).
- Alış ile satış arasındaki dönemde Yİ-ÜFE artışı %10 veya üzerindeyse maliyet, alıştan ve satıştan önceki ayların
  Yİ-ÜFE oranıyla endekslenir.
- Aynı yıl içindeki zararlar kazançlardan düşülür; vergi, artan oranlı gelir vergisi tarifesine göre hesaplanır.
Tarife dilimleri ve istisna tutarı yıldan yıla değişir; varsayılanlar düzenlenebilir ve kullanıcı tarafından kontrol edilmelidir."""
import html
import re
import threading
import time
import urllib.request
from datetime import date

import pandas as pd
from fastapi import HTTPException

from . import market, portfolio
from .db import connect

UFE_URL = "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Enflasyon+Verileri/Uretici+Fiyatlari"
# 2025 yılı gelir vergisi tarifesi (ücret dışı gelirler). Sonraki yıllar için kullanıcı güncelleyebilir.
DEFAULT_BRACKETS = [[158_000, 15], [330_000, 20], [1_200_000, 27], [4_300_000, 35], [None, 40]]
DEFAULT_EXEMPTION = 0.0  # menkul kıymet satış kazançlarına değer artışı istisnası uygulanmaz
PREF_KEY = "tax_settings"
_ufe: tuple[float, pd.Series] | None = None
_lock = threading.Lock()


def ufe_index() -> pd.Series:
    """Aylık Yİ-ÜFE değişimlerinden zincirlenmiş endeks (ay başı tarihli)."""
    global _ufe
    with _lock:
        if _ufe and time.time() - _ufe[0] < 12 * 3600:
            return _ufe[1]
    req = urllib.request.Request(UFE_URL, headers={"User-Agent": "Mozilla/5.0 TradeMetrix"})
    with urllib.request.urlopen(req, timeout=20) as r:
        text = r.read().decode("utf-8", errors="ignore")
    monthly = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) >= 5 and re.fullmatch(r"\d{2}-\d{4}", cells[0]) and cells[4]:
            try:
                monthly[pd.Timestamp(f"{cells[0][3:]}-{cells[0][:2]}-01")] = float(cells[4].replace(",", "."))
            except ValueError:
                pass
    s = pd.Series(monthly).sort_index()
    idx = (1 + s / 100).cumprod() * 100
    with _lock:
        _ufe = (time.time(), idx)
    return idx


def _ufe_before(idx: pd.Series, d: pd.Timestamp) -> float | None:
    """İşlem ayından bir önceki ayın endeksi (açıklanmamışsa son açıklanan)."""
    m = pd.Timestamp(d.year, d.month, 1) - pd.offsets.MonthBegin(1)
    before = idx[idx.index <= m]
    return float(before.iloc[-1]) if len(before) else None


def settings(uid: int) -> dict:
    import json
    with connect() as con:
        r = con.execute("SELECT value FROM user_prefs WHERE user_id=? AND key=?", (uid, PREF_KEY)).fetchone()
    cur = json.loads(r["value"]) if r else {}
    return {"brackets": cur.get("brackets") or DEFAULT_BRACKETS, "exemption": float(cur.get("exemption", DEFAULT_EXEMPTION)),
            "custom": bool(r), "default_year": 2025}


def save_settings(uid: int, brackets: list, exemption: float) -> dict:
    import json
    clean, last = [], 0.0
    for i, (limit, rate) in enumerate(brackets):
        rate = float(rate)
        if not 0 <= rate <= 100:
            raise HTTPException(400, "Vergi oranları 0 ile 100 arasında olmalı.")
        if limit is None or i == len(brackets) - 1:
            clean.append([None, rate])
            break
        limit = float(limit)
        if limit <= last:
            raise HTTPException(400, "Dilim üst sınırları artan sırada olmalı.")
        clean.append([limit, rate])
        last = limit
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO user_prefs VALUES (?,?,?)", (uid, PREF_KEY, json.dumps({"brackets": clean, "exemption": float(exemption)})))
    return settings(uid)


def _tax(amount: float, brackets: list) -> tuple[float, list[dict]]:
    total, prev, parts = 0.0, 0.0, []
    for limit, rate in brackets:
        top = amount if limit is None else min(amount, limit)
        if top > prev:
            part = (top - prev) * rate / 100
            parts.append({"from": prev, "to": top, "rate": rate, "tax": part})
            total += part
        if limit is None or amount <= limit:
            break
        prev = limit
    return total, parts


def report(uid: int, year: int) -> dict:
    if not 2000 <= year <= date.today().year:
        raise HTTPException(400, "Geçersiz yıl.")
    txs = [t for t in portfolio.transactions(uid) if market.currency_of(t["symbol"]) == "USD" and market.market_of(t["symbol"]) == "us"]
    cfg = settings(uid)
    try:
        ufe = ufe_index()
        ufe_error = None
    except Exception as e:  # noqa: BLE001
        ufe, ufe_error = pd.Series(dtype=float), f"Yİ-ÜFE verisi alınamadı ({e}); endeksleme yapılmadı."
    usd = market.daily_closes("USDTRY=X", "max")
    today = pd.Timestamp(date.today())

    def rate_at(d: pd.Timestamp) -> float:
        before = usd[usd.index <= d]
        return float(before.iloc[-1]) if len(before) else float(usd.iloc[0])

    lots: dict[str, list[dict]] = {}
    sales = []
    for t in txs:
        d = portfolio._tx_date(t, today)
        sym = t["symbol"]
        if t["side"] == "buy":
            lots.setdefault(sym, []).append({"date": d, "qty": t["quantity"], "price": t["price"], "fee": t["fee"] or 0, "left": t["quantity"]})
            continue
        qty_left, fee_sell = t["quantity"], t["fee"] or 0
        r_sell = rate_at(d)
        for lot in lots.get(sym, []):
            if qty_left <= 1e-12:
                break
            take = min(lot["left"], qty_left)
            if take <= 1e-12:
                continue
            lot["left"] -= take
            qty_left -= take
            if d.year != year:
                continue
            share = take / lot["qty"]
            r_buy = rate_at(lot["date"])
            cost = (take * lot["price"] + lot["fee"] * share) * r_buy
            proceeds = (take * t["price"] - fee_sell * take / t["quantity"]) * r_sell
            u0, u1 = _ufe_before(ufe, lot["date"]), _ufe_before(ufe, d)
            ratio = u1 / u0 if u0 and u1 else 1.0
            indexed = ratio - 1 >= 0.10
            cost_adj = cost * ratio if indexed else cost
            sales.append({"symbol": sym, "buy_date": lot["date"].strftime("%Y-%m-%d"), "sell_date": d.strftime("%Y-%m-%d"),
                          "quantity": take, "buy_price": lot["price"], "sell_price": t["price"], "buy_rate": r_buy, "sell_rate": r_sell,
                          "cost_try": cost, "ufe_change": (ratio - 1) * 100, "indexed": indexed, "cost_adj_try": cost_adj,
                          "proceeds_try": proceeds, "gain_try": proceeds - cost_adj,
                          "gain_usd": take * (t["price"] - lot["price"]) - lot["fee"] * share - fee_sell * take / t["quantity"]})
    gains = sum(s["gain_try"] for s in sales if s["gain_try"] > 0)
    losses = sum(s["gain_try"] for s in sales if s["gain_try"] < 0)
    net = gains + losses
    taxable = max(0.0, net - cfg["exemption"])
    tax, parts = _tax(taxable, cfg["brackets"])

    try:
        divs = [p for p in portfolio.dividends(uid)["payments"] if p["currency"] == "USD" and p["date"].startswith(str(year))]
    except Exception:
        divs = []
    div_try = sum(p["amount_try"] for p in divs)
    years = sorted({portfolio._tx_date(t, today).year for t in txs if t["side"] == "sell"} | {date.today().year}, reverse=True)
    return {"year": year, "years": years, "sales": sales, "gains_try": gains, "losses_try": losses, "net_try": net,
            "exemption": cfg["exemption"], "taxable_try": taxable, "tax_try": tax, "brackets_used": parts,
            "effective_rate": tax / net * 100 if net > 0 else 0.0, "settings": cfg,
            "dividends": {"count": len(divs), "gross_try": div_try},
            "ufe_error": ufe_error, "deadline": f"{year + 1} Mart ayı sonuna kadar beyan edilir (yıllık gelir vergisi beyannamesi).",
            "notes": ["Hesap tahminidir; resmî beyanda TCMB döviz alış kuru kullanılır ve kesin tutar için mali müşavire danışılmalıdır.",
                      "Yalnızca bu uygulamadaki (sanal) portföy işlemlerinden hesaplanır.",
                      "ABD temettüleri ayrıca menkul sermaye iradı olarak değerlendirilir; ABD'de kesilen vergi Türkiye'de mahsup edilebilir."]}
