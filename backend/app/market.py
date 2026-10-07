"""Piyasa verisi toplama ve önbellekleme.

BIST, ABD hisseleri, döviz/emtia ve kripto verileri Yahoo Finance (yfinance)
üzerinden tek tip sembollerle çekilir (ör. THYAO.IS, AAPL, USDTRY=X, BTC-USD).
Gram altın / gram gümüş gibi Türkiye'ye özgü fiyatlar, ons fiyatı ve USD/TRY
kurundan hesaplanan "türetilmiş" sembollerdir. Çekilen mum verileri SQLite'taki
price_cache tablosunda kısa süreli saklanır.
"""
import json
import math
import threading
import time

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

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
    key = (lambda i: i.normalize()) if interval in ("1d", "1wk") else (lambda i: i.floor("h"))
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


def history(symbol: str, period: str = "1y", interval: str = "1d") -> list[dict]:
    """OHLCV mum verisini döndürür: [{time, open, high, low, close, volume}]."""
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

    try:
        df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
    except Exception as e:  # ağ hatası vb.
        if row:
            return json.loads(row["payload"])
        raise HTTPException(502, f"Veri kaynağına ulaşılamadı: {e}")
    if df is None or df.empty:
        if row:
            return json.loads(row["payload"])
        raise HTTPException(404, f"{symbol} için veri bulunamadı.")

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


def daily_frames(symbols: list[str]) -> dict[str, pd.DataFrame | None]:
    """Son 1 yılın günlük OHLCV verisini (yfinance sütun adlarıyla) toplu çeker ve kısa süre önbellekte tutar.
    Türetilmiş semboller (gram altın vb.) bileşenlerinden hesaplanır."""
    now = time.time()
    out, missing = {}, []
    with _lock:
        for s in symbols:
            hit = _frame_cache.get(s)
            if hit and now - hit[0] < FRAME_TTL:
                out[s] = hit[1]
            else:
                missing.append(s)
    if not missing:
        return out

    real = sorted({c for s in missing for c in (SYNTHETIC[s][:2] if s in SYNTHETIC else (s,))})
    try:
        data = yf.download(real, period="1y", interval="1d", group_by="ticker",
                           auto_adjust=False, progress=False, threads=True)
    except Exception:
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
        out[s] = frame
        if frame is not None:
            with _lock:
                _frame_cache[s] = (now, frame)
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
