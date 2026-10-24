"""Hisse kartı: bir varlığın fiyatı, kısa grafiği, temel oranları, haberleri ve
"bugün neden hareket etti?" sorusuna sade dille cevap veren özet (tek istekte)."""
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from . import fundamentals, indicators, kap, market, news, portfolio, universe, wellness
from .db import connect


# Ek bilgiler (temel oranlar, haberler, KAP) ortak havuzda paralel çekilir; yavaş kalan parça kartı bekletmez
_pool = ThreadPoolExecutor(max_workers=6)
EXTRA_TIMEOUT = 8  # saniye


def _pct(v: float | None) -> str:
    return "—" if v is None else f"%{v:+.2f}".replace(".", ",")


def _why(sym: str, chg: float | None, vol_ratio: float | None, overall: str, rsi: float, n: dict | None,
         kap_items: list[dict], chg_1m: float | None) -> list[str]:
    """Kural tabanlı, sade Türkçe açıklama cümleleri."""
    out = []
    if chg is not None:
        move = "yatay seyrediyor" if abs(chg) < 0.3 else ("yükseldi" if chg > 0 else "düştü")
        size = "sert şekilde " if abs(chg) >= 4 else ""
        out.append(f"Bugün {size}{move} ({_pct(chg)}).")
    if vol_ratio and vol_ratio >= 1.8:
        out.append(f"İşlem hacmi normalin {vol_ratio:.1f} katı; hareketin arkasında güçlü bir ilgi var.")
    if kap_items:
        out.append(f"Son günlerde KAP'a açıklama yapıldı: \"{kap_items[0]['title']}\".")
    if n and n.get("count"):
        label = n.get("label", "").lower()
        if label in ("olumlu", "olumsuz"):
            out.append(f"Son haberlerin genel havası {label}.")
    if rsi >= 70:
        out.append("Kısa sürede çok yükseldi (RSI 70 üzeri); kâr satışları gelebilir.")
    elif rsi <= 30:
        out.append("Kısa sürede çok düştü (RSI 30 altı); tepki yükselişi gelebilir.")
    if chg_1m is not None and abs(chg_1m) >= 10:
        out.append(f"Son bir ayda {_pct(chg_1m)} {'kazandırdı' if chg_1m > 0 else 'kaybettirdi'}.")
    out.append(f"Teknik göstergelerin genel görünümü: {overall}.")
    return out


def _fund(sym: str, is_stock: bool) -> dict | None:
    if not is_stock:
        return None
    try:
        f = fundamentals.summary(sym, with_statements=False)
        r = f["ratios"]
        return {"market_cap": f.get("market_cap"), "pe": r.get("pe"), "pb": r.get("pb"), "dividend_yield": r.get("dividend_yield"),
                "roe": r.get("roe"), "profit_margin": r.get("profit_margin")}
    except Exception:
        return None


def _news(sym: str) -> dict:
    try:
        return news.get_news(sym, 8)
    except Exception:
        return {"items": [], "summary": None}


def _kap(sym: str, mkt: str) -> list[dict]:
    if mkt != "bist":
        return []
    try:
        return [{"title": d["title"], "time": d["time"], "url": d["url"]} for d in kap.for_codes([sym], 7)[:3]]
    except Exception:
        return []


def _position(uid: int, sym: str) -> dict | None:
    """Kullanıcının bu varlıktaki pozisyonu: adet, maliyet, kâr/zarar, işlem geçmişi ve bekleyen emirler."""
    txs = [t for t in portfolio.transactions(uid) if t["symbol"] == sym]
    with connect() as con:
        orders = [dict(r) for r in con.execute(
            "SELECT id, type, quantity, price, expires, created_at FROM orders WHERE user_id=? AND symbol=? AND status='open' ORDER BY id DESC", (uid, sym))]
    if not txs and not orders:
        return None
    pos = portfolio.positions(uid)
    item = next((i for i in pos["items"] if i["symbol"] == sym), None)
    realized = next((r for r in pos["realized"]["by_symbol"] if r["symbol"] == sym), None)
    day = None
    if item and item.get("value") is not None and item.get("day_change_pct") is not None:
        day = item["value"] * item["day_change_pct"] / (100 + item["day_change_pct"])
    buys = [t for t in txs if t["side"] == "buy"]
    return {
        "quantity": item["quantity"] if item else 0, "avg_cost": item["buy_price"] if item else None,
        "cost": item["cost"] if item else None, "value": item["value"] if item else None,
        "pnl": item["pnl"] if item else None, "pnl_pct": item["pnl_pct"] if item else None, "day_pnl": day,
        "realized": realized["realized"] if realized else 0, "currency": market.currency_of(sym),
        "first_buy": buys[0]["date"] if buys else None, "trade_count": len(txs),
        "buy_qty": sum(t["quantity"] for t in buys), "sell_qty": sum(t["quantity"] for t in txs if t["side"] == "sell"),
        "transactions": [{"date": t["date"], "side": t["side"], "quantity": t["quantity"], "price": t["price"], "fee": t["fee"]}
                         for t in reversed(txs[-8:])],
        "orders": orders,
        "protection": wellness.protection(uid, sym),
    }


def card(uid: int, symbol: str) -> dict:
    sym = symbol.upper()
    mkt = market.market_of(sym)
    is_stock = mkt in ("bist", "us") and not sym.startswith("^") and sym not in ("XU100.IS", "XU030.IS")
    f_fut, n_fut, k_fut = _pool.submit(_fund, sym, is_stock), _pool.submit(_news, sym), _pool.submit(_kap, sym, mkt)
    p_fut = _pool.submit(_position, uid, sym)
    candles = market.history(sym, "1y", "1d")
    df = market.to_frame(candles)
    summ = indicators.summary(df)
    c = df["close"]
    last = float(c.iloc[-1])
    chg = (last / float(c.iloc[-2]) - 1) * 100 if len(c) > 1 else None
    chg_1w = (last / float(c.iloc[-6]) - 1) * 100 if len(c) > 6 else None
    chg_1m = (last / float(c.iloc[-22]) - 1) * 100 if len(c) > 22 else None
    v = df["volume"].fillna(0)
    vol_avg = float(v.tail(21).iloc[:-1].mean()) if len(v) > 21 else 0
    vol_ratio = float(v.iloc[-1]) / vol_avg if vol_avg > 0 and v.iloc[-1] > 0 else None
    rsi = float(indicators.rsi(c).iloc[-1])
    def wait(fut, default):
        try:
            return fut.result(timeout=EXTRA_TIMEOUT)
        except (FutureTimeout, Exception):
            return default

    # Fiyat geçmişi çekilirken ek bilgiler de paralel olarak hazırlanır
    f = wait(f_fut, None)
    n = wait(n_fut, {"items": [], "summary": None})
    k = wait(k_fut, [])
    position = wait(p_fut, None)

    from .auth import family, person_of
    fam = family(uid)
    with connect() as con:  # favoriler ve alarmlar kişiye aittir (tüm portföylerde ortak)
        fav = con.execute("SELECT 1 FROM watchlist WHERE user_id=? AND symbol=?", (person_of(uid), sym)).fetchone() is not None
        alerts = con.execute(f"SELECT COUNT(*) FROM alerts WHERE user_id IN ({','.join('?' * len(fam))}) AND symbol=? AND triggered=0",
                             (*fam, sym)).fetchone()[0]
    name = market.NAME_BY_SYMBOL.get(sym) or (universe.asset(sym) or {}).get("name", sym)
    tail = df.tail(66)  # ~3 ay
    return {
        "symbol": sym, "name": name, "market": mkt, "currency": market.currency_of(sym),
        "price": last, "change_pct": chg, "change_1w": chg_1w, "change_1m": chg_1m,
        "change_1y": (last / float(c.iloc[0]) - 1) * 100,
        "high_52w": float(df["high"].max()), "low_52w": float(df["low"].min()),
        "series": [{"time": int(t), "value": float(x)} for t, x in zip(tail["time"], tail["close"])],
        "overall": summ["overall"], "rsi": rsi, "vol_ratio": vol_ratio,
        "fundamentals": f, "news": (n.get("items") or [])[:3], "news_summary": n.get("summary"), "kap": k,
        "why": _why(sym, chg, vol_ratio, summ["overall"], rsi, n.get("summary"), k, chg_1m),
        "favorite": fav, "alerts": alerts, "position": position, "as_of": int(df["time"].iloc[-1]),
    }
