"""Çoklu portföy, düzenli alım, tahmin günlüğü, vergi hesabı, sinyal sicili ve telefondan erişim."""
from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import account, auth, dca, lan, market, notifications, portfolio, portfolios, predlog, signals, tax
from app.db import connect
from app.main import app

client = TestClient(app)
H = {"host": "localhost"}


def _token(uid):
    with connect() as con:
        r = con.execute("SELECT username, token_version FROM users WHERE id=?", (uid,)).fetchone()
    return auth.create_token(uid, r["username"], r["token_version"] or 0)


# ---------------------------------------------------------------- çoklu portföy
def test_portfolios_are_isolated_and_switched_by_header(prices, user):
    p = portfolios.create(user, "Deneme", 50_000)
    pid = p["id"]
    portfolio.add_transaction(pid, {"symbol": "THYAO.IS", "side": "buy", "quantity": 10, "price": 100, "fee": 0})
    assert portfolio.positions(user)["items"] == []  # ana portföy etkilenmez
    assert account.balances(pid)["total_cash"] == pytest.approx(50_000 - 1_000)
    hdr = {**H, "Authorization": f"Bearer {_token(user)}"}
    main_pos = client.get("/api/portfolio", headers=hdr).json()
    sub_pos = client.get("/api/portfolio", headers={**hdr, "X-Portfolio": str(pid)}).json()
    assert not main_pos["items"] and sub_pos["items"][0]["symbol"] == "THYAO.IS"


def test_foreign_portfolio_header_is_ignored(prices, user):
    other = portfolios.create(user, "Benim", 10_000)["id"]
    with connect() as con:
        con.execute("INSERT INTO users (username, password_hash) VALUES ('yabanci_kisi', '!')")
        stranger = con.execute("SELECT id FROM users WHERE username='yabanci_kisi'").fetchone()["id"]
    assert auth.current_user(type("C", (), {"credentials": _token(stranger)})(), str(other)) == stranger


def test_sub_portfolio_cannot_log_in_and_notifications_go_to_owner(prices, user):
    pid = portfolios.create(user, "Kripto", 10_000)["id"]
    with connect() as con:
        uname = con.execute("SELECT username FROM users WHERE id=?", (pid,)).fetchone()["username"]
    with pytest.raises(Exception):
        auth.login(uname, "!")
    notifications.add(pid, "order", "Emir gerçekleşti")
    items = notifications.recent(user)["items"]
    assert items and items[0]["title"].startswith("[Kripto]")


def test_deleting_portfolio_removes_its_data(prices, user):
    pid = portfolios.create(user, "Silinecek", 10_000)["id"]
    portfolio.add_transaction(pid, {"symbol": "GARAN.IS", "side": "buy", "quantity": 1, "price": 50, "fee": 0})
    portfolios.delete(user, pid)
    with connect() as con:
        assert not con.execute("SELECT 1 FROM transactions WHERE user_id=?", (pid,)).fetchone()
    with pytest.raises(Exception):
        portfolios.delete(user, user)  # ana portföy silinemez


# ---------------------------------------------------------------- düzenli alım
def test_dca_dates():
    assert dca._next("monthly", 1, date(2026, 10, 20)) == date(2026, 11, 1)
    assert dca._next("monthly", 28, date(2026, 2, 27)) == date(2026, 2, 28)
    assert dca._next("weekly", 0, date(2026, 10, 19)) == date(2026, 10, 26)
    assert dca._next("biweekly", 0, date(2026, 10, 19)) == date(2026, 11, 2)


def test_dca_buys_whole_shares_and_schedules_next(prices, user, monkeypatch):
    monkeypatch.setattr(dca, "_market_open", lambda s, now: True)
    prices["THYAO.IS"] = 300.0
    pid = dca.create(user, "THYAO.IS", 1000, "monthly", date.today().day if date.today().day <= 28 else 1)["id"]
    with connect() as con:
        con.execute("UPDATE dca_plans SET next_date=? WHERE id=?", (date.today().isoformat(), pid))
    dca.run_due(user)
    pos = portfolio.positions(user)["items"]
    assert pos[0]["quantity"] == 3  # 1000 / 300 → 3 tam adet
    plan = dca.list_plans(user)["plans"][0]
    assert plan["runs"] == 1 and plan["next_date"] > date.today().isoformat()


# ---------------------------------------------------------------- tahmin günlüğü
def test_prediction_journal_resolves(user, monkeypatch):
    res = {"best_model": "Test", "forecast": {"target_date": "2026-01-06", "data_date": "2026-01-05", "up_probability": 70.0,
                                              "expected_return_pct": 0.5, "last_price": 100.0}}
    predlog.record(user, "THYAO.IS", res)
    monkeypatch.setattr(market, "daily_closes", lambda s, p="1y": pd.Series([100.0, 103.0], index=pd.to_datetime(["2026-01-05", "2026-01-06"])))
    predlog.resolve()
    j = predlog.journal(user)
    item = next(i for i in j["items"] if i["symbol"] == "THYAO.IS")
    assert item["correct"] == 1 and item["actual_ret"] == pytest.approx(3.0)
    assert j["stats"]["accuracy"] == 100.0


# ---------------------------------------------------------------- vergi
def test_tax_fifo_and_indexation(user, monkeypatch):
    monkeypatch.setattr(market, "daily_closes", lambda s, p="1y": pd.Series([30.0, 40.0], index=pd.to_datetime(["2024-01-02", "2025-06-02"])))
    monkeypatch.setattr(tax, "ufe_index", lambda: pd.Series([100.0, 150.0], index=pd.to_datetime(["2023-12-01", "2025-05-01"])))
    with connect() as con:
        for side, qty, price, d in (("buy", 10, 100, "2024-01-02"), ("buy", 10, 200, "2024-01-02"), ("sell", 15, 300, "2025-06-02")):
            con.execute("INSERT INTO transactions (user_id, symbol, side, quantity, price, date, fee, funded) VALUES (?,?,?,?,?,?,0,1)",
                        (user, "AAPL", side, qty, price, d))
    r = tax.report(user, 2025)
    assert len(r["sales"]) == 2  # FIFO: önce 100$'lık 10 adet, sonra 200$'lık 5 adet
    first = r["sales"][0]
    assert first["indexed"] and first["cost_adj_try"] == pytest.approx(10 * 100 * 30 * 1.5)
    assert first["proceeds_try"] == pytest.approx(10 * 300 * 40)
    assert r["tax_try"] == pytest.approx(tax._tax(r["taxable_try"], tax.DEFAULT_BRACKETS)[0])


def test_tax_brackets():
    assert tax._tax(500_000, tax.DEFAULT_BRACKETS)[0] == pytest.approx(158_000 * .15 + 172_000 * .20 + 170_000 * .27)


# ---------------------------------------------------------------- sinyal sicili
def test_signal_track_on_synthetic_prices(monkeypatch):
    rng = np.random.default_rng(5)
    n = 700
    close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.02, n)))
    t = pd.date_range("2023-01-02", periods=n, freq="B")
    candles = [{"time": int(ts.timestamp()), "open": c, "high": c * 1.01, "low": c * .99, "close": c, "volume": 1e6} for ts, c in zip(t, close)]
    monkeypatch.setattr(market, "history", lambda s, p="1y", i="1d": candles)
    r = signals.track("TEST.IS")
    assert len(r["signals"]) == 11
    for s in r["signals"]:
        assert s["grade"] in ("good", "neutral", "bad", "none")
        for st in s["stats"].values():
            assert 0 <= st["success"] <= 100


# ---------------------------------------------------------------- telefondan erişim
def test_lan_requests_require_pairing_key(monkeypatch):
    monkeypatch.setattr(lan, "is_lan_request", lambda scope: True)
    lan._state["key"] = "dogru-anahtar"
    try:
        assert client.get("/api/markets", headers={"host": "192.168.1.5:8770"}).status_code == 403
        r = client.get("/?tm_pair=dogru-anahtar", headers={"host": "192.168.1.5:8770"}, follow_redirects=False)
        assert r.status_code == 303 and "tm_pair=dogru-anahtar" in r.headers["set-cookie"]
        ok = client.get("/api/markets", headers={"host": "192.168.1.5:8770"}, cookies={"tm_pair": "dogru-anahtar"})
        assert ok.status_code == 200
        assert client.get("/api/markets", headers={"host": "192.168.1.5:8770"}, cookies={"tm_pair": "yanlis"}).status_code == 403
    finally:
        lan._state["key"] = None
