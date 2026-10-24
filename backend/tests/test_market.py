"""Canlı fiyat katmanı ve tarih dönüşümleri."""
from datetime import date

import pandas as pd

from app import market


def _frame(days, closes):
    idx = pd.DatetimeIndex(pd.to_datetime(days))
    return pd.DataFrame({"Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": [1000.0] * len(closes)}, index=idx)


def test_local_days_moves_bist_utc_time_to_trading_day():
    # BIST'in 20 Ekim kapanışı Yahoo'da "19 Ekim 21:00 UTC" olarak gelir
    idx = pd.DatetimeIndex([pd.Timestamp("2026-10-19 21:00"), pd.Timestamp("2026-10-20 04:00"), pd.Timestamp("2026-10-19 23:00")])
    assert [d.date() for d in market.local_days(idx)] == [date(2026, 10, 20), date(2026, 10, 20), date(2026, 10, 20)]


def test_overlay_appends_missing_today_and_fixes_previous_close():
    f = _frame(["2026-10-16", "2026-10-19"], [273.5, 270.0])  # 19'u seans içinde yakalanmış eski değer
    lv = {"price": 266.0, "prev_close": 273.5, "open": 272.0, "high": 274.0, "low": 265.0, "volume": 5e6, "date": date(2026, 10, 20)}
    out = market._overlay_frame(f, lv)
    assert len(out) == 3
    assert out["Close"].iloc[-1] == 266.0
    assert out["Close"].iloc[-2] == 273.5  # resmî önceki kapanış esas alınır
    assert out["High"].iloc[-1] == 274.0 and out["Low"].iloc[-1] == 265.0


def test_overlay_updates_same_day_without_new_row():
    f = _frame(["2026-10-19", "2026-10-20"], [100.0, 101.0])
    lv = {"price": 103.0, "prev_close": 100.0, "open": 100.5, "high": 103.5, "low": 99.0, "volume": None, "date": date(2026, 10, 20)}
    out = market._overlay_frame(f, lv)
    assert len(out) == 2
    assert out["Close"].iloc[-1] == 103.0
    assert out["High"].iloc[-1] == 103.5


def test_overlay_ignores_stale_live_data():
    f = _frame(["2026-10-19", "2026-10-20"], [100.0, 101.0])
    lv = {"price": 90.0, "prev_close": 95.0, "open": None, "high": None, "low": None, "volume": None, "date": date(2026, 10, 16)}
    out = market._overlay_frame(f, lv)
    assert out["Close"].tolist() == [100.0, 101.0]


def test_overlay_candles_adds_new_candle():
    t19 = int(pd.Timestamp("2026-10-18 21:00").timestamp())  # 19 Ekim (İstanbul) gece yarısı
    candles = [{"time": t19, "open": 1, "high": 1, "low": 1, "close": 270.0, "volume": 1}]
    lv = {"price": 266.0, "prev_close": 273.5, "open": 272.0, "high": 274.0, "low": 265.0, "volume": 0,
          "date": date(2026, 10, 20), "gmtoffset": 10800}
    out = market._overlay_candles(candles, lv)
    assert len(out) == 2
    assert out[0]["close"] == 273.5 and out[1]["close"] == 266.0
    assert out[1]["time"] - out[0]["time"] == 86400


def test_quote_change_uses_previous_close():
    f = _frame(["2026-10-16", "2026-10-19", "2026-10-20"], [270.0, 273.5, 266.0])
    q = market._quote_from("THYAO.IS", f)
    assert round(q["change_pct"], 2) == round((266.0 / 273.5 - 1) * 100, 2)
