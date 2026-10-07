"""Portföy: işlem (alış/satış) kayıtlarından pozisyonlar, TL bazında değer ve performans,
risk ölçümleri, kıyaslama endeksleri, temettüler, hedef dağılım ve portföy danışmanı.

Maliyet hesabında ağırlıklı ortalama maliyet yöntemi kullanılır. Yabancı para birimli
varlıkların TL maliyeti, her işlemin tarihindeki kurla hesaplanır.
"""
import json
import threading
import time
from datetime import datetime

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from . import assistant, market
from .db import connect, rows

FX_TO_TRY = {"USD": "USDTRY=X", "EUR": "EURTRY=X", "JPY": "JPYTRY=X"}
BENCHMARKS = {"XU100.IS": "BIST 100", "^GSPC": "S&P 500 (TL)", "GRAM-ALTIN": "Gram Altın", "USDTRY=X": "Dolar/TL"}
CATEGORIES = {"bist": "Borsa İstanbul", "us": "ABD Borsaları", "fx": "Döviz & Emtia", "crypto": "Kripto Paralar"}
DEFAULT_HOLD_DAYS = 365  # tarihi girilmemiş işlemler için varsayılan elde tutma süresi


# ----------------------------------------------------------------------------- yardımcılar
def _closes(symbol: str, period: str) -> pd.Series:
    df = market.to_frame(market.history(symbol, period, "1d"))
    s = df["close"]
    s.index = s.index.normalize()
    return s[~s.index.duplicated(keep="last")]


def _tx_date(tx: dict, today: pd.Timestamp) -> pd.Timestamp:
    try:
        return pd.Timestamp(tx["date"]).normalize() if tx.get("date") else today - pd.Timedelta(days=DEFAULT_HOLD_DAYS)
    except Exception:
        return today - pd.Timedelta(days=DEFAULT_HOLD_DAYS)


class FxRates:
    """İşlem tarihindeki ve bugünkü kurlar (TL karşılığı)."""

    def __init__(self, currencies: set[str], period: str = "5y"):
        self.series = {}
        for c in currencies - {"TRY"}:
            if c in FX_TO_TRY:
                try:
                    self.series[c] = _closes(FX_TO_TRY[c], period)
                except Exception:
                    pass

    def at(self, cur: str, d: pd.Timestamp | None = None) -> float | None:
        if cur == "TRY":
            return 1.0
        s = self.series.get(cur)
        if s is None or s.empty:
            return None
        if d is None:
            return float(s.iloc[-1])
        before = s[s.index <= d]
        return float(before.iloc[-1]) if len(before) else float(s.iloc[0])


def transactions(uid: int) -> list[dict]:
    with connect() as con:
        return rows(con.execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY COALESCE(date, '0000-00-00'), id", (uid,)))


def holding(uid: int, symbol: str) -> float:
    return sum(t["quantity"] if t["side"] == "buy" else -t["quantity"] for t in transactions(uid) if t["symbol"] == symbol)


def add_transaction(uid: int, tx: dict) -> dict:
    """Alış/satış işlemini sanal hesap bakiyesi ve eldeki adetle doğrulayıp kaydeder."""
    from . import account

    symbol = tx["symbol"].upper().strip()
    if tx["side"] == "sell":
        held = holding(uid, symbol)
        if held <= 1e-9:
            raise HTTPException(400, f"{symbol} portföyünüzde yok; satış yapılamaz.")
        if tx["quantity"] > held + 1e-9:
            raise HTTPException(400, f"Yetersiz adet: elinizde {held:g} adet {symbol} var.")
    prep = account.prepare_trade(uid, {**tx, "symbol": symbol})
    with connect() as con:
        cur = con.execute(
            "INSERT INTO transactions (user_id, symbol, side, quantity, price, date, fee, note, funded, amount_try, settle_date, "
            "reason, emotion, tag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (uid, symbol, tx["side"], tx["quantity"], tx["price"], prep["date"], tx.get("fee") or 0, tx.get("note"),
             prep["funded"], prep["amount_try"], prep["settle_date"], tx.get("reason"), tx.get("emotion"), tx.get("tag")))
    return {"id": cur.lastrowid, **prep}


# ----------------------------------------------------------------------------- pozisyonlar
def positions(uid: int) -> dict:
    """Açık pozisyonlar (ortalama maliyetle), gerçekleşen kâr/zarar ve işlem geçmişi."""
    txs = transactions(uid)
    if not txs:
        return {"items": [], "totals": {}, "transactions": [], "realized": {"total_try": 0, "by_symbol": []}}
    today = pd.Timestamp(datetime.now().date())
    fx = FxRates({market.currency_of(t["symbol"]) for t in txs})

    book: dict[str, dict] = {}
    history_rows = []
    for t in txs:
        sym, cur = t["symbol"], market.currency_of(t["symbol"])
        d = _tx_date(t, today)
        rate = fx.at(cur, d) or 1.0
        b = book.setdefault(sym, {"qty": 0.0, "cost": 0.0, "cost_try": 0.0, "realized": 0.0, "realized_try": 0.0,
                                  "first_date": t.get("date"), "currency": cur})
        row = {**t, "currency": cur, "realized_pnl": None, "realized_pnl_try": None}
        if t["side"] == "buy":
            if b["qty"] <= 1e-9:
                b["first_date"] = t.get("date")
            b["qty"] += t["quantity"]
            b["cost"] += t["quantity"] * t["price"] + t["fee"]
            b["cost_try"] += (t["quantity"] * t["price"] + t["fee"]) * rate
        else:
            avg = b["cost"] / b["qty"] if b["qty"] else 0
            avg_try = b["cost_try"] / b["qty"] if b["qty"] else 0
            proceeds = t["quantity"] * t["price"] - t["fee"]
            pnl = proceeds - avg * t["quantity"]
            pnl_try = proceeds * rate - avg_try * t["quantity"]
            b["realized"] += pnl
            b["realized_try"] += pnl_try
            b["qty"] -= t["quantity"]
            b["cost"] -= avg * t["quantity"]
            b["cost_try"] -= avg_try * t["quantity"]
            row.update(realized_pnl=pnl, realized_pnl_try=pnl_try)
        history_rows.append(row)

    open_syms = [s for s, b in book.items() if b["qty"] > 1e-9]
    qs = {q["symbol"]: q for q in market.quotes(open_syms)} if open_syms else {}
    items, totals = [], {}
    for sym in open_syms:
        b, q = book[sym], qs.get(sym, {})
        price, cur = q.get("price"), b["currency"]
        value = b["qty"] * price if price is not None else None
        items.append({
            "id": sym, "symbol": sym, "name": q.get("name", market.NAME_BY_SYMBOL.get(sym, sym)), "currency": cur,
            "market": market.market_of(sym), "quantity": b["qty"], "buy_price": b["cost"] / b["qty"], "buy_date": b["first_date"],
            "price": price, "cost": b["cost"], "cost_try": b["cost_try"], "value": value,
            "pnl": (value - b["cost"]) if value is not None else None,
            "pnl_pct": ((value / b["cost"] - 1) * 100) if value is not None and b["cost"] else None,
            "day_change_pct": q.get("change_pct"), "realized": b["realized"],
        })
        t = totals.setdefault(cur, {"cost": 0.0, "value": 0.0})
        t["cost"] += b["cost"]
        t["value"] += value if value is not None else b["cost"]
    for t in totals.values():
        t["pnl"] = t["value"] - t["cost"]
        t["pnl_pct"] = (t["value"] / t["cost"] - 1) * 100 if t["cost"] else 0

    realized = [{"symbol": s, "currency": b["currency"], "realized": b["realized"], "realized_try": b["realized_try"]}
                for s, b in book.items() if abs(b["realized"]) > 1e-9]
    return {"items": items, "totals": totals, "transactions": list(reversed(history_rows)),
            "realized": {"total_try": sum(r["realized_try"] for r in realized), "by_symbol": realized}}


# ----------------------------------------------------------------------------- temettüler
_div_cache: dict[str, tuple[float, pd.Series]] = {}
_div_lock = threading.Lock()


def _dividends(symbol: str) -> pd.Series:
    with _div_lock:
        hit = _div_cache.get(symbol)
    if hit and time.time() - hit[0] < 12 * 3600:
        return hit[1]
    try:
        s = yf.Ticker(symbol).dividends
        s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
    except Exception:
        s = pd.Series(dtype=float)
    with _div_lock:
        _div_cache[symbol] = (time.time(), s)
    return s


def dividends(uid: int) -> dict:
    """Elde tutulan hisselerin geçmişte ödediği temettüler (hak kullanım tarihindeki adetle) ve son 12 ay verimi."""
    txs = transactions(uid)
    today = pd.Timestamp(datetime.now().date())
    stocks = sorted({t["symbol"] for t in txs if market.market_of(t["symbol"]) in ("bist", "us")
                     and not market.ASSET_BY_SYMBOL.get(t["symbol"], {}).get("index")})
    fx = FxRates({market.currency_of(s) for s in stocks})
    qs = {q["symbol"]: q for q in market.quotes(stocks)} if stocks else {}
    payments, yields = [], []
    for sym in stocks:
        divs = _dividends(sym)
        cur = market.currency_of(sym)
        sym_txs = [(t, _tx_date(t, today)) for t in txs if t["symbol"] == sym]
        for d, amount in divs.items():
            qty = sum(t["quantity"] if t["side"] == "buy" else -t["quantity"] for t, td in sym_txs if td < d)
            if qty > 1e-9:
                total = qty * float(amount)
                payments.append({"symbol": sym, "date": d.strftime("%Y-%m-%d"), "per_share": float(amount), "quantity": qty,
                                 "amount": total, "currency": cur, "amount_try": total * (fx.at(cur, d) or 1.0)})
        last12 = divs[divs.index > today - pd.Timedelta(days=365)].sum() if len(divs) else 0
        price = qs.get(sym, {}).get("price")
        if price:
            yields.append({"symbol": sym, "name": market.NAME_BY_SYMBOL.get(sym, sym), "currency": cur,
                           "ttm_per_share": float(last12), "yield_pct": float(last12) / price * 100,
                           "last_date": divs.index[-1].strftime("%Y-%m-%d") if len(divs) else None})
    payments.sort(key=lambda x: x["date"], reverse=True)
    return {"payments": payments, "total_try": sum(p["amount_try"] for p in payments), "yields": yields}


# ----------------------------------------------------------------------------- hedef dağılım
def get_targets(uid: int) -> dict:
    with connect() as con:
        return {r["category"]: r["target_pct"] for r in con.execute("SELECT * FROM targets WHERE user_id=?", (uid,))}


def set_targets(uid: int, targets: dict[str, float]) -> dict:
    clean = {k: float(v) for k, v in targets.items() if k in CATEGORIES and v is not None and float(v) > 0}
    if sum(clean.values()) > 100.0001:
        raise HTTPException(400, "Hedeflerin toplamı %100'ü geçemez.")
    with connect() as con:
        con.execute("DELETE FROM targets WHERE user_id=?", (uid,))
        con.executemany("INSERT INTO targets VALUES (?,?,?)", [(uid, k, v) for k, v in clean.items()])
    return clean


# ----------------------------------------------------------------------------- analitik
def analytics(uid: int) -> dict:
    txs = transactions(uid)
    pos = positions(uid)
    if not pos["items"]:
        return {"empty": True, "realized_try": pos["realized"]["total_try"]}

    today = pd.Timestamp(datetime.now().date())
    start = max(min(_tx_date(t, today) for t in txs), today - pd.Timedelta(days=730))
    period = "2y" if start < today - pd.Timedelta(days=360) else "1y"
    fx = FxRates({"USD"} | {i["currency"] for i in pos["items"]} | {market.currency_of(t["symbol"]) for t in txs}, period)
    usd = fx.series["USD"]
    index = usd.index[usd.index >= start]
    if len(index) < 5:
        index = usd.index[-60:]

    # Her sembolün günlük TL fiyatı ve elde tutulan adedi (işlemlerden)
    px, qty = {}, {}
    for sym in sorted({t["symbol"] for t in txs}):
        cur = market.currency_of(sym)
        if cur != "TRY" and cur not in fx.series:
            continue
        try:
            p = _closes(sym, period).reindex(index).ffill()
        except Exception:
            continue
        px[sym] = p if cur == "TRY" else p * fx.series[cur].reindex(index).ffill()
        q = pd.Series(0.0, index=index)
        for t in txs:
            if t["symbol"] == sym:
                q[q.index >= _tx_date(t, today)] += t["quantity"] if t["side"] == "buy" else -t["quantity"]
        qty[sym] = q
    prices, quantities = pd.DataFrame(px), pd.DataFrame(qty)
    values = (prices * quantities).where(quantities > 1e-9)
    total = values.sum(axis=1, min_count=1).dropna()

    # Zaman ağırlıklı getiri: önceki günün pozisyon değerleriyle ağırlıklandırılmış fiyat getirileri
    w = values.shift(1)
    port_ret = ((prices.pct_change(fill_method=None) * w).sum(axis=1) / w.sum(axis=1).replace(0, np.nan)).fillna(0)
    port_ret = port_ret[port_ret.index >= total.index[0]] if len(total) else port_ret
    perf = (1 + port_ret).cumprod() - 1

    bench = {}
    for sym, label in BENCHMARKS.items():
        try:
            s = _closes(sym, period)
            if market.currency_of(sym) == "USD":
                s = s.reindex(usd.index).ffill() * usd
            s = s.reindex(perf.index).ffill().dropna()
            if len(s):
                bench[label] = s / s.iloc[0] - 1
        except Exception:
            pass

    current = []
    for i in pos["items"]:
        rate = fx.at(i["currency"]) or 1.0
        current.append({**i, "value_try": (i["value"] if i["value"] is not None else i["cost"]) * rate})
    total_value = sum(c["value_try"] for c in current)
    total_cost = sum(c["cost_try"] for c in current)
    day_change = sum(c["value_try"] * c["day_change_pct"] / (100 + c["day_change_pct"])
                     for c in current if c["day_change_pct"] is not None)

    r = port_ret.iloc[1:]
    eq = (1 + r).cumprod()
    beta = None
    if "BIST 100" in bench and len(r) > 20:
        b = bench["BIST 100"].add(1).pct_change().reindex(r.index).fillna(0)
        beta = float(r.cov(b) / b.var()) if b.var() > 0 else None
    risk = {
        "volatility_pct": float(r.std() * np.sqrt(252) * 100) if len(r) > 2 else None,
        "max_drawdown_pct": float((eq / eq.cummax() - 1).min() * 100) if len(eq) else None,
        "sharpe": float(r.mean() / r.std() * np.sqrt(252)) if len(r) > 2 and r.std() > 0 else None,
        "beta_bist100": beta,
        "var95_try": float(-np.percentile(r, 5) * total_value) if len(r) > 20 else None,
        "best_day_pct": float(r.max() * 100) if len(r) else None,
        "worst_day_pct": float(r.min() * 100) if len(r) else None,
    }

    def alloc(key):
        agg = {}
        for c in current:
            agg[key(c)] = agg.get(key(c), 0) + c["value_try"]
        return [{"label": k, "value": v, "pct": v / total_value * 100} for k, v in sorted(agg.items(), key=lambda x: -x[1])]

    targets = get_targets(uid)
    by_cat = {k: 0.0 for k in CATEGORIES}
    for c in current:
        by_cat[c["market"]] = by_cat.get(c["market"], 0) + c["value_try"]
    rebalance = [{"category": k, "label": CATEGORIES[k], "current_pct": by_cat[k] / total_value * 100,
                  "target_pct": targets.get(k), "diff_pct": (by_cat[k] / total_value * 100 - targets[k]) if k in targets else None,
                  "amount_try": (targets[k] / 100 * total_value - by_cat[k]) if k in targets else None}
                 for k in CATEGORIES]

    def pts(s: pd.Series, scale=1.0):
        return [{"time": int(t.timestamp()), "value": round(float(v) * scale, 4)} for t, v in s.items() if pd.notna(v)]

    return {
        "empty": False,
        "usdtry": float(usd.iloc[-1]),
        "totals": {"value_try": total_value, "cost_try": total_cost, "pnl_try": total_value - total_cost,
                   "pnl_pct": (total_value / total_cost - 1) * 100 if total_cost else 0,
                   "value_usd": total_value / float(usd.iloc[-1]), "day_change_try": day_change},
        "realized_try": pos["realized"]["total_try"],
        "value_series": pts(total),
        "performance": {"Portföy": pts(perf, 100), **{k: pts(v, 100) for k, v in bench.items()}},
        "period_return_pct": float(perf.iloc[-1] * 100) if len(perf) else None,
        "benchmark_returns": {k: float(v.iloc[-1] * 100) for k, v in bench.items()},
        "risk": risk,
        "allocation": {
            "market": alloc(lambda c: CATEGORIES.get(c["market"], c["market"])),
            "currency": alloc(lambda c: c["currency"]),
            "asset": alloc(lambda c: c["symbol"]),
        },
        "targets": targets,
        "rebalance": rebalance,
        "start": int(perf.index[0].timestamp()) if len(perf) else None,
    }


# ----------------------------------------------------------------------------- danışman
def advisor(uid: int) -> dict:
    an = analytics(uid)
    if an.get("empty"):
        return {"observations": [], "llm_text": None, "source": None}
    obs = []

    def add(level, title, text):
        obs.append({"level": level, "title": title, "text": text})

    assets = an["allocation"]["asset"]
    top = assets[0]
    if top["pct"] > 40:
        add("warn", "Yüksek yoğunlaşma", f"Portföyün %{top['pct']:.0f}'i tek bir varlıkta ({top['label']}). "
            "Tek varlığa bağımlılık, o varlıktaki sert bir düşüşün portföyü orantısız etkilemesine yol açabilir.")
    elif top["pct"] > 25:
        add("info", "Belirgin ağırlık", f"En büyük pozisyon {top['label']} (%{top['pct']:.0f}).")
    if len(assets) < 4:
        add("info", "Sınırlı çeşitlendirme", f"Portföyde {len(assets)} farklı varlık var. Varlık sayısı arttıkça tekil riskler azalır.")
    else:
        add("ok", "Çeşitlendirme", f"Portföy {len(assets)} farklı varlığa dağılmış.")

    markets = an["allocation"]["market"]
    if markets and markets[0]["pct"] > 80:
        add("warn", "Tek piyasaya bağımlılık", f"Değerin %{markets[0]['pct']:.0f}'i {markets[0]['label']} piyasasında.")
    try_share = next((c["pct"] for c in an["allocation"]["currency"] if c["label"] == "TRY"), 0)
    if try_share > 90:
        add("info", "Kur riski", "Portföy neredeyse tamamen TL varlıklardan oluşuyor; TL'deki değer kaybına karşı korunma sınırlı.")
    elif try_share < 20:
        add("info", "Döviz ağırlığı", f"Portföyün yalnızca %{try_share:.0f}'i TL varlıklarda; kur hareketleri TL getiriyi belirgin etkiler.")

    risk = an["risk"]
    vol = risk.get("volatility_pct")
    if vol is not None:
        level = "warn" if vol > 40 else "info" if vol > 25 else "ok"
        add(level, "Oynaklık", f"Yıllık oynaklık %{vol:.1f}. " + ("Bu oldukça yüksek bir risk düzeyidir." if vol > 40 else
                                                                  "Orta düzey risk." if vol > 25 else "Görece düşük risk."))
    dd = risk.get("max_drawdown_pct")
    if dd is not None and dd < -25:
        add("warn", "Derin geri çekilme", f"Dönem içinde zirveden en büyük düşüş %{abs(dd):.1f} oldu.")
    if risk.get("beta_bist100") is not None:
        b = risk["beta_bist100"]
        add("info", "Piyasa duyarlılığı", f"BIST 100'e göre beta {b:.2f}: endeks %1 hareket ettiğinde portföy ortalama %{abs(b):.2f} "
            + ("aynı yönde" if b >= 0 else "ters yönde") + " hareket etmiş.")
    if an["period_return_pct"] is not None and "BIST 100" in an["benchmark_returns"]:
        diff = an["period_return_pct"] - an["benchmark_returns"]["BIST 100"]
        add("ok" if diff >= 0 else "info", "Endekse göre performans",
            f"Portföy dönem içinde BIST 100'ün {abs(diff):.1f} puan {'üzerinde' if diff >= 0 else 'altında'} getiri sağladı.")
    for rb in an["rebalance"]:
        if rb["target_pct"] is not None and abs(rb["diff_pct"]) > 5:
            add("warn", "Hedef dağılımdan sapma",
                f"{rb['label']}: mevcut %{rb['current_pct']:.0f}, hedef %{rb['target_pct']:.0f}. "
                f"Hedefe dönmek için yaklaşık {f'{abs(rb['amount_try']):,.0f}'.replace(',', '.')} TL "
                f"{'alım' if rb['amount_try'] > 0 else 'satış'} gerekir.")

    llm_text, source = None, "kural tabanlı"
    key = assistant.api_key()
    if key:
        try:
            import anthropic

            summary = {"toplam_deger_tl": round(an["totals"]["value_try"]), "kar_zarar_yuzde": round(an["totals"]["pnl_pct"], 1),
                       "donem_getirisi": an["period_return_pct"], "kiyaslar": an["benchmark_returns"], "risk": risk,
                       "dagilim_varlik": assets, "dagilim_piyasa": markets, "dagilim_para": an["allocation"]["currency"],
                       "hedef_dagilim": an["rebalance"]}
            resp = anthropic.Anthropic(api_key=key).messages.create(
                model=assistant.load_settings().get("model") or assistant.DEFAULT_MODEL, max_tokens=900,
                system=assistant.SYSTEM_PROMPT,
                messages=[{"role": "user", "content":
                           "Aşağıdaki portföy verilerini değerlendir. Yoğunlaşma, çeşitlendirme, kur riski, oynaklık ve "
                           "hedef dağılımdan sapma konularında 4-6 maddelik, eğitim amaçlı bir değerlendirme yaz. "
                           "Belirli bir varlığı alma/satma tavsiyesi verme.\n\n" + json.dumps(summary, ensure_ascii=False, default=float)}])
            llm_text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
            source = "llm"
        except Exception:
            pass
    return {"observations": obs, "llm_text": llm_text, "source": source}
