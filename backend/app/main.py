"""Yerel REST API servisi (FastAPI).

Masaüstü uygulaması bu servisi localhost üzerinde çalıştırır; React arayüzü
derlenmiş hâliyle aynı sunucudan servis edilir. Swagger dokümantasyonu:
http://127.0.0.1:8765/docs
"""
import threading
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import (academy, account, ai_tools, alerts, assistant, auth, backtest, backup, bots, bulletin, econ, engine, export, fundamentals, indicators,
               insights, kap, market, ml, news, notifications, orders, patterns, portfolio, quant, screener, universe)
from .db import connect, init_db, rows

for _m, _items in universe.UNIVERSE.items():
    for _a in _items:
        market.NAME_BY_SYMBOL.setdefault(_a["symbol"], _a["name"])

app = FastAPI(title="Finansal Analiz Platformu API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    init_db()
    engine.start()

    def warm():  # teknik tarama ilk açılışta beklemesin diye tüm hisse verisi arka planda hazırlanır
        for m in ("bist", "us"):
            try:
                screener.scan_full([m], "all")
            except Exception:
                pass
    threading.Thread(target=warm, daemon=True).start()


# ---------- Şemalar ----------
class Credentials(BaseModel):
    username: str
    password: str


class WatchItem(BaseModel):
    symbol: str


class Holding(BaseModel):
    symbol: str
    quantity: float = Field(gt=0)
    buy_price: float = Field(gt=0)
    buy_date: str | None = None
    note: str | None = None


class AlertIn(BaseModel):
    symbol: str
    condition: str
    target: float | None = None
    repeat: bool = False
    note: str | None = None


class BacktestIn(BaseModel):
    symbol: str
    strategy: str
    period: str = "2y"
    params: dict = {}
    capital: float = 10000
    commission_pct: float = 0.1


class ChatIn(BaseModel):
    question: str
    symbol: str | None = None
    history: list[dict] = []


class SettingsIn(BaseModel):
    anthropic_api_key: str | None = None
    model: str | None = None
    tray_on_close: bool | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None


# ---------- Kimlik doğrulama ----------
@app.post("/api/auth/register")
def register(c: Credentials):
    return auth.register(c.username, c.password)


@app.post("/api/auth/login")
def login(c: Credentials):
    return auth.login(c.username, c.password)


@app.get("/api/auth/me")
def me(uid: int = Depends(auth.current_user)):
    with connect() as con:
        row = con.execute("SELECT id, username, created_at FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(401, "Kullanıcı bulunamadı.")
    return dict(row)


# ---------- Piyasa verisi ----------
@app.get("/api/markets")
def markets():
    return {"names": market.MARKET_NAMES, "catalog": market.CATALOG,
            "universe": {m: [{"symbol": a["symbol"], "name": a["name"]} for a in items] for m, items in universe.UNIVERSE.items()}}


@app.get("/api/market/{key}/all")
async def market_all(key: str, fresh: bool = False, _: int = Depends(auth.current_user)):
    """Borsa İstanbul'daki tüm hisseler veya S&P 500 bileşenleri (son kayıt hemen döner, arka planda yenilenir)."""
    if key not in universe.UNIVERSE:
        raise HTTPException(404, "Bu piyasa için tüm hisse listesi yok.")
    return await run_in_threadpool(universe.all_quotes, key, fresh)


@app.get("/api/overview")
async def overview(fresh: bool = False, _: int = Depends(auth.current_user)):
    symbols = [a["symbol"] for assets in market.CATALOG.values() for a in assets]
    if fresh:
        market.invalidate(symbols)
    qs = await run_in_threadpool(market.quotes, symbols)
    grouped = {m: [q for q in qs if q["market"] == m] for m in market.CATALOG}
    return {"names": market.MARKET_NAMES, "markets": grouped}


@app.get("/api/market/{key}")
async def market_detail(key: str, fresh: bool = False, _: int = Depends(auth.current_user)):
    """Tek bir piyasanın (bist, us, fx, crypto) tüm varlıkları, sektörleri ve piyasa genişliği."""
    if fresh and key in market.CATALOG:
        market.invalidate([a["symbol"] for a in market.CATALOG[key]])
    qs = await run_in_threadpool(market.market_quotes, key)
    stocks = [q for q in qs if not q["is_index"] and q["change_pct"] is not None]
    sectors: dict[str, list] = {}
    for q in stocks:
        sectors.setdefault(q["sector"], []).append(q["change_pct"])
    return {
        "key": key, "name": market.MARKET_NAMES[key], "quotes": qs,
        "breadth": {"up": sum(q["change_pct"] > 0 for q in stocks), "down": sum(q["change_pct"] < 0 for q in stocks),
                    "flat": sum(q["change_pct"] == 0 for q in stocks)},
        "sectors": sorted([{"sector": s, "avg_change_pct": sum(v) / len(v), "count": len(v)} for s, v in sectors.items()],
                          key=lambda d: -d["avg_change_pct"]),
    }


@app.get("/api/quotes")
async def quotes(symbols: str, _: int = Depends(auth.current_user)):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:40]
    return await run_in_threadpool(market.quotes, syms)


@app.get("/api/search")
async def search(q: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(market.search, q)


@app.get("/api/history/{symbol}")
async def history(symbol: str, period: str = "1y", interval: str = "1d", fresh: bool = False, _: int = Depends(auth.current_user)):
    if fresh:
        market.invalidate([symbol.upper()])
    candles = await run_in_threadpool(market.history, symbol, period, interval)
    return {"symbol": symbol.upper(), "name": market.NAME_BY_SYMBOL.get(symbol.upper(), symbol.upper()),
            "currency": market.currency_of(symbol.upper()), "candles": candles}


def _analysis(symbol: str, period: str, interval: str) -> dict:
    candles = market.history(symbol, period, interval)
    if len(candles) < 30:
        raise HTTPException(400, "Analiz için yeterli veri yok.")
    df = market.to_frame(candles)
    return {"indicators": indicators.compute_all(df), "summary": indicators.summary(df),
            "patterns": patterns.candle_patterns(df), "levels": patterns.support_resistance(df)}


@app.get("/api/analysis/{symbol}")
async def analysis(symbol: str, period: str = "1y", interval: str = "1d", _: int = Depends(auth.current_user)):
    return await run_in_threadpool(_analysis, symbol.upper(), period, interval)


@app.get("/api/mtf/{symbol}")
async def multi_timeframe(symbol: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(patterns.multi_timeframe, symbol.upper())


@app.get("/api/compare")
async def compare(symbols: str, period: str = "1y", _: int = Depends(auth.current_user)):
    """Seçilen varlıkların başlangıca göre normalize edilmiş (%) performansı ve korelasyonu."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:6]

    def work():
        import pandas as pd
        series, out = {}, []
        for s in syms:
            df = market.to_frame(market.history(s, period, "1d"))
            c = df["close"]
            c.index = c.index.normalize()
            series[s] = c[~c.index.duplicated()]
            base = float(c.iloc[0])
            out.append({"symbol": s, "name": market.NAME_BY_SYMBOL.get(s, s),
                        "points": [{"time": int(t), "value": round((float(v) / base - 1) * 100, 3)}
                                   for t, v in zip(df["time"], df["close"])],
                        "return_pct": round((float(c.iloc[-1]) / base - 1) * 100, 2),
                        "volatility_pct": round(float(c.pct_change().std() * (252 ** 0.5) * 100), 2)})
        corr = pd.DataFrame(series).ffill().pct_change().corr().round(3)
        return {"series": out, "correlation": {"symbols": list(corr.columns),
                                               "matrix": corr.fillna(0).values.tolist()}}

    return await run_in_threadpool(work)


# ---------- Yapay zekâ: tahmin ve asistan ----------
@app.get("/api/predict/{symbol}")
async def predict(symbol: str, period: str = "2y", _: int = Depends(auth.current_user)):
    def work():
        df = market.to_frame(market.history(symbol.upper(), period, "1d"))
        try:
            return ml.predict(df)
        except ValueError as e:
            raise HTTPException(400, str(e))

    return await run_in_threadpool(work)


@app.get("/api/assistant/status")
def assistant_status(_: int = Depends(auth.current_user)):
    return assistant.status()


@app.post("/api/assistant/chat")
async def chat(body: ChatIn, _: int = Depends(auth.current_user)):
    def work():
        context: dict = {}
        if body.symbol:
            sym = body.symbol.upper()
            candles = market.history(sym, "1y", "1d")
            df = market.to_frame(candles)
            context = {"symbol": sym, "name": market.NAME_BY_SYMBOL.get(sym, sym), "market": market.market_of(sym),
                       "analysis": indicators.summary(df),
                       "recent_closes": [round(c["close"], 4) for c in candles[-20:]]}
            try:
                context["news"] = [{"başlık": n["title"], "kaynak": n["source"], "duygu": n["sentiment"]}
                                   for n in news.get_news(sym, 10)["items"]]
            except Exception:
                pass
        else:
            main = ["XU100.IS", "^GSPC", "USDTRY=X", "EURTRY=X", "BTC-USD", "ETH-USD", "GC=F"]
            context["market_overview"] = [
                {"sembol": q["symbol"], "ad": q["name"], "fiyat": q["price"],
                 "günlük_değişim_%": round(q["change_pct"], 2) if q["change_pct"] is not None else None}
                for q in market.quotes(main)
            ]
        return assistant.ask(body.question, body.history, context)

    return await run_in_threadpool(work)


# ---------- Arayüz tercihleri (karşılaştırma listesi, sekmeler, tarama vb.) ----------
# Tarayıcı deposu adres/porta bağlı olduğundan tercihler kullanıcı bazında veritabanında da saklanır.
@app.get("/api/prefs")
def get_prefs(uid: int = Depends(auth.current_user)):
    with connect() as con:
        return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM user_prefs WHERE user_id=?", (uid,))}


@app.put("/api/prefs")
def put_prefs(body: dict[str, str | None], uid: int = Depends(auth.current_user)):
    with connect() as con:
        for k, v in list(body.items())[:50]:
            if not k.startswith("finanaliz_") or k in ("finanaliz_token", "finanaliz_user"):
                continue
            if v is None:
                con.execute("DELETE FROM user_prefs WHERE user_id=? AND key=?", (uid, k))
            elif len(v) <= 200_000:
                con.execute("INSERT OR REPLACE INTO user_prefs VALUES (?,?,?)", (uid, k, v))
    return {"ok": True}


@app.get("/api/settings")
def get_settings(_: int = Depends(auth.current_user)):
    return assistant.status()


@app.put("/api/settings")
def put_settings(body: SettingsIn, _: int = Depends(auth.current_user)):
    assistant.save_settings(body.model_dump())
    return assistant.status()


# ---------- Strateji testi ----------
@app.get("/api/backtest/strategies")
def strategies():
    return backtest.STRATEGIES


@app.post("/api/backtest")
async def run_backtest(body: BacktestIn, _: int = Depends(auth.current_user)):
    def work():
        df = market.to_frame(market.history(body.symbol.upper(), body.period, "1d"))
        try:
            return backtest.run(df, body.strategy, body.params, body.capital, body.commission_pct)
        except ValueError as e:
            raise HTTPException(400, str(e))

    return await run_in_threadpool(work)


# ---------- İzleme listesi ----------
@app.get("/api/watchlist")
async def get_watchlist(fresh: bool = False, uid: int = Depends(auth.current_user)):
    with connect() as con:
        syms = [r["symbol"] for r in con.execute("SELECT symbol FROM watchlist WHERE user_id=? ORDER BY id", (uid,))]
    if fresh and syms:
        market.invalidate(syms)
    return await run_in_threadpool(market.quotes, syms) if syms else []


@app.post("/api/watchlist")
def add_watch(item: WatchItem, uid: int = Depends(auth.current_user)):
    with connect() as con:
        con.execute("INSERT OR IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)", (uid, item.symbol.upper()))
    return {"ok": True}


@app.delete("/api/watchlist/{symbol}")
def del_watch(symbol: str, uid: int = Depends(auth.current_user)):
    with connect() as con:
        con.execute("DELETE FROM watchlist WHERE user_id=? AND symbol=?", (uid, symbol.upper()))
    return {"ok": True}


# ---------- Portföy ----------
class TransactionIn(BaseModel):
    symbol: str
    side: str = Field(pattern="^(buy|sell)$")
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    date: str | None = None
    fee: float = Field(default=0, ge=0)
    note: str | None = None
    reason: str | None = None
    emotion: str | None = None
    tag: str | None = None


class JournalIn(BaseModel):
    reason: str | None = None
    emotion: str | None = None
    tag: str | None = None
    review: str | None = None


class TargetsIn(BaseModel):
    targets: dict[str, float | None]


def _portfolio_items(uid: int) -> dict:
    return portfolio.positions(uid)


@app.get("/api/portfolio")
async def get_portfolio(fresh: bool = False, uid: int = Depends(auth.current_user)):
    if fresh:
        market.invalidate([t["symbol"] for t in portfolio.transactions(uid)])
    return await run_in_threadpool(portfolio.positions, uid)


@app.get("/api/portfolio/analytics")
async def portfolio_analytics(uid: int = Depends(auth.current_user)):
    def work():
        an = portfolio.analytics(uid)
        if not an.get("empty") and an.get("start") and an.get("period_return_pct") is not None:
            try:
                import pandas as pd
                inf = quant.inflation_between(pd.Timestamp(an["start"], unit="s"))
                an["inflation_pct"] = inf
                an["real_return_pct"] = quant.real_return(an["period_return_pct"], inf)
                an["benchmark_real"] = {k: quant.real_return(v, inf) for k, v in an["benchmark_returns"].items()}
            except Exception:
                an["inflation_pct"] = None
        return an
    return await run_in_threadpool(work)


@app.get("/api/portfolio/dividends")
async def portfolio_dividends(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(portfolio.dividends, uid)


@app.get("/api/portfolio/advisor")
async def portfolio_advisor(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(portfolio.advisor, uid)


@app.get("/api/portfolio/targets")
def get_targets(uid: int = Depends(auth.current_user)):
    return portfolio.get_targets(uid)


@app.put("/api/portfolio/targets")
def put_targets(body: TargetsIn, uid: int = Depends(auth.current_user)):
    return portfolio.set_targets(uid, body.targets)


@app.post("/api/portfolio/transactions")
async def add_transaction(tx: TransactionIn, uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(portfolio.add_transaction, uid, tx.model_dump())


# ---------- Sanal hesap ----------
class AmountIn(BaseModel):
    amount: float = Field(gt=0)


def _holdings_value_try(uid: int) -> tuple[float, list[dict]]:
    return engine.holdings_value_try(uid)


@app.get("/api/account")
async def get_account(uid: int = Depends(auth.current_user)):
    def work():
        value, items = _holdings_value_try(uid)
        return {**account.summary(uid, value), "holdings_count": len(items)}
    return await run_in_threadpool(work)


@app.post("/api/account/deposit")
def account_deposit(body: AmountIn, uid: int = Depends(auth.current_user)):
    account.deposit(uid, body.amount)
    return account.balances(uid)


@app.post("/api/account/withdraw")
def account_withdraw(body: AmountIn, uid: int = Depends(auth.current_user)):
    account.withdraw(uid, body.amount)
    return account.balances(uid)


@app.post("/api/account/reset")
def account_reset(body: AmountIn, uid: int = Depends(auth.current_user)):
    account.reset(uid, body.amount)
    return account.balances(uid)


@app.get("/api/trade/info")
async def trade_info(symbol: str, uid: int = Depends(auth.current_user)):
    """Al-sat paneli için: güncel fiyat, kur, eldeki adet, alım gücü ve takas süresi."""
    def work():
        sym = symbol.upper()
        q = market.quotes([sym])[0]
        return {"symbol": sym, "name": market.NAME_BY_SYMBOL.get(sym, sym), "price": q["price"], "change_pct": q["change_pct"],
                "currency": market.currency_of(sym), "fx_rate": account.fx_to_try(sym), "holding": portfolio.holding(uid, sym),
                "settlement_days": account.SETTLEMENT_DAYS.get(market.market_of(sym), 0), "balances": account.balances(uid)}
    return await run_in_threadpool(work)


@app.put("/api/portfolio/transactions/{tx_id}/journal")
def update_journal(tx_id: int, body: JournalIn, uid: int = Depends(auth.current_user)):
    with connect() as con:
        con.execute("UPDATE transactions SET reason=?, emotion=?, tag=?, review=? WHERE id=? AND user_id=?",
                    (body.reason or None, body.emotion or None, body.tag or None, body.review or None, tx_id, uid))
    return {"ok": True}


# ---------- Bildirimler ----------
class ReadIn(BaseModel):
    ids: list[int] | None = None


@app.get("/api/notifications")
def get_notifications(uid: int = Depends(auth.current_user)):
    return notifications.recent(uid)


@app.get("/api/notifications/since")
def notifications_since(last_id: int = 0, uid: int = Depends(auth.current_user)):
    return notifications.since(uid, last_id)


@app.post("/api/notifications/read")
def read_notifications(body: ReadIn, uid: int = Depends(auth.current_user)):
    notifications.mark_read(uid, body.ids)
    return {"ok": True}


@app.delete("/api/notifications")
def clear_notifications(uid: int = Depends(auth.current_user)):
    notifications.clear(uid)
    return {"ok": True}


# ---------- Emirler ----------
class OrderIn(BaseModel):
    symbol: str
    type: str
    quantity: float = Field(gt=0)
    price: float = Field(gt=0)
    expires: str | None = None
    note: str | None = None


@app.get("/api/orders/types")
def order_types():
    return {k: {"label": v[0], "side": v[1], "hint": v[2]} for k, v in orders.TYPES.items()}


@app.get("/api/orders")
def get_orders(uid: int = Depends(auth.current_user)):
    return orders.list_orders(uid)


@app.post("/api/orders")
async def create_order(body: OrderIn, uid: int = Depends(auth.current_user)):
    res = await run_in_threadpool(orders.create, uid, body.model_dump())
    await run_in_threadpool(orders.check, uid)  # koşul zaten sağlanıyorsa hemen gerçekleşsin
    return res


@app.delete("/api/orders/{oid}")
def cancel_order(oid: int, uid: int = Depends(auth.current_user)):
    orders.cancel(uid, oid)
    return {"ok": True}


# ---------- Strateji botları ----------
class BotIn(BaseModel):
    symbol: str
    strategy: str
    params: dict = {}
    amount_try: float = Field(gt=0)


@app.get("/api/bots")
async def get_bots(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(bots.list_bots, uid)


@app.get("/api/bots/preview")
async def bot_preview(symbol: str, strategy: str, _: int = Depends(auth.current_user)):
    try:
        sig = await run_in_threadpool(bots.signal, symbol.upper(), strategy, {})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Sinyal hesaplanamadı: {e}")
    return {"signal": sig, "label": "Pozisyonda ol (al)" if sig else "Pozisyon dışı (bekle / sat)"}


@app.post("/api/bots")
async def create_bot(body: BotIn, uid: int = Depends(auth.current_user)):
    res = bots.create(uid, body.model_dump())
    await run_in_threadpool(bots.check, uid)
    return res


@app.post("/api/bots/{bid}/toggle")
def toggle_bot(bid: int, active: bool, uid: int = Depends(auth.current_user)):
    bots.set_active(uid, bid, active)
    return {"ok": True}


@app.delete("/api/bots/{bid}")
def delete_bot(bid: int, uid: int = Depends(auth.current_user)):
    bots.delete(uid, bid)
    return {"ok": True}


# ---------- Başarılar, karne, günlük ----------
@app.get("/api/badges")
async def get_badges(uid: int = Depends(auth.current_user)):
    def work():
        bal = account.balances(uid)
        value, _ = engine.holdings_value_try(uid)
        equity = bal["total_cash"] + value
        insights.snapshot(uid, equity, bal["total_cash"], value)
        return insights.badges(uid, (equity / bal["net_deposits"] - 1) * 100 if bal["net_deposits"] else None)
    return await run_in_threadpool(work)


@app.get("/api/report/monthly")
async def monthly_report(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(insights.monthly, uid)


@app.get("/api/equity/history")
def equity_history(uid: int = Depends(auth.current_user)):
    return insights.equity_history(uid)


@app.get("/api/journal/stats")
async def journal_stats(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(insights.journal_stats, uid)


# ---------- Nicel analiz ----------
class OptimizeIn(BaseModel):
    symbols: list[str]


class MonteCarloIn(BaseModel):
    weights: dict[str, float] | None = None
    start_value: float | None = None
    days: int = Field(default=252, ge=20, le=756)


@app.post("/api/optimize")
async def optimize(body: OptimizeIn, _: int = Depends(auth.current_user)):
    try:
        return await run_in_threadpool(quant.optimize, body.symbols)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/montecarlo")
async def monte_carlo(body: MonteCarloIn, uid: int = Depends(auth.current_user)):
    def work():
        weights, start = body.weights, body.start_value
        if not weights:
            value, items = engine.holdings_value_try(uid)
            weights = {i["symbol"]: i["value_try"] for i in items}
            start = start or value
        if not start:
            start = 100_000.0
        try:
            return quant.monte_carlo(weights, start, body.days)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return await run_in_threadpool(work)


@app.get("/api/inflation")
async def inflation(_: int = Depends(auth.current_user)):
    try:
        return await run_in_threadpool(quant.inflation_summary)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"TÜFE verisi alınamadı: {e}")


@app.get("/api/real-return")
async def real_return(start: str, nominal_pct: float, _: int = Depends(auth.current_user)):
    def work():
        inf = quant.inflation_between(start)
        return {"inflation_pct": inf, "nominal_pct": nominal_pct, "real_pct": quant.real_return(nominal_pct, inf) if inf is not None else None}
    return await run_in_threadpool(work)


# ---------- Yapay zekâ araçları ----------
class NlIn(BaseModel):
    query: str


@app.get("/api/ai/chart-insight/{symbol}")
async def chart_insight(symbol: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(ai_tools.chart_insight, symbol)


@app.post("/api/screener/nl")
async def nl_screener(body: NlIn, _: int = Depends(auth.current_user)):
    if not body.query.strip():
        raise HTTPException(400, "Bir tarama isteği yazın.")
    return await run_in_threadpool(ai_tools.nl_screen, body.query)


@app.get("/api/report/weekly")
async def get_weekly_report(refresh: bool = False, uid: int = Depends(auth.current_user)):
    import json as _json
    def work():
        if not refresh:
            with connect() as con:
                row = con.execute("SELECT payload FROM weekly_reports WHERE user_id=? ORDER BY week DESC LIMIT 1", (uid,)).fetchone()
            if row:
                return _json.loads(row["payload"])
        rep = ai_tools.weekly_report(uid)
        from datetime import date as _d
        with connect() as con:
            con.execute("INSERT OR REPLACE INTO weekly_reports VALUES (?,?,?)", (uid, _d.today().isoformat(), _json.dumps(rep, ensure_ascii=False, default=float)))
        return rep
    return await run_in_threadpool(work)


@app.post("/api/report/weekly/telegram")
async def weekly_to_telegram(uid: int = Depends(auth.current_user)):
    rep = await get_weekly_report(False, uid)
    ok, msg = alerts.send_telegram(rep["text"][:3900])
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True}


# ---------- Analiz araçları ----------
class SymbolsIn(BaseModel):
    symbols: list[str] | None = None


class ScenarioIn(BaseModel):
    shocks: dict[str, float]


def _portfolio_values(uid: int) -> dict[str, float]:
    _, items = engine.holdings_value_try(uid)
    return {i["symbol"]: i["value_try"] for i in items}


@app.post("/api/correlation")
async def correlation(body: SymbolsIn, uid: int = Depends(auth.current_user)):
    def work():
        syms = body.symbols or list(_portfolio_values(uid))
        try:
            return quant.correlation(syms)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return await run_in_threadpool(work)


@app.get("/api/scenario/factors")
def scenario_factors():
    return quant.FACTORS


@app.post("/api/scenario")
async def scenario(body: ScenarioIn, uid: int = Depends(auth.current_user)):
    def work():
        try:
            return quant.scenario(_portfolio_values(uid), body.shocks)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return await run_in_threadpool(work)


@app.get("/api/sectors/rotation")
async def sector_rotation(market_key: str = "bist", _: int = Depends(auth.current_user)):
    return await run_in_threadpool(quant.sector_rotation, market_key)


@app.get("/api/timetravel")
async def time_travel(symbol: str, start: str, amount: float = 10000, _: int = Depends(auth.current_user)):
    def work():
        try:
            return quant.time_travel(symbol, start, amount)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return await run_in_threadpool(work)


@app.get("/api/headtohead")
async def head_to_head(a: str, b: str, _: int = Depends(auth.current_user)):
    """İki varlığın fiyat performansı, temel oranları, teknik görünümü, temettüsü ve haber duygusu yan yana."""
    return {"a": await run_in_threadpool(_side_profile, a), "b": await run_in_threadpool(_side_profile, b)}


@app.get("/api/compare/details")
async def compare_details(symbols: str, _: int = Depends(auth.current_user)):
    """Karşılaştırma sayfası için her varlığın teknik, temel, temettü ve haber profili (paralel)."""
    from concurrent.futures import ThreadPoolExecutor
    syms = [x for x in symbols.split(",") if x][:6]

    def safe(sym):
        try:
            return _side_profile(sym)
        except Exception as e:  # noqa: BLE001
            return {"symbol": sym.upper(), "error": str(e)}
    with ThreadPoolExecutor(max_workers=6) as ex:
        return await run_in_threadpool(lambda: list(ex.map(safe, syms)))


def _side_profile(sym: str) -> dict:
    sym = sym.upper()
    df = market.to_frame(market.history(sym, "1y", "1d"))
    summ = indicators.summary(df)
    out = {"symbol": sym, "name": market.NAME_BY_SYMBOL.get(sym) or (universe.asset(sym) or {}).get("name", sym), "currency": market.currency_of(sym),
           "technical": {"overall": summ["overall"], "stats": summ["stats"],
                         "signals": {s["name"]: s["signal"] for s in summ["signals"]}},
           "series": [{"time": int(t), "value": round((float(v) / float(df["close"].iloc[0]) - 1) * 100, 3)} for t, v in zip(df["time"], df["close"])]}
    if market.market_of(sym) in ("bist", "us"):
        try:
            f = fundamentals.summary(sym, with_statements=False)
            out["fundamentals"] = {"market_cap": f["market_cap"], **f["ratios"], "scores": f["scores"], "sector": f["sector"]}
            out["dividend"] = fundamentals.dividend_profile(sym, f["price"])
        except Exception:
            pass
    try:
        n = news.get_news(sym, 12)
        out["news"] = n.get("summary")
    except Exception:
        pass
    return out


# ---------- Akademi ve tahmin oyunu ----------
class QuizIn(BaseModel):
    answers: list[int]


class PredictIn(BaseModel):
    symbol: str
    direction: str


@app.get("/api/academy")
def get_academy(uid: int = Depends(auth.current_user)):
    return academy.lessons(uid)


@app.post("/api/academy/{lesson_id}/submit")
def submit_academy(lesson_id: str, body: QuizIn, uid: int = Depends(auth.current_user)):
    res = academy.submit_quiz(uid, lesson_id, body.answers)
    insights.badges(uid)
    return res


@app.get("/api/game")
async def get_game(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(academy.game_state, uid)


@app.post("/api/game/predict")
async def game_predict(body: PredictIn, uid: int = Depends(auth.current_user)):
    await run_in_threadpool(academy.predict, uid, body.symbol, body.direction)
    return {"ok": True}


# ---------- Masaüstü mini pencere ----------
@app.get("/api/desktop/available")
def desktop_available():
    return {"widget": hasattr(app.state, "open_widget"), "notify": getattr(app.state, "desktop_notifier", None) is not None}


class NotifySettingsIn(BaseModel):
    enabled: bool | None = None
    mode: str | None = None
    kinds: list[str] | None = None
    sound: bool | None = None
    quiet: bool | None = None
    quiet_start: int | None = None
    quiet_end: int | None = None


def _notifier():
    n = getattr(app.state, "desktop_notifier", None)
    if n is None:
        raise HTTPException(400, "Masaüstü bildirimleri yalnızca masaüstü uygulamasında kullanılabilir.")
    return n


@app.get("/api/desktop/notify-settings")
def get_notify_settings(_: int = Depends(auth.current_user)):
    import desktop_notify
    n = _notifier()
    return {**desktop_notify.get_settings(), "available": n.available, "kind_labels": desktop_notify.KIND_LABELS}


@app.put("/api/desktop/notify-settings")
def put_notify_settings(body: NotifySettingsIn, _: int = Depends(auth.current_user)):
    import desktop_notify
    n = _notifier()
    data = body.model_dump()
    if data.get("mode") not in (None, "background", "always"):
        raise HTTPException(400, "Geçersiz bildirim modu.")
    for k in ("quiet_start", "quiet_end"):
        if data.get(k) is not None and not 0 <= data[k] <= 23:
            raise HTTPException(400, "Saat 0–23 arasında olmalı.")
    return {**desktop_notify.set_settings(data), "available": n.available, "kind_labels": desktop_notify.KIND_LABELS}


@app.post("/api/desktop/notify-test")
def notify_test(_: int = Depends(auth.current_user)):
    n = _notifier()
    if not n.show("🔔 Test bildirimi: THYAO", "Masaüstü bildirimleri çalışıyor. \"Grafiği aç\" ile hissenin grafiğine gidebilirsiniz.",
                  "alert", "/analiz?s=THYAO.IS"):
        raise HTTPException(500, "Windows bildirimi gösterilemedi. Windows Ayarlar > Bildirimler bölümünden bildirimlerin açık olduğunu kontrol edin.")
    return {"ok": True}


@app.post("/api/desktop/widget")
def open_widget(_: int = Depends(auth.current_user)):
    if not hasattr(app.state, "open_widget"):
        raise HTTPException(400, "Mini pencere yalnızca masaüstü uygulamasında açılabilir.")
    app.state.open_widget()
    return {"ok": True}


# ---------- Yedekleme ----------
@app.post("/api/backup")
async def make_backup(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(backup.save_file, uid)


@app.post("/api/backup/restore")
async def restore_backup(payload: dict, uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(backup.restore, uid, payload)


# ---------- Profil ----------
class ProfileIn(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    risk_profile: str | None = None
    experience: str | None = None
    bio: str | None = None


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=6)


PROFILE_FIELDS = ["full_name", "email", "phone", "city", "risk_profile", "experience", "bio"]


@app.get("/api/profile")
def get_profile(uid: int = Depends(auth.current_user)):
    with connect() as con:
        u = dict(con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())
        stats = {
            "transactions": con.execute("SELECT COUNT(*) FROM transactions WHERE user_id=?", (uid,)).fetchone()[0],
            "alerts": con.execute("SELECT COUNT(*) FROM alerts WHERE user_id=?", (uid,)).fetchone()[0],
            "favorites": con.execute("SELECT COUNT(*) FROM watchlist WHERE user_id=?", (uid,)).fetchone()[0],
        }
    u.pop("password_hash", None)
    return {**u, "stats": stats}


@app.put("/api/profile")
def put_profile(body: ProfileIn, uid: int = Depends(auth.current_user)):
    data = body.model_dump()
    with connect() as con:
        con.execute(f"UPDATE users SET {', '.join(f'{k}=?' for k in PROFILE_FIELDS)} WHERE id=?",
                    [(data[k] or None) for k in PROFILE_FIELDS] + [uid])
    return get_profile(uid)


@app.post("/api/profile/password")
def change_password(body: PasswordIn, uid: int = Depends(auth.current_user)):
    with connect() as con:
        row = con.execute("SELECT password_hash FROM users WHERE id=?", (uid,)).fetchone()
        if not auth.verify_password(body.current, row["password_hash"]):
            raise HTTPException(400, "Mevcut şifre hatalı.")
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (auth.hash_password(body.new), uid))
    return {"ok": True}


@app.delete("/api/portfolio/transactions/{tx_id}")
def del_transaction(tx_id: int, uid: int = Depends(auth.current_user)):
    with connect() as con:
        tx = con.execute("SELECT * FROM transactions WHERE id=? AND user_id=?", (tx_id, uid)).fetchone()
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı.")
    if tx["side"] == "buy" and portfolio.holding(uid, tx["symbol"]) - tx["quantity"] < -1e-9:
        raise HTTPException(400, "Bu alış silinirse elinizdeki adet eksiye düşer; önce ilgili satış işlemlerini silin.")
    with connect() as con:
        con.execute("DELETE FROM transactions WHERE id=? AND user_id=?", (tx_id, uid))
    return {"ok": True}


@app.post("/api/portfolio")
def add_holding(h: Holding, uid: int = Depends(auth.current_user)):
    """Eski arayüzle uyumluluk: pozisyon eklemek bir alış işlemi kaydeder."""
    portfolio.add_transaction(uid, {"symbol": h.symbol, "side": "buy", "quantity": h.quantity, "price": h.buy_price,
                                    "date": h.buy_date, "note": h.note})
    return {"ok": True}


@app.delete("/api/portfolio/{symbol}")
def del_position(symbol: str, uid: int = Depends(auth.current_user)):
    """Bir varlığa ait tüm işlemleri siler."""
    with connect() as con:
        con.execute("DELETE FROM transactions WHERE user_id=? AND symbol=?", (uid, symbol.upper()))
    return {"ok": True}


# ---------- Fiyat alarmları ----------
@app.get("/api/alerts")
def get_alerts(uid: int = Depends(auth.current_user)):
    with connect() as con:
        return rows(con.execute("SELECT * FROM alerts WHERE user_id=? ORDER BY triggered, id DESC", (uid,)))


@app.post("/api/alerts")
def add_alert(a: AlertIn, uid: int = Depends(auth.current_user)):
    if a.condition not in alerts.CONDITIONS:
        raise HTTPException(400, "Bilinmeyen alarm koşulu.")
    if alerts.CONDITIONS[a.condition][1] and a.target is None:
        raise HTTPException(400, "Bu alarm için bir değer girmelisiniz.")
    with connect() as con:
        con.execute("INSERT INTO alerts (user_id, symbol, condition, target, repeat, note) VALUES (?,?,?,?,?,?)",
                    (uid, a.symbol.upper(), a.condition, a.target, int(a.repeat), a.note))
    return {"ok": True}


@app.delete("/api/alerts/{alert_id}")
def del_alert(alert_id: int, uid: int = Depends(auth.current_user)):
    with connect() as con:
        con.execute("DELETE FROM alerts WHERE id=? AND user_id=?", (alert_id, uid))
    return {"ok": True}


def check_alerts_for(uid: int | None = None) -> list[dict]:
    """Aktif alarmları kontrol eder (uid verilmezse tüm kullanıcılar — sistem tepsisi modu)."""
    return alerts.check(uid)


@app.get("/api/alerts/conditions")
def alert_conditions():
    return {k: {"label": v[0], "needs_target": v[1]} for k, v in alerts.CONDITIONS.items()}


@app.post("/api/alerts/check")
async def check_alerts(uid: int = Depends(auth.current_user)):
    return await run_in_threadpool(check_alerts_for, uid)


class TelegramTest(BaseModel):
    token: str | None = None
    chat_id: str | None = None


@app.post("/api/telegram/test")
def telegram_test(body: TelegramTest, _: int = Depends(auth.current_user)):
    token, chat = alerts.telegram_config()
    ok, msg = alerts.send_telegram("✅ FinAnaliz Telegram bağlantısı çalışıyor.", body.token or token, body.chat_id or chat)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}


# ---------- KAP, temel analiz, temettü ----------
@app.get("/api/kap")
async def kap_list(symbol: str | None = None, days: int = 7, scope: str = "all", uid: int = Depends(auth.current_user)):
    def work():
        if symbol:
            return kap.for_codes([symbol], days)
        if scope in ("favorites", "portfolio"):
            with connect() as con:
                if scope == "favorites":
                    codes = [r["symbol"] for r in con.execute("SELECT symbol FROM watchlist WHERE user_id=?", (uid,))]
                else:
                    codes = [r["symbol"] for r in con.execute("SELECT DISTINCT symbol FROM transactions WHERE user_id=?", (uid,))]
            codes = [c for c in codes if c.endswith(".IS")]
            return kap.for_codes(codes, days) if codes else []
        return kap.disclosures(days)[:500]
    try:
        return await run_in_threadpool(work)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"KAP verisine ulaşılamadı: {e}")


@app.get("/api/fundamentals/{symbol}")
async def get_fundamentals(symbol: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(fundamentals.summary, symbol)


@app.get("/api/fundamentals/{symbol}/peers")
async def get_peers(symbol: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(fundamentals.peers, symbol)


@app.get("/api/dividends/history/{symbol}")
async def dividend_history(symbol: str, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(fundamentals.dividend_history, symbol)


@app.get("/api/dividends/{market_key}")
async def dividend_list(market_key: str, _: int = Depends(auth.current_user)):
    if market_key not in ("bist", "us"):
        raise HTTPException(404, "Temettü listesi yalnızca BIST ve ABD için vardır.")
    return await run_in_threadpool(fundamentals.dividend_list, market_key)


# ---------- Günlük bülten ----------
@app.get("/api/bulletin")
async def get_bulletin(refresh: bool = False, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(bulletin.get, refresh)


@app.get("/api/bulletin/history")
def bulletin_history(_: int = Depends(auth.current_user)):
    return bulletin.history()


@app.get("/api/bulletin/{day}")
def bulletin_by_day(day: str, _: int = Depends(auth.current_user)):
    d = bulletin.by_date(day)
    if not d:
        raise HTTPException(404, "Bülten bulunamadı.")
    return d


# ---------- Tarama, haberler, ekonomik takvim ----------
@app.get("/api/screener")
async def run_screener(markets: str = "bist,us,crypto,fx", scope: str = "featured", force: bool = False,
                       _: int = Depends(auth.current_user)):
    keys = [m for m in markets.split(",") if m in market.CATALOG]
    return await run_in_threadpool(screener.scan_full, keys, "all" if scope == "all" else "featured", force)


@app.get("/api/news")
async def get_news(symbol: str | None = None, _: int = Depends(auth.current_user)):
    return await run_in_threadpool(news.get_news, symbol.upper() if symbol else None)


@app.get("/api/calendar")
async def calendar(_: int = Depends(auth.current_user)):
    return await run_in_threadpool(econ.week_events)


# ---------- Rapor dışa aktarma ----------
class ExportRows(BaseModel):
    title: str
    rows: list[dict]


class OpenFolder(BaseModel):
    path: str | None = None


def _saved(path) -> dict:
    return {"path": str(path), "name": path.name, "folder": str(path.parent)}


QUOTE_COLUMNS = [("symbol", "Sembol", "text"), ("name", "Ad", "text"), ("sector", "Sektör", "text"),
                 ("price", "Fiyat", "num"), ("change_pct", "Günlük", "pct"), ("change_1w", "Haftalık", "pct"),
                 ("change_1m", "Aylık", "pct"), ("change_ytd", "Yılbaşından Beri", "pct"), ("change_1y", "1 Yıl", "pct"),
                 ("low_52w", "52H En Düşük", "num"), ("high_52w", "52H En Yüksek", "num"), ("volume", "Hacim", "int")]


@app.post("/api/export/market/{key}")
async def export_market(key: str, _: int = Depends(auth.current_user)):
    def work():
        qs = market.market_quotes(key)
        return _saved(export.excel(market.MARKET_NAMES[key], QUOTE_COLUMNS, qs, f"Piyasa_{key}"))
    return await run_in_threadpool(work)


@app.post("/api/export/screener")
async def export_screener(body: ExportRows, _: int = Depends(auth.current_user)):
    cols = [("symbol", "Sembol", "text"), ("name", "Ad", "text"), ("market", "Piyasa", "text"), ("price", "Fiyat", "num"),
            ("change_pct", "Günlük", "pct"), ("change_1m", "Aylık", "pct"), ("rsi", "RSI", "num"),
            ("dist_sma50", "SMA50 Uzaklık", "pct"), ("dist_sma200", "SMA200 Uzaklık", "pct"),
            ("vol_ratio", "Hacim Oranı", "num"), ("dist_high_52w", "52H Zirveye Uzaklık", "pct"), ("trend", "Trend", "text")]
    return await run_in_threadpool(lambda: _saved(export.excel(body.title or "Tarama Sonuçları", cols, body.rows, "Tarama")))


@app.post("/api/export/analysis/{symbol}")
async def export_analysis(symbol: str, _: int = Depends(auth.current_user)):
    def work():
        sym = symbol.upper()
        candles = market.history(sym, "1y", "1d")
        summary = indicators.summary(market.to_frame(candles))
        return _saved(export.analysis_pdf(sym, market.NAME_BY_SYMBOL.get(sym, sym), market.currency_of(sym), candles, summary))
    return await run_in_threadpool(work)


@app.post("/api/export/portfolio")
async def export_portfolio(fmt: str = "pdf", uid: int = Depends(auth.current_user)):
    def work():
        data = _portfolio_items(uid)
        if not data["items"]:
            raise HTTPException(400, "Portföy boş.")
        with connect() as con:
            username = con.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()["username"]
        an = portfolio.analytics(uid)
        if fmt == "xlsx":
            cols = [("symbol", "Sembol", "text"), ("name", "Ad", "text"), ("currency", "Para Birimi", "text"),
                    ("quantity", "Miktar", "num"), ("buy_price", "Alış Fiyatı", "num"), ("buy_date", "Alış Tarihi", "text"),
                    ("price", "Güncel Fiyat", "num"), ("cost", "Maliyet", "num"), ("value", "Değer", "num"),
                    ("pnl", "Kâr/Zarar", "num"), ("pnl_pct", "K/Z %", "pct"), ("day_change_pct", "Günlük", "pct")]
            alloc = [("label", "Varlık", "text"), ("value", "Değer (TL)", "num"), ("pct", "Pay (%)", "num")]
            tx_cols = [("date", "Tarih", "text"), ("symbol", "Sembol", "text"), ("side", "İşlem", "text"),
                       ("quantity", "Miktar", "num"), ("price", "Fiyat", "num"), ("fee", "Komisyon", "num"),
                       ("currency", "Para Birimi", "text"), ("realized_pnl", "Gerçekleşen K/Z", "num")]
            txs = [{**t, "side": "Alış" if t["side"] == "buy" else "Satış"} for t in data["transactions"]]
            return _saved(export.excel("Portföy", cols, data["items"], "Portfoy",
                                       extra_sheets=[("Dağılım", alloc, an["allocation"]["asset"]),
                                                     ("İşlem Geçmişi", tx_cols, txs)]))
        return _saved(export.portfolio_pdf(data["items"], an, username))
    return await run_in_threadpool(work)


class ImageIn(BaseModel):
    name: str
    data: str


@app.post("/api/export/image")
def export_image(body: ImageIn, _: int = Depends(auth.current_user)):
    """Arayüzden gönderilen grafik görüntüsünü (base64 PNG) rapor klasörüne kaydeder."""
    import base64
    path = export._path(body.name, "png")
    path.write_bytes(base64.b64decode(body.data))
    return _saved(path)


@app.post("/api/export/open")
def open_export_folder(body: OpenFolder, _: int = Depends(auth.current_user)):
    try:
        export.open_folder(body.path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---------- Arayüz (derlenmiş React uygulaması) ----------
# Paketlenmiş exe içinde arayüz dosyaları PyInstaller'ın açtığı geçici klasördedir
DIST = (Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]) / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")  # adları içerik özetli, güvenle önbelleğe alınır

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        f = DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        # index.html önbelleğe alınmaz; böylece uygulama güncellendiğinde yeni arayüz hemen yüklenir
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
