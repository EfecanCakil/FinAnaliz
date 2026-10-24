"""Ekonomik olayların piyasa etkisi: TCMB faiz kararları, FED faiz kararları ve TÜİK enflasyon açıklaması
günlerinde BIST 100, dolar/TL, gram altın, S&P 500 ve Bitcoin geçmişte ortalama ne yaptı?

Kaynaklar: TCMB 1 hafta repo faiz geçmişi (değişiklik tarihleri), FRED DFEDTARU (FED üst bant), TÜİK'in
her ayın 3'ünde açıkladığı TÜFE. Faiz tablolarında yalnızca oranın değiştiği kararlar yer aldığından
"sabit tutma" kararları analize girmez."""
import html
import re
import threading
import time
import urllib.request
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import market

TCMB_URL = ("https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/"
            "Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo")
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU"
ASSETS = {"XU100.IS": "BIST 100", "USDTRY=X": "Dolar/TL", "GRAM-ALTIN": "Gram altın", "^GSPC": "S&P 500", "BTC-USD": "Bitcoin"}
EVENT_TYPES = {
    "tcmb_hike": "TCMB faiz artırımı", "tcmb_cut": "TCMB faiz indirimi",
    "fed_hike": "FED faiz artırımı", "fed_cut": "FED faiz indirimi",
    "tr_cpi": "TÜİK enflasyon açıklaması",
}
_cache: tuple[float, dict] | None = None
_lock = threading.Lock()
TTL = 12 * 3600


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 TradeMetrix"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="ignore")


def _prev_business_day(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def tcmb_decisions() -> list[dict]:
    """Politika faizi değişiklikleri. Tablodaki tarih yürürlük günüdür; karar bir iş günü önce 14:00'te açıklanır."""
    text = _get(TCMB_URL)
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) >= 3 and re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", cells[0]):
            try:
                rate = float(cells[2].replace(",", "."))
            except ValueError:
                continue
            d, m, y = cells[0].split(".")
            rows.append((date(int(y), int(m), int(d)), rate))
    rows.sort()
    out = []
    for (d0, r0), (d1, r1) in zip(rows, rows[1:]):
        if r1 != r0:
            out.append({"type": "tcmb_hike" if r1 > r0 else "tcmb_cut", "date": _prev_business_day(d1),
                        "detail": f"%{r0:g} → %{r1:g}".replace(".", ",")})
    return out


def fed_decisions() -> list[dict]:
    lines = _get(FRED_URL).strip().splitlines()[1:]
    prev, out = None, []
    for ln in lines:
        try:
            ds, vs = ln.split(",")
            v = float(vs)
        except ValueError:
            continue
        if prev is not None and v != prev:
            d = date.fromisoformat(ds)
            out.append({"type": "fed_hike" if v > prev else "fed_cut", "date": _prev_business_day(d),
                        "detail": f"üst bant %{prev:g} → %{v:g}".replace(".", ",")})
        prev = v
    return out


def cpi_releases(start_year: int = 2015) -> list[dict]:
    """TÜİK aylık TÜFE'yi her ayın 3'ünde 10:00'da açıklar (hafta sonuna denk gelirse etki ilk işlem gününde görülür)."""
    out, d = [], date(start_year, 1, 3)
    today = date.today()
    while d <= today:
        out.append({"type": "tr_cpi", "date": d, "detail": f"{(d.replace(day=1) - timedelta(days=1)).strftime('%m.%Y')} enflasyonu"})
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 3)
    return out


def _closes(symbol: str) -> pd.Series:
    try:
        return market.daily_closes(symbol, "max")
    except Exception:
        return pd.Series(dtype=float)


def impact() -> dict:
    global _cache
    with _lock:
        if _cache and time.time() - _cache[0] < TTL:
            return _cache[1]
    events, errors = [], []
    for name, fn in (("TCMB", tcmb_decisions), ("FED", fed_decisions), ("TÜİK", cpi_releases)):
        try:
            events += fn()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name} verisi alınamadı: {e}")
    prices = {s: _closes(s) for s in ASSETS}
    result = {}
    for etype, label in EVENT_TYPES.items():
        evs = sorted([e for e in events if e["type"] == etype], key=lambda e: e["date"])
        per_asset = {}
        for sym, aname in ASSETS.items():
            px = prices[sym]
            if px.empty:
                continue
            idx = px.index
            r0, r5 = [], []
            for e in evs:
                p = int(idx.searchsorted(pd.Timestamp(e["date"])))
                if p <= 0 or p >= len(idx) or (idx[p] - pd.Timestamp(e["date"])).days > 4:
                    continue
                base = float(px.iloc[p - 1])
                r0.append((float(px.iloc[p]) / base - 1) * 100)
                if p + 4 < len(idx):
                    r5.append((float(px.iloc[p + 4]) / base - 1) * 100)
            if r0:
                per_asset[sym] = {"name": aname, "n": len(r0), "day_avg": float(np.mean(r0)), "day_up": float(np.mean(np.array(r0) > 0) * 100),
                                  "day_abs": float(np.mean(np.abs(r0))),
                                  "week_avg": float(np.mean(r5)) if r5 else None, "week_up": float(np.mean(np.array(r5) > 0) * 100) if r5 else None}
        recent = []
        for e in evs[-8:][::-1]:
            row = {"date": e["date"].isoformat(), "detail": e["detail"]}
            for sym in ("XU100.IS", "USDTRY=X", "^GSPC"):
                px = prices[sym]
                if px.empty:
                    continue
                p = int(px.index.searchsorted(pd.Timestamp(e["date"])))
                if 0 < p < len(px) and (px.index[p] - pd.Timestamp(e["date"])).days <= 4:
                    row[sym] = round((float(px.iloc[p]) / float(px.iloc[p - 1]) - 1) * 100, 2)
            recent.append(row)
        result[etype] = {"label": label, "count": len(evs), "assets": per_asset, "recent": recent,
                         "insight": _insight(label, per_asset)}
    out = {"events": result, "assets": ASSETS, "errors": errors,
           "note": "Olay günü: kararın/verinin açıklandığı işlem günündeki kapanışın bir önceki kapanışa göre değişimi. "
                   "1 hafta: olaydan sonraki 5 işlem günü. FED kararları Türkiye saatiyle akşam açıklandığından BIST'e etkisi ertesi gün de görülebilir. "
                   "Faiz tablolarında yalnızca oranın değiştiği kararlar bulunur."}
    with _lock:
        _cache = (time.time(), out)
    return out


def _p(v: float, sign: bool = True) -> str:
    return (("+" if v >= 0 else "−") if sign else "") + f"%{abs(v):.2f}".replace(".", ",")


def _insight(label: str, per_asset: dict) -> str:
    if not per_asset:
        return "Ölçüm için yeterli veri yok."
    biggest = max(per_asset.values(), key=lambda a: a["day_abs"])
    parts = [f"{a['name']} ortalama {_p(a['day_avg'])} (yükseliş oranı %{a['day_up']:.0f})"
             for a in (per_asset.get("XU100.IS"), per_asset.get("USDTRY=X")) if a]
    txt = f"Geçmişteki {max(a['n'] for a in per_asset.values())} olay gününde " + ("; ".join(parts) if parts else "ölçüm yapıldı") + "."
    return txt + f" En sert tepki veren varlık: {biggest['name']} (ortalama ±{_p(biggest['day_abs'], False)} hareket)."


# Haftalık takvimdeki etkinlikleri geçmiş etki türleriyle eşleştirme
def classify(country: str | None, title_original: str) -> str | None:
    t = (title_original or "").lower()
    if country == "TRY" and ("one week repo" in t or "interest rate" in t or "policy rate" in t):
        return "tcmb"
    if country == "USD" and ("federal funds rate" in t or "fomc statement" in t):
        return "fed"
    if country == "TRY" and "cpi" in t:
        return "tr_cpi"
    return None
