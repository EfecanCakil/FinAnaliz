"""Yapay zekâ açıklaması, model karnesi, hedef planlayıcı, risk uyarıcı ve SPK okuyucusu (ağ kullanmadan)."""
import numpy as np
import pandas as pd
import pytest

from app import ml, planner, quant, spk, wellness


def _random_walk(n=520, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0.0003, 0.015, n)))
    t = pd.date_range("2024-01-01", periods=n, freq="B")
    return pd.DataFrame({"time": (t.astype("int64") // 10**9).astype(int), "open": close, "high": close * 1.01,
                         "low": close * 0.99, "close": close, "volume": rng.integers(1e5, 1e6, n).astype(float)}, index=t)


def test_explanation_contributions_cover_all_features():
    df = _random_walk()
    feats = ml.build_features(df).dropna(subset=ml.FEATURES + ["target_ret"])
    X, y = feats[ml.FEATURES].values, (feats["target_ret"].values > 0).astype(int)
    clf = ml._models()["Lojistik/Ridge Regresyon"][0].fit(X, y)
    e = ml.explain(clf, X, X[-1:], "test")
    assert len(e["factors"]) == len(ml.FEATURES)
    assert 0 <= e["probability"] <= 100
    assert all(isinstance(f["text"], str) and f["text"] for f in e["factors"])


def test_scorecard_on_random_walk_is_not_significant():
    # Rastgele yürüyüşte gerçek bir öngörü gücü olamaz: karne bunu "anlamlı" (A) olarak göstermemeli
    c = ml.scorecard(_random_walk(seed=3), ("rw", 3))
    assert c["grade"] in ("B", "C")
    assert c["days"] == 126
    for m in c["models"]:
        assert 0 <= m["p_value"] <= 1
        assert m["correct"] <= m["days"]


def test_scorecard_requires_enough_history():
    with pytest.raises(ValueError):
        ml.scorecard(_random_walk(n=200), ("short",))


def test_goal_probability_increases_with_contribution(monkeypatch):
    monkeypatch.setattr(quant, "cpi", lambda: pd.DataFrame({"yearly": [30.0], "monthly": [2.0]}))
    low = planner.goal(1, 500_000, 3, 2_000, 0, "dengeli")
    high = planner.goal(1, 500_000, 3, 20_000, 0, "dengeli")
    assert high["probability"] > low["probability"]
    assert low["required_monthly"] == pytest.approx(high["required_monthly"])
    assert high["safe_monthly"] >= high["required_monthly"]


def test_goal_rejects_invalid_input():
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        planner.goal(1, 100_000, 100, None, 0, "dengeli")
    with pytest.raises(HTTPException):
        planner.goal(1, 100_000, 3, None, 0, "kumar")


def test_risk_warnings_detect_concentration_and_correlation(monkeypatch):
    from app import portfolio
    holdings = [("GARAN.IS", 40_000), ("AKBNK.IS", 35_000), ("THYAO.IS", 10_000)]
    monkeypatch.setattr(portfolio, "positions", lambda uid: {"items": [
        {"symbol": s, "quantity": 1, "value": v, "cost": v, "currency": "TRY", "pnl_pct": 0.0} for s, v in holdings]})
    rng = np.random.default_rng(0)
    base = rng.normal(0, 0.02, 120)
    rets = pd.DataFrame({"GARAN.IS": base + rng.normal(0, 0.003, 120), "AKBNK.IS": base + rng.normal(0, 0.003, 120),
                         "THYAO.IS": rng.normal(0, 0.02, 120)})
    monkeypatch.setattr(quant, "_returns", lambda syms, period="1y": rets[syms])
    monkeypatch.setattr(wellness, "_sector", lambda s: "Bankacılık" if s in ("GARAN.IS", "AKBNK.IS") else "Ulaştırma")
    r = wellness.risk_warnings(1)
    keys = [w["key"] for w in r["warnings"]]
    assert "single:GARAN.IS" in keys and "single:AKBNK.IS" in keys
    assert "sector:Bankacılık" in keys
    sector = next(w for w in r["warnings"] if w["key"] == "sector:Bankacılık")
    assert "birlikte hareket" in sector["text"]  # aynı sektördeki yüksek korelasyon ayrı uyarı yerine buraya eklenir
    assert r["level"] == "high"


def test_spk_number_parsing():
    assert spk._num("1.250.000,50") == pytest.approx(1250000.5)
    assert spk._num("-") is None
    assert spk._num(None) is None
