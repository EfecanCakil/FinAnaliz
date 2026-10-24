"""Portföy: ortalama maliyet, kâr/zarar, gerçekleşen kâr ve emir eşleştirme."""
import pytest
from fastapi import HTTPException

from app import account, orders, portfolio


def buy(uid, sym, qty, price):
    return portfolio.add_transaction(uid, {"symbol": sym, "side": "buy", "quantity": qty, "price": price, "fee": 0})


def sell(uid, sym, qty, price):
    return portfolio.add_transaction(uid, {"symbol": sym, "side": "sell", "quantity": qty, "price": price, "fee": 0})


def test_average_cost_and_unrealized_pnl(prices, user):
    buy(user, "THYAO.IS", 10, 80)
    buy(user, "THYAO.IS", 10, 120)
    prices["THYAO.IS"] = 110.0
    item = portfolio.positions(user)["items"][0]
    assert item["quantity"] == 20
    assert item["buy_price"] == pytest.approx(100.0)
    assert item["pnl"] == pytest.approx(200.0)
    assert item["pnl_pct"] == pytest.approx(10.0)


def test_partial_sell_realizes_pnl_at_average_cost(prices, user):
    buy(user, "GARAN.IS", 10, 40)
    buy(user, "GARAN.IS", 10, 60)
    sell(user, "GARAN.IS", 5, 70)
    pos = portfolio.positions(user)
    item = pos["items"][0]
    assert item["quantity"] == 15
    assert item["buy_price"] == pytest.approx(50.0)
    assert pos["realized"]["total_try"] == pytest.approx(5 * (70 - 50))


def test_cannot_sell_more_than_held(prices, user):
    buy(user, "THYAO.IS", 3, 100)
    with pytest.raises(HTTPException):
        sell(user, "THYAO.IS", 4, 100)


def test_cannot_buy_beyond_buying_power(prices, user):
    with pytest.raises(HTTPException):
        buy(user, "THYAO.IS", 10_000, 100)  # 1.000.000 TL > 100.000 TL başlangıç bakiyesi


def test_limit_buy_fills_only_when_price_reaches_limit(prices, user):
    prices["THYAO.IS"] = 100.0
    orders.create(user, {"symbol": "THYAO.IS", "type": "limit_buy", "quantity": 5, "price": 95.0})
    assert orders.check(user) == []  # fiyat limitin üzerinde: bekler
    assert account.balances(user)["buying_power"] == pytest.approx(account.INITIAL_CASH - 5 * 95.0)  # tutar bloke edildi
    prices["THYAO.IS"] = 94.0
    done = orders.check(user)
    assert done and done[0]["status"] == "filled"
    item = portfolio.positions(user)["items"][0]
    assert item["quantity"] == 5 and item["buy_price"] == pytest.approx(94.0)  # limitten daha iyi fiyattan


def test_stop_loss_sells_position_and_cancels_linked_take_profit(prices, user):
    buy(user, "GARAN.IS", 10, 50)
    orders.create(user, {"symbol": "GARAN.IS", "type": "stop_loss", "quantity": 10, "price": 45.0})
    orders.create(user, {"symbol": "GARAN.IS", "type": "take_profit", "quantity": 10, "price": 60.0})
    prices["GARAN.IS"] = 44.0
    done = orders.check(user)
    assert [d["type"] for d in done] == ["stop_loss"]
    assert portfolio.holding(user, "GARAN.IS") == 0
    open_types = [o["type"] for o in orders.list_orders(user) if o["status"] == "open"]
    assert "take_profit" not in open_types  # biri gerçekleşince diğeri iptal (OCO)
