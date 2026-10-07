"""Tüm hisseler: Borsa İstanbul'da işlem gören tüm paylar ve S&P 500 bileşenleri.

Yüzlerce hisse için 1 yıllık günlük kapanışlar Yahoo'nun toplu "spark" servisinden
20'şerli paketler halinde paralel çekilir. Sonuç SQLite'a kaydedilir; sayfa her
açıldığında son kayıt anında gösterilir ve süresi geçmişse arka planda yenilenir.
"""
import json
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from . import market
from .db import connect

_DATA = json.loads((Path(__file__).resolve().parent / "data" / "universe.json").read_text(encoding="utf-8"))
UNIVERSE = {"bist": _DATA["bist"], "us": _DATA["us"]}
STALE_AFTER = 300  # saniye
SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark?symbols={}&range=1y&interval=1d"

_state: dict[str, dict] = {k: {"refreshing": False, "error": None} for k in UNIVERSE}
_lock = threading.Lock()

for key, items in UNIVERSE.items():
    for a in items:
        if a["symbol"] in market.ASSET_BY_SYMBOL:
            a["sector"] = market.ASSET_BY_SYMBOL[a["symbol"]].get("sector") or a.get("sector")
        a.setdefault("sector", "Diğer")


def _init_table():
    with connect() as con:
        con.execute("CREATE TABLE IF NOT EXISTS universe_cache (market TEXT PRIMARY KEY, fetched_at REAL, payload TEXT)")
        # Teknik tarama için tüm hisselerin 1 yıllık günlük kapanışları
        con.execute("CREATE TABLE IF NOT EXISTS universe_closes (market TEXT PRIMARY KEY, fetched_at REAL, payload TEXT)")


def _spark(batch: list[str]) -> list[dict]:
    req = urllib.request.Request(SPARK_URL.format(",".join(batch)), headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())["spark"]["result"] or []
        except Exception:
            time.sleep(1 + attempt)
    return []


def _quote(asset: dict, item: dict | None, mkt: str) -> dict:
    q = {"symbol": asset["symbol"], "name": asset["name"], "sector": asset.get("sector"), "is_index": False,
         "market": mkt, "currency": market.currency_of(asset["symbol"]), "price": None, "change": None, "change_pct": None,
         "change_1w": None, "change_1m": None, "change_ytd": None, "change_1y": None, "high_52w": None, "low_52w": None,
         "volume": None, "volume_avg": None, "spark": []}
    try:
        resp = item["response"][0]
        closes = pd.Series(resp["indicators"]["quote"][0]["close"], index=pd.to_datetime(resp["timestamp"], unit="s")).dropna()
    except Exception:
        return q
    if len(closes) < 2:
        return q
    last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
    prev_year = closes[closes.index.year < closes.index[-1].year]

    def pct(n):
        return (last / float(closes.iloc[-1 - n]) - 1) * 100 if len(closes) > n else None

    q.update(price=last, change=last - prev, change_pct=(last / prev - 1) * 100, change_1w=pct(5), change_1m=pct(21),
             change_ytd=(last / float(prev_year.iloc[-1]) - 1) * 100 if len(prev_year) else None,
             change_1y=(last / float(closes.iloc[0]) - 1) * 100, high_52w=float(closes.max()), low_52w=float(closes.min()),
             spark=[round(float(c), 6) for c in closes.tail(30)])
    return q


def _refresh(mkt: str) -> None:
    try:
        assets = UNIVERSE[mkt]
        batches = [assets[i:i + 20] for i in range(0, len(assets), 20)]
        with ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(lambda b: _spark([a["symbol"] for a in b]), batches))
        by_sym = {r["symbol"]: r for batch in results for r in batch}
        quotes = [_quote(a, by_sym.get(a["symbol"]), mkt) for a in assets]
        if sum(q["price"] is not None for q in quotes) < len(quotes) * 0.3:
            raise RuntimeError("Veri sağlayıcıdan yeterli yanıt alınamadı.")
        _init_table()
        with connect() as con:
            con.execute("INSERT OR REPLACE INTO universe_cache VALUES (?,?,?)", (mkt, time.time(), json.dumps(quotes)))
            series = {}
            for sym, item in by_sym.items():
                try:
                    resp = item["response"][0]
                    pairs = [(t, c) for t, c in zip(resp["timestamp"], resp["indicators"]["quote"][0]["close"]) if c is not None]
                    if len(pairs) >= 30:
                        series[sym] = {"t": [p[0] for p in pairs], "c": [round(p[1], 6) for p in pairs]}
                except Exception:
                    continue
            con.execute("INSERT OR REPLACE INTO universe_closes VALUES (?,?,?)", (mkt, time.time(), json.dumps(series)))
        _state[mkt]["error"] = None
    except Exception as e:  # noqa: BLE001
        _state[mkt]["error"] = str(e)
    finally:
        _state[mkt]["refreshing"] = False


def refresh_async(mkt: str) -> None:
    with _lock:
        if _state[mkt]["refreshing"]:
            return
        _state[mkt]["refreshing"] = True
    threading.Thread(target=_refresh, args=(mkt,), daemon=True).start()


def all_quotes(mkt: str, force: bool = False, wait: bool = False) -> dict:
    """Kayıtlı son veriyi hemen döndürür; eskiyse veya force ise arka planda yeniler.
    Hiç kayıt yoksa (ilk açılış) yenilemenin bitmesi beklenir."""
    if mkt not in UNIVERSE:
        raise KeyError(mkt)
    _init_table()
    with connect() as con:
        row = con.execute("SELECT fetched_at, payload FROM universe_cache WHERE market=?", (mkt,)).fetchone()
    stale = row is None or time.time() - row["fetched_at"] > STALE_AFTER
    if force or stale:
        refresh_async(mkt)
    if row is None or wait:
        while _state[mkt]["refreshing"]:
            time.sleep(0.3)
        with connect() as con:
            row = con.execute("SELECT fetched_at, payload FROM universe_cache WHERE market=?", (mkt,)).fetchone()
    if row is None:
        return {"quotes": [], "fetched_at": None, "refreshing": False, "error": _state[mkt]["error"], "count": len(UNIVERSE[mkt])}
    return {"quotes": json.loads(row["payload"]), "fetched_at": row["fetched_at"], "refreshing": _state[mkt]["refreshing"],
            "error": _state[mkt]["error"], "count": len(UNIVERSE[mkt])}


def search_entries() -> list[dict]:
    return [{"symbol": a["symbol"], "name": a["name"], "market": m} for m, items in UNIVERSE.items() for a in items]


_closes_mem: dict[str, tuple[float, dict]] = {}


def closes(mkt: str) -> tuple[dict[str, pd.Series], float | None]:
    """Tüm hisselerin günlük kapanış serileri (tarama için). Eskiyse arka planda yenilenir;
    hiç kayıt yoksa (ilk kullanım) yenilemenin bitmesi beklenir."""
    all_quotes(mkt)
    _init_table()

    def read():
        with connect() as con:
            return con.execute("SELECT fetched_at, payload FROM universe_closes WHERE market=?", (mkt,)).fetchone()
    row = read()
    if row is None:
        all_quotes(mkt, force=True, wait=True)
        row = read()
    if row is None:
        return {}, None
    hit = _closes_mem.get(mkt)
    if hit and hit[0] == row["fetched_at"]:
        return hit[1], row["fetched_at"]
    data = json.loads(row["payload"])
    out = {sym: pd.Series(v["c"], index=pd.to_datetime(v["t"], unit="s")) for sym, v in data.items()}
    _closes_mem[mkt] = (row["fetched_at"], out)
    return out, row["fetched_at"]


def asset(symbol: str) -> dict | None:
    for items in UNIVERSE.values():
        for a in items:
            if a["symbol"] == symbol:
                return a
    return None
