"""Piyasa verisi toplama ve önbellekleme.

BIST, ABD hisseleri, döviz/emtia ve kripto verileri Yahoo Finance (yfinance)
üzerinden tek tip sembollerle çekilir (ör. THYAO.IS, AAPL, USDTRY=X, BTC-USD).
Gram altın / gram gümüş gibi Türkiye'ye özgü fiyatlar, ons fiyatı ve USD/TRY
kurundan hesaplanan "türetilmiş" sembollerdir. Çekilen mum verileri SQLite'taki
price_cache tablosunda kısa süreli saklanır.
"""
import json
from datetime import datetime, timezone
import math
import threading
import time

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from . import yahoo
from .db import connect

OUNCE_GRAMS = 31.1034768


def _a(symbol, name, sector, index=False):
    return {"symbol": symbol, "name": name, "sector": sector, "index": index}


CATALOG: dict[str, list[dict]] = {
    "bist": [
        _a("XU100.IS", "BIST 100", "Endeks", True),
        _a("XU030.IS", "BIST 30", "Endeks", True),
        _a("XBANK.IS", "BIST Banka", "Endeks", True),
        _a("XUSIN.IS", "BIST Sınai", "Endeks", True),
        _a("AKBNK.IS", "Akbank", "Bankacılık"),
        _a("GARAN.IS", "Garanti BBVA", "Bankacılık"),
        _a("ISCTR.IS", "İş Bankası (C)", "Bankacılık"),
        _a("YKBNK.IS", "Yapı Kredi", "Bankacılık"),
        _a("KCHOL.IS", "Koç Holding", "Holding"),
        _a("SAHOL.IS", "Sabancı Holding", "Holding"),
        _a("ALARK.IS", "Alarko Holding", "Holding"),
        _a("THYAO.IS", "Türk Hava Yolları", "Ulaştırma"),
        _a("PGSUS.IS", "Pegasus", "Ulaştırma"),
        _a("TAVHL.IS", "TAV Havalimanları", "Ulaştırma"),
        _a("ASELS.IS", "Aselsan", "Savunma & Teknoloji"),
        _a("ASTOR.IS", "Astor Enerji", "Enerji"),
        _a("TUPRS.IS", "Tüpraş", "Enerji"),
        _a("KONTR.IS", "Kontrolmatik", "Enerji"),
        _a("PETKM.IS", "Petkim", "Kimya"),
        _a("SASA.IS", "SASA Polyester", "Kimya"),
        _a("HEKTS.IS", "Hektaş", "Kimya"),
        _a("GUBRF.IS", "Gübre Fabrikaları", "Kimya"),
        _a("EREGL.IS", "Ereğli Demir Çelik", "Metal & Madencilik"),
        _a("KRDMD.IS", "Kardemir (D)", "Metal & Madencilik"),
        _a("TRALT.IS", "Türk Altın İşletmeleri", "Metal & Madencilik"),
        _a("FROTO.IS", "Ford Otosan", "Otomotiv"),
        _a("TOASO.IS", "Tofaş", "Otomotiv"),
        _a("DOAS.IS", "Doğuş Otomotiv", "Otomotiv"),
        _a("BIMAS.IS", "BİM Mağazalar", "Perakende & Gıda"),
        _a("MGROS.IS", "Migros", "Perakende & Gıda"),
        _a("ULKER.IS", "Ülker", "Perakende & Gıda"),
        _a("AEFES.IS", "Anadolu Efes", "Perakende & Gıda"),
        _a("CCOLA.IS", "Coca-Cola İçecek", "Perakende & Gıda"),
        _a("TCELL.IS", "Turkcell", "Telekom"),
        _a("TTKOM.IS", "Türk Telekom", "Telekom"),
        _a("SISE.IS", "Şişecam", "Sanayi"),
        _a("ARCLK.IS", "Arçelik", "Sanayi"),
        _a("VESTL.IS", "Vestel", "Sanayi"),
        _a("OYAKC.IS", "Oyak Çimento", "İnşaat & GYO"),
        _a("ENKAI.IS", "Enka İnşaat", "İnşaat & GYO"),
        _a("EKGYO.IS", "Emlak Konut GYO", "İnşaat & GYO"),
    ],
    "us": [
        _a("^GSPC", "S&P 500", "Endeks", True),
        _a("^DJI", "Dow Jones", "Endeks", True),
        _a("^IXIC", "NASDAQ Bileşik", "Endeks", True),
        _a("^RUT", "Russell 2000", "Endeks", True),
        _a("^VIX", "VIX Korku Endeksi", "Endeks", True),
        _a("AAPL", "Apple", "Teknoloji"),
        _a("MSFT", "Microsoft", "Teknoloji"),
        _a("NVDA", "NVIDIA", "Teknoloji"),
        _a("AVGO", "Broadcom", "Teknoloji"),
        _a("AMD", "AMD", "Teknoloji"),
        _a("INTC", "Intel", "Teknoloji"),
        _a("ORCL", "Oracle", "Teknoloji"),
        _a("CRM", "Salesforce", "Teknoloji"),
        _a("PLTR", "Palantir", "Teknoloji"),
        _a("GOOGL", "Alphabet", "İletişim & Medya"),
        _a("META", "Meta Platforms", "İletişim & Medya"),
        _a("NFLX", "Netflix", "İletişim & Medya"),
        _a("DIS", "Walt Disney", "İletişim & Medya"),
        _a("AMZN", "Amazon", "Tüketim"),
        _a("TSLA", "Tesla", "Tüketim"),
        _a("WMT", "Walmart", "Tüketim"),
        _a("COST", "Costco", "Tüketim"),
        _a("KO", "Coca-Cola", "Tüketim"),
        _a("PEP", "PepsiCo", "Tüketim"),
        _a("BRK-B", "Berkshire Hathaway", "Finans"),
        _a("JPM", "JPMorgan Chase", "Finans"),
        _a("V", "Visa", "Finans"),
        _a("MA", "Mastercard", "Finans"),
        _a("LLY", "Eli Lilly", "Sağlık"),
        _a("UNH", "UnitedHealth", "Sağlık"),
        _a("JNJ", "Johnson & Johnson", "Sağlık"),
        _a("XOM", "ExxonMobil", "Enerji & Sanayi"),
        _a("BA", "Boeing", "Enerji & Sanayi"),
    ],
    "fx": [
        _a("USDTRY=X", "Dolar / TL", "TL Kurları"),
        _a("EURTRY=X", "Euro / TL", "TL Kurları"),
        _a("GBPTRY=X", "Sterlin / TL", "TL Kurları"),
        _a("CHFTRY=X", "İsviçre Frangı / TL", "TL Kurları"),
        _a("JPYTRY=X", "Japon Yeni / TL", "TL Kurları"),
        _a("EURUSD=X", "Euro / Dolar", "Çapraz Kurlar"),
        _a("GBPUSD=X", "Sterlin / Dolar", "Çapraz Kurlar"),
        _a("USDJPY=X", "Dolar / Japon Yeni", "Çapraz Kurlar"),
        _a("DX-Y.NYB", "Dolar Endeksi (DXY)", "Çapraz Kurlar", True),
        _a("GRAM-ALTIN", "Gram Altın (TL)", "Değerli Metaller"),
        _a("GRAM-GUMUS", "Gram Gümüş (TL)", "Değerli Metaller"),
        _a("GC=F", "Altın (ons, USD)", "Değerli Metaller"),
        _a("SI=F", "Gümüş (ons, USD)", "Değerli Metaller"),
        _a("BZ=F", "Brent Petrol", "Enerji & Emtia"),
        _a("CL=F", "WTI Petrol", "Enerji & Emtia"),
        _a("NG=F", "Doğal Gaz", "Enerji & Emtia"),
        _a("HG=F", "Bakır", "Enerji & Emtia"),
    ],
    "crypto": [
        _a("BTC-USD", "Bitcoin", "Büyük Piyasa Değeri"),
        _a("ETH-USD", "Ethereum", "Büyük Piyasa Değeri"),
        _a("BNB-USD", "BNB", "Büyük Piyasa Değeri"),
        _a("SOL-USD", "Solana", "Büyük Piyasa Değeri"),
        _a("XRP-USD", "XRP", "Büyük Piyasa Değeri"),
        _a("ADA-USD", "Cardano", "Altcoin"),
        _a("AVAX-USD", "Avalanche", "Altcoin"),
        _a("DOT-USD", "Polkadot", "Altcoin"),
        _a("LINK-USD", "Chainlink", "Altcoin"),
        _a("TRX-USD", "TRON", "Altcoin"),
        _a("TON11419-USD", "Toncoin", "Altcoin"),
        _a("LTC-USD", "Litecoin", "Altcoin"),
        _a("DOGE-USD", "Dogecoin", "Meme Coin"),
        _a("SHIB-USD", "Shiba Inu", "Meme Coin"),
    ],
}
MARKET_NAMES = {"bist": "Borsa İstanbul", "us": "ABD Borsaları", "fx": "Döviz & Emtia", "crypto": "Kripto Paralar"}
ASSET_BY_SYMBOL = {a["symbol"]: a for assets in CATALOG.values() for a in assets}
NAME_BY_SYMBOL = {s: a["name"] for s, a in ASSET_BY_SYMBOL.items()}

# Türetilmiş semboller: fiyat = bileşen1 * bileşen2 / bölen
SYNTHETIC = {
    "GRAM-ALTIN": ("GC=F", "USDTRY=X", OUNCE_GRAMS),
    "GRAM-GUMUS": ("SI=F", "USDTRY=X", OUNCE_GRAMS),
}

VALID_PERIODS = {"5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
VALID_INTERVALS = {"15m", "1h", "1d", "1wk", "1mo"}

_lock = threading.Lock()


def market_of(symbol: str) -> str:
    for market, assets in CATALOG.items():
        if any(a["symbol"] == symbol for a in assets):
            return market
    if symbol.endswith(".IS"):
        return "bist"
    if symbol.endswith("=X") or symbol.endswith("=F"):
        return "fx"
    if symbol.endswith("-USD"):
        return "crypto"
    return "us"


def currency_of(symbol: str) -> str:
    if symbol.endswith(".IS") or symbol.endswith("TRY=X") or symbol in SYNTHETIC:
        return "TRY"
    if symbol == "USDJPY=X":
        return "JPY"
    return "USD"


def _ttl(interval: str) -> int:
    return 300 if interval in ("15m", "1h") else 1800


def _clean(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v


def _synthetic_history(symbol: str, period: str, interval: str) -> list[dict]:
    a, b, div = SYNTHETIC[symbol]
    fa, fb = to_frame(history(a, period, interval)), to_frame(history(b, period, interval))
    # Vadeli işlem ve kur seansları farklı saatlerde kapanır; gün bazında eşleştir
    key = local_days if interval in ("1d", "1wk") else (lambda i: i.floor("h"))
    fa.index, fb.index = key(fa.index), key(fb.index)
    fa, fb = fa[~fa.index.duplicated(keep="last")], fb[~fb.index.duplicated(keep="last")]
    rate = fb["close"].reindex(fa.index).ffill()
    out = []
    for ts, r in fa.iterrows():
        k = rate.get(ts)
        if k is None or pd.isna(k):
            continue
        out.append({"time": int(r["time"]), "open": round(r["open"] * k / div, 4), "high": round(r["high"] * k / div, 4),
                    "low": round(r["low"] * k / div, 4), "close": round(r["close"] * k / div, 4), "volume": 0.0})
    if not out:
        raise HTTPException(404, f"{symbol} için veri hesaplanamadı.")
    return out



# ----------------------------------------------------------------------------- canlı fiyat katmanı
# Yahoo'nun günlük geçmiş verisi bazı borsalarda (ör. Borsa İstanbul) son işlem gününü bir gün geç ekliyor ya da
# bugünün mumunu boş gönderiyor. Bu yüzden her yenilemede ayrıca anlık fiyat (son fiyat, önceki kapanış, gün içi
# en yüksek/en düşük, hacim, son işlem zamanı) alınır ve günlük verinin son günü bununla tamamlanır/güncellenir.
LIVE_URL = "https://query1.finance.yahoo.com/v7/finance/spark?symbols={}&range=1d&interval=5m"
LIVE_TTL = 30  # saniye
_live_cache: dict[str, tuple[float, dict | None]] = {}


def _live_fetch(batch: list[str]) -> dict[str, dict]:
    import urllib.parse
    import urllib.request
    url = LIVE_URL.format(",".join(urllib.parse.quote(s) for s in batch))
    try:
        with yahoo.slot():
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r:
                res = json.loads(r.read())["spark"]["result"] or []
        yahoo.ok()
    except yahoo.YahooBusy:
        return {}
    except Exception as e:  # noqa: BLE001
        yahoo.fail(e)
        return {}
    out = {}
    for item in res:
        try:
            resp = item["response"][0]
            m = resp["meta"]
            price, t = m.get("regularMarketPrice"), m.get("regularMarketTime")
            if not price or not t:
                continue
            closes = [c for c in (resp.get("indicators", {}).get("quote", [{}])[0].get("close") or []) if c is not None]
            local = datetime.fromtimestamp(t + (m.get("gmtoffset") or 0), timezone.utc).date()
            out[item["symbol"]] = {
                "price": float(price), "prev_close": m.get("previousClose") or m.get("chartPreviousClose"),
                "open": float(closes[0]) if closes else None,
                "high": m.get("regularMarketDayHigh") or (max(closes) if closes else None),
                "low": m.get("regularMarketDayLow") or (min(closes) if closes else None),
                "volume": m.get("regularMarketVolume"), "time": int(t), "date": local, "gmtoffset": m.get("gmtoffset") or 0,
            }
        except Exception:
            continue
    return out


def live(symbols: list[str]) -> dict[str, dict]:
    """Anlık fiyatlar (30 sn önbellekli; 20'şerli paketler paralel). Türetilmiş semboller bileşenlerinden hesaplanır."""
    real = sorted({c for s in symbols for c in (SYNTHETIC[s][:2] if s in SYNTHETIC else (s,))})
    now = time.time()
    with _lock:
        need = [s for s in real if not (s in _live_cache and now - _live_cache[s][0] < LIVE_TTL)]
    if need:
        from concurrent.futures import ThreadPoolExecutor
        batches = [need[i:i + 20] for i in range(0, len(need), 20)]
        with ThreadPoolExecutor(max_workers=min(4, len(batches))) as ex:
            results = list(ex.map(_live_fetch, batches))
        got = {k: v for r in results for k, v in r.items()}
        with _lock:
            for s in need:
                if s in got:
                    _live_cache[s] = (now, got[s])
                elif s not in _live_cache:
                    _live_cache[s] = (now - LIVE_TTL + 10, None)  # yanıt yoksa 10 sn sonra tekrar denenir
    with _lock:
        snap = {s: _live_cache.get(s, (0, None))[1] for s in real}
    out = {}
    for s in symbols:
        if s in SYNTHETIC:
            a, b, div = SYNTHETIC[s]
            la, lb = snap.get(a), snap.get(b)
            if la and lb:
                k = lb["price"] / div
                out[s] = {"price": la["price"] * k, "prev_close": None, "open": None, "high": None, "low": None, "volume": None,
                          "time": max(la["time"], lb["time"]), "date": max(la["date"], lb["date"]), "gmtoffset": lb["gmtoffset"]}
        elif snap.get(s):
            out[s] = snap[s]
    return out


def _overlay_frame(frame: pd.DataFrame | None, lv: dict | None) -> pd.DataFrame | None:
    """Günlük veriyi anlık fiyatla tamamlar: bugünün mumu yoksa eklenir, varsa kapanışı/en yüksek/en düşüğü güncellenir."""
    if frame is None or frame.empty or not lv:
        return frame
    f = frame.copy()
    last = f.index[-1]
    last_d = last.date()
    p = lv["price"]
    if lv["date"] > last_d:
        ts = pd.Timestamp(lv["date"])
        if f.index.tz is not None:
            ts = ts.tz_localize(f.index.tz)
        row = {c: float("nan") for c in f.columns}
        row.update({"Open": lv["open"] or p, "High": max(lv["high"] or p, p), "Low": min(lv["low"] or p, p), "Close": p})
        if "Adj Close" in f.columns:
            row["Adj Close"] = p
        if "Volume" in f.columns:
            row["Volume"] = float(lv["volume"]) if lv.get("volume") else float("nan")
        f.loc[ts] = row
        _fix_prev(f, -2, lv)
    elif lv["date"] == last_d:
        _fix_prev(f, -2, lv)
        f.at[last, "Close"] = p
        if "Adj Close" in f.columns:
            f.at[last, "Adj Close"] = p
        if "High" in f.columns:
            f.at[last, "High"] = max(float(f.at[last, "High"]) if pd.notna(f.at[last, "High"]) else p, lv["high"] or p, p)
        if "Low" in f.columns:
            f.at[last, "Low"] = min(float(f.at[last, "Low"]) if pd.notna(f.at[last, "Low"]) else p, lv["low"] or p, p)
        if "Volume" in f.columns and lv.get("volume"):
            f.at[last, "Volume"] = float(lv["volume"])
    return f


def _fix_prev(f: pd.DataFrame, pos: int, lv: dict) -> None:
    """Önbellekteki önceki gün kapanışı seans içinde yakalanmış eski bir değer olabilir; Yahoo'nun resmî önceki
    kapanışı (previousClose) esas alınır. Böylece günlük değişim her zaman doğru hesaplanır."""
    pc = lv.get("prev_close")
    if not pc or len(f) < abs(pos):
        return
    idx = f.index[pos]
    old = f.at[idx, "Close"]
    if pd.notna(old) and abs(float(old) / float(pc) - 1) > 1e-6:
        f.at[idx, "Close"] = float(pc)
        if "Adj Close" in f.columns:
            f.at[idx, "Adj Close"] = float(pc)
        if "High" in f.columns and pd.notna(f.at[idx, "High"]):
            f.at[idx, "High"] = max(float(f.at[idx, "High"]), float(pc))
        if "Low" in f.columns and pd.notna(f.at[idx, "Low"]):
            f.at[idx, "Low"] = min(float(f.at[idx, "Low"]), float(pc))


def _overlay_candles(candles: list[dict], lv: dict | None) -> list[dict]:
    """Günlük mum listesini (grafikler) anlık fiyatla tamamlar."""
    if not candles or not lv:
        return candles
    off = lv.get("gmtoffset", 0)
    last = candles[-1]
    last_d = datetime.fromtimestamp(last["time"] + off, timezone.utc).date()
    p = lv["price"]
    pc = lv.get("prev_close")

    def fixed(c: dict) -> dict:
        if pc and abs(c["close"] / pc - 1) > 1e-6:
            return dict(c, close=round(pc, 6), high=round(max(c["high"], pc), 6), low=round(min(c["low"], pc), 6))
        return c
    if lv["date"] > last_d:
        candles = candles[:-1] + [fixed(last)]
        # yerel gece yarısı (borsa saat dilimi), diğer günlük mumlarla aynı biçimde
        t = int((pd.Timestamp(lv["date"]) - pd.Timestamp("1970-01-01")).total_seconds()) - off
        return candles + [{"time": t, "open": round(lv["open"] or p, 6), "high": round(max(lv["high"] or p, p), 6),
                           "low": round(min(lv["low"] or p, p), 6), "close": round(p, 6), "volume": float(lv["volume"] or 0)}]
    if lv["date"] == last_d:
        upd = dict(last, close=round(p, 6), high=round(max(last["high"], lv["high"] or p, p), 6),
                   low=round(min(last["low"], lv["low"] or p, p), 6))
        if lv.get("volume"):
            upd["volume"] = float(lv["volume"])
        prev = [fixed(candles[-2])] if len(candles) >= 2 else []
        return candles[:-2] + prev + [upd] if len(candles) >= 2 else [upd]
    return candles

def history(symbol: str, period: str = "1y", interval: str = "1d") -> list[dict]:
    """OHLCV mum verisini döndürür: [{time, open, high, low, close, volume}]. Günlük grafiklerde son gün canlı fiyattır."""
    candles = _history_raw(symbol, period, interval)
    s = symbol.upper().strip()
    if interval == "1d" and s not in SYNTHETIC:  # türetilmişler bileşenlerinin canlı verisinden hesaplanır
        try:
            candles = _overlay_candles(candles, live([s]).get(s))
        except Exception:
            pass
    return candles


def _history_raw(symbol: str, period: str = "1y", interval: str = "1d") -> list[dict]:
    if period not in VALID_PERIODS or interval not in VALID_INTERVALS:
        raise HTTPException(400, "Geçersiz periyot veya aralık.")
    symbol = symbol.upper().strip()
    if symbol in SYNTHETIC:
        return _synthetic_history(symbol, period, interval)
    with connect() as con:
        row = con.execute(
            "SELECT fetched_at, payload FROM price_cache WHERE symbol=? AND period=? AND interval=?",
            (symbol, period, interval),
        ).fetchone()
    if row and time.time() - row["fetched_at"] < _ttl(interval):
        return json.loads(row["payload"])
    if row and time.time() - row["fetched_at"] < STALE_MAX:
        # Eski kayıt hemen döndürülür, güncel veri arka planda çekilir (veri kaynağı yavaşken sayfa beklemez)
        _background(("h", symbol, period, interval), lambda: _download_history(symbol, period, interval, row))
        return json.loads(row["payload"])
    return _download_history(symbol, period, interval, row)


def _download_history(symbol: str, period: str, interval: str, row) -> list[dict]:
    try:
        with yahoo.slot():
            df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False, timeout=15)
    except yahoo.YahooBusy:
        if row:
            return json.loads(row["payload"])
        raise HTTPException(503, "Veri kaynağı şu an yoğun; birkaç dakika sonra tekrar deneyin.")
    except Exception as e:  # ağ hatası vb.
        yahoo.fail(e)
        if row:
            return json.loads(row["payload"])
        raise HTTPException(502, f"Veri kaynağına ulaşılamadı: {e}")
    if df is None or df.empty:
        yahoo.fail()  # tek sembolde boş yanıt zayıf bir işarettir; art arda gelirse kısıtlama sayılır
        if row:
            return json.loads(row["payload"])
        raise HTTPException(404, f"{symbol} için veri bulunamadı.")
    yahoo.ok()

    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    candles = [
        {
            "time": int(ts.timestamp()),
            "open": round(float(r.Open), 6),
            "high": round(float(r.High), 6),
            "low": round(float(r.Low), 6),
            "close": round(float(r.Close), 6),
            "volume": float(_clean(r.Volume) or 0),
        }
        for ts, r in df.iterrows()
    ]
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO price_cache VALUES (?, ?, ?, ?, ?)",
            (symbol, period, interval, time.time(), json.dumps(candles)),
        )
    return candles


def local_days(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Günlük mum zamanlarını borsanın yerel işlem gününe çevirir. Yahoo günlük mumları UTC olarak verir: BIST'in
    20 Ekim kapanışı "19 Ekim 21:00" görünür; doğrudan normalize() bir gün geri kaydırır. +12 saat tüm piyasalarda
    (BIST 21:00, ABD 04:00/05:00, kripto 00:00 UTC) doğru takvim gününü verir."""
    return (pd.DatetimeIndex(index) + pd.Timedelta(hours=12)).normalize()


def prefetch(symbols: list[str], period: str = "1y", interval: str = "1d") -> None:
    """Birden fazla sembolün geçmiş verisini paralel olarak önbelleğe alır (Yahoo sınırı yahoo.slot ile korunur).
    Ardından yapılan history() çağrıları bekleme yapmadan önbellekten döner."""
    syms = list(dict.fromkeys(s.upper() for s in symbols))
    if len(syms) < 2:
        return
    from concurrent.futures import ThreadPoolExecutor

    def one(s):
        try:
            _history_raw(s, period, interval)
        except Exception:
            pass
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(one, syms))


def daily_closes(symbol: str, period: str = "1y") -> pd.Series:
    """Yerel işlem gününe göre indekslenmiş günlük kapanışlar (gün başına tek değer)."""
    c = to_frame(history(symbol, period, "1d"))["close"]
    c.index = local_days(c.index)
    return c[~c.index.duplicated(keep="last")]


def to_frame(candles: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(candles)
    df.index = pd.to_datetime(df["time"], unit="s")
    return df


def _pct(closes: pd.Series, n: int):
    if len(closes) <= n:
        return None
    return (float(closes.iloc[-1]) / float(closes.iloc[-1 - n]) - 1) * 100


def _quote_from(symbol: str, frame: pd.DataFrame | None) -> dict:
    asset = ASSET_BY_SYMBOL.get(symbol, {})
    q = {"symbol": symbol, "name": asset.get("name", symbol), "sector": asset.get("sector"),
         "is_index": asset.get("index", False), "market": market_of(symbol), "currency": currency_of(symbol),
         "price": None, "change": None, "change_pct": None, "change_1w": None, "change_1m": None,
         "change_ytd": None, "change_1y": None, "high_52w": None, "low_52w": None,
         "volume": None, "volume_avg": None, "spark": []}
    if frame is None or frame.empty:
        return q
    frame = frame.dropna(subset=["Close"])
    closes = frame["Close"]
    if len(closes) < 2:
        return q
    last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
    this_year = closes[closes.index.year == closes.index[-1].year]
    prev_year = closes[closes.index.year < closes.index[-1].year]
    vol = frame["Volume"].fillna(0) if "Volume" in frame else pd.Series(dtype=float)
    q.update(
        price=last, change=last - prev, change_pct=(last / prev - 1) * 100,
        change_1w=_pct(closes, 5), change_1m=_pct(closes, 21),
        change_ytd=(last / float(prev_year.iloc[-1]) - 1) * 100 if len(prev_year) and len(this_year) else None,
        change_1y=(last / float(closes.iloc[0]) - 1) * 100,
        high_52w=float(frame["High"].max()), low_52w=float(frame["Low"].min()),
        volume=float(vol.iloc[-1]) if len(vol) and vol.iloc[-1] > 0 else None,
        volume_avg=float(vol.tail(20).mean()) if len(vol) and vol.tail(20).mean() > 0 else None,
        spark=[round(float(c), 6) for c in closes.tail(30)],
    )
    return q


_frame_cache: dict[str, tuple[float, pd.DataFrame | None]] = {}
FRAME_TTL = 60
STALE_MAX = 6 * 3600  # bu süreden eski önbellek kaydı beklemeden gösterilmez
_inflight: set = set()


def _background(key, fn) -> None:
    """Aynı iş zaten sürmüyorsa fn'i arka planda çalıştırır."""
    with _lock:
        if key in _inflight:
            return
        _inflight.add(key)

    def run():
        try:
            fn()
        except Exception:
            pass
        finally:
            with _lock:
                _inflight.discard(key)
    threading.Thread(target=run, daemon=True).start()


def daily_frames(symbols: list[str]) -> dict[str, pd.DataFrame | None]:
    """Son 1 yılın günlük verisi; son gün canlı fiyatla tamamlanmış hâliyle."""
    frames = _daily_frames_raw(symbols)
    try:
        lv = live([s for s, f in frames.items() if f is not None])
    except Exception:
        lv = {}
    return {s: _overlay_frame(f, lv.get(s)) for s, f in frames.items()}


def _daily_frames_raw(symbols: list[str]) -> dict[str, pd.DataFrame | None]:
    """Son 1 yılın günlük OHLCV verisini (yfinance sütun adlarıyla) toplu çeker ve kısa süre önbellekte tutar.
    Türetilmiş semboller (gram altın vb.) bileşenlerinden hesaplanır."""
    now = time.time()
    out, missing, stale = {}, [], []
    with _lock:
        for s in symbols:
            hit = _frame_cache.get(s)
            if hit and now - hit[0] < FRAME_TTL:
                out[s] = hit[1]
            elif hit and hit[1] is not None and now - hit[0] < STALE_MAX:
                out[s] = hit[1]  # eski veri hemen kullanılır, arka planda tazelenir
                stale.append(s)
            else:
                missing.append(s)
    if missing:
        # Bellekte yoksa diskteki son kayıt kullanılır (uygulama açılır açılmaz veriler görünsün)
        for sym, (at, frame) in _disk_load(missing).items():
            with _lock:
                _frame_cache[sym] = (at, frame)
            out[sym] = frame
            stale.append(sym)
        missing = [m for m in missing if m not in out]
    if missing and not yahoo.available():
        out.update({m: None for m in missing})  # kaynak kısıtlıyken beklenmez
        missing = []
    if stale and not missing:
        _background(("f", tuple(sorted(stale))), lambda: _fetch_frames(stale))
        return out
    if not missing:
        return out
    out.update(_fetch_frames(missing + stale))
    return out


def _disk_load(symbols: list[str]) -> dict[str, tuple[float, pd.DataFrame]]:
    try:
        with connect() as con:
            q = ",".join("?" * len(symbols))
            found = con.execute(f"SELECT symbol, fetched_at, payload FROM frame_cache WHERE symbol IN ({q})", symbols).fetchall()
    except Exception:
        return {}
    out = {}
    for r in found:
        if time.time() - r["fetched_at"] > 14 * 86400:
            continue
        try:
            d = json.loads(r["payload"])
            f = pd.DataFrame({"Open": d["o"], "High": d["h"], "Low": d["l"], "Close": d["c"], "Volume": d["v"]},
                             index=pd.to_datetime(d["t"], unit="s"))
            out[r["symbol"]] = (r["fetched_at"], f)
        except Exception:
            continue
    return out


def _disk_save(frames: dict[str, pd.DataFrame]) -> None:
    rows_ = []
    for sym, f in frames.items():
        try:
            idx = pd.DatetimeIndex(f.index)
            idx = idx.tz_localize(None) if idx.tz is not None else idx
            rnd = lambda col: [None if pd.isna(x) else round(float(x), 6) for x in f[col]] if col in f else [0.0] * len(f)
            rows_.append((sym, time.time(), json.dumps({"t": [int(t.timestamp()) for t in idx], "o": rnd("Open"), "h": rnd("High"),
                                                         "l": rnd("Low"), "c": rnd("Close"), "v": rnd("Volume")})))
        except Exception:
            continue
    if rows_:
        try:
            with connect() as con:
                con.executemany("INSERT OR REPLACE INTO frame_cache VALUES (?,?,?)", rows_)
        except Exception:
            pass


def _fetch_frames(missing: list[str]) -> dict[str, pd.DataFrame | None]:
    now = time.time()
    out: dict[str, pd.DataFrame | None] = {}
    real = sorted({c for s in missing for c in (SYNTHETIC[s][:2] if s in SYNTHETIC else (s,))})
    try:
        with yahoo.slot():
            data = yf.download(real, period="1y", interval="1d", group_by="ticker",
                               auto_adjust=False, progress=False, threads=True, timeout=15)
    except yahoo.YahooBusy:
        data = None
    except Exception as e:
        yahoo.fail(e)
        data = None

    def frame_of(sym):
        if data is None or data.empty:
            return None
        if isinstance(data.columns, pd.MultiIndex):
            if sym not in data.columns.get_level_values(0):
                return None
            f = data[sym].dropna(subset=["Close"])
        else:
            f = data.dropna(subset=["Close"])
        return f if len(f) else None

    for s in missing:
        if s in SYNTHETIC:
            a, b, div = SYNTHETIC[s]
            fa, fb = frame_of(a), frame_of(b)
            frame = None
            if fa is not None and fb is not None:
                k = fb["Close"].reindex(fa.index).ffill()
                frame = pd.DataFrame({c: fa[c] * k / div for c in ("Open", "High", "Low", "Close")}).dropna()
                frame["Volume"] = 0.0
        else:
            frame = frame_of(s)
        with _lock:
            prev = _frame_cache.get(s)
            if frame is not None:
                _frame_cache[s] = (now, frame)
            elif prev is not None and prev[1] is not None:
                frame = prev[1]  # kaynak yanıt vermediyse eldeki veri korunur, 30 sn sonra tekrar denenir
                _frame_cache[s] = (now - FRAME_TTL + 30, frame)
            else:
                _frame_cache[s] = (now - FRAME_TTL + 30, None)  # veri yok: 30 sn boyunca tekrar beklenmez
        out[s] = frame
    # Kısıtlama tespiti: çok sembollü isteğin tamamı boş döndüyse kaynak bizi kısıtlıyordur
    got = {s: f for s, f in out.items() if f is not None and _frame_cache.get(s, (0,))[0] == now}
    if data is not None:
        if got:
            yahoo.ok()
        elif len(real) >= 3:
            yahoo.fail(strong=True)
        else:
            yahoo.fail()
    if got:
        _disk_save(got)
    return out


def invalidate(symbols: list[str] | None = None) -> None:
    """Manuel yenilemede önbelleği temizler (symbols verilmezse tümü)."""
    with _lock:
        if symbols is None:
            _frame_cache.clear()
        else:
            for s in symbols:
                _frame_cache.pop(s, None)
                for part in SYNTHETIC.get(s, ())[:2]:
                    _frame_cache.pop(part, None)
    with connect() as con:
        if symbols is None:
            con.execute("DELETE FROM price_cache")
        else:
            con.executemany("DELETE FROM price_cache WHERE symbol=?", [(s,) for s in symbols])


def quotes(symbols: list[str]) -> list[dict]:
    """Son fiyat; günlük, haftalık, aylık, yılbaşından bu yana ve yıllık değişim; 52 haftalık aralık ve hacim."""
    frames = daily_frames(symbols)
    return [_quote_from(s, frames.get(s)) for s in symbols]


def market_quotes(market: str) -> list[dict]:
    if market not in CATALOG:
        raise HTTPException(404, "Bilinmeyen piyasa.")
    return quotes([a["symbol"] for a in CATALOG[market]])


def search(query: str) -> list[dict]:
    q = query.strip()
    if not q:
        return []
    from . import universe

    ql = q.lower()
    entries = [{"symbol": a["symbol"], "name": a["name"], "market": m} for m, assets in CATALOG.items() for a in assets]
    seen = {e["symbol"] for e in entries}
    entries += [e for e in universe.search_entries() if e["symbol"] not in seen]
    local = [e for e in entries if ql in e["symbol"].lower() or ql in e["name"].lower()]
    local.sort(key=lambda e: (not e["symbol"].lower().startswith(ql), e["symbol"]))
    try:
        remote = yf.Search(q, max_results=8).quotes
        for r in remote:
            sym = r.get("symbol")
            if sym and not any(x["symbol"] == sym for x in local):
                local.append({"symbol": sym, "name": r.get("shortname") or r.get("longname") or sym,
                              "market": market_of(sym)})
    except Exception:
        pass
    return local[:15]
