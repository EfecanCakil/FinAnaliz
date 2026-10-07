"""Makine öğrenmesi ile kısa vadeli (ertesi gün) fiyat yönü ve getiri tahmini.

Teknik göstergelerden türetilen öznitelikler ile birkaç model eğitilir ve
zaman sırasını bozmayan bir eğitim/test ayrımı üzerinde karşılaştırılır:
  * Naif model (bugünkü getiri yarın da tekrarlanır / değişim yok)
  * Lojistik / Ridge regresyon
  * Rastgele Orman (Random Forest)
  * Gradyan Artırma (HistGradientBoosting – XGBoost benzeri)
  * Yapay Sinir Ağı (MLP)
  * ARIMA (klasik zaman serisi modeli) — seq_models.py
  * LSTM (derin öğrenme, isteğe bağlı) — yalnızca PyTorch kuruluysa çalışır. Testlerde diğer modellerden
    daha başarılı olmadığı ve uygulama boyutunu ~420 MB artırdığı için masaüstü paketine dahil edilmez.
Başarı ölçütleri: yön doğruluğu, MAE ve RMSE.
"""
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import (HistGradientBoostingClassifier, HistGradientBoostingRegressor,
                              RandomForestClassifier, RandomForestRegressor)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import indicators as ind
from . import seq_models

FEATURES = ["ret1", "ret2", "ret3", "ret5", "ret10", "rsi", "macd_hist", "dist_sma20", "dist_sma50",
            "bb_pos", "vol10", "vol_chg", "range"]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    c = df["close"]
    f = pd.DataFrame(index=df.index)
    ret = c.pct_change()
    f["ret1"] = ret
    f["ret2"] = c.pct_change(2)
    f["ret3"] = c.pct_change(3)
    f["ret5"] = c.pct_change(5)
    f["ret10"] = c.pct_change(10)
    f["rsi"] = ind.rsi(c) / 100
    f["macd_hist"] = ind.macd(c)[2] / c
    f["dist_sma20"] = c / ind.sma(c, 20) - 1
    f["dist_sma50"] = c / ind.sma(c, 50) - 1
    up, _, low = ind.bollinger(c)
    f["bb_pos"] = (c - low) / (up - low).replace(0, np.nan)
    f["vol10"] = ret.rolling(10).std()
    vol = df["volume"].replace(0, np.nan)
    f["vol_chg"] = (vol / vol.rolling(20).mean() - 1).fillna(0)
    f["range"] = (df["high"] - df["low"]) / c
    f["target_ret"] = ret.shift(-1)
    return f.replace([np.inf, -np.inf], np.nan)


def _models():
    return {
        "Lojistik/Ridge Regresyon": (
            make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
            make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
        ),
        "Rastgele Orman": (
            RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=5, random_state=42, n_jobs=-1),
            RandomForestRegressor(n_estimators=300, max_depth=6, min_samples_leaf=5, random_state=42, n_jobs=-1),
        ),
        "Gradyan Artırma": (
            HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, random_state=42),
            HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=200, random_state=42),
        ),
        "Yapay Sinir Ağı (MLP)": (
            make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-3,
                                                          max_iter=600, early_stopping=True, random_state=42)),
            make_pipeline(StandardScaler(), MLPRegressor(hidden_layer_sizes=(32, 16), alpha=1e-3,
                                                         max_iter=600, early_stopping=True, random_state=42)),
        ),
    }


def _metrics(y_ret, pred_ret, y_dir, pred_dir, prices_prev):
    actual_price = prices_prev * (1 + y_ret)
    pred_price = prices_prev * (1 + pred_ret)
    err = actual_price - pred_price
    return {
        "direction_accuracy": round(float((pred_dir == y_dir).mean() * 100), 2),
        "mae": round(float(np.abs(err).mean()), 6),
        "rmse": round(float(np.sqrt((err ** 2).mean())), 6),
        "mae_pct": round(float(np.abs(y_ret - pred_ret).mean() * 100), 4),
    }


def predict(df: pd.DataFrame, test_ratio: float = 0.2) -> dict:
    feats = build_features(df)
    data = feats.dropna(subset=FEATURES + ["target_ret"])
    if len(data) < 150:
        raise ValueError("Model eğitimi için yeterli veri yok (en az ~150 işlem günü gerekir).")

    X, y_ret = data[FEATURES].values, data["target_ret"].values
    y_dir = (y_ret > 0).astype(int)
    prices = df.loc[data.index, "close"].values
    split = int(len(data) * (1 - test_ratio))
    Xtr, Xte = X[:split], X[split:]

    results = []
    # Naif model: getirinin sıfır olduğu (fiyat değişmez) ve yönün bugünküyle aynı olduğu varsayımı
    naive_dir = (data["ret1"].values[split:] > 0).astype(int)
    results.append({"model": "Naif Model (referans)",
                    **_metrics(y_ret[split:], np.zeros(len(Xte)), y_dir[split:], naive_dir, prices[split:])})

    test_series, next_out, info, durations = {}, {}, {}, {}
    last_x = feats[FEATURES].dropna().iloc[[-1]].values

    def record(name, p_dir, p_ret, started):
        durations[name] = round(time.time() - started, 2)
        results.append({"model": name, **_metrics(y_ret[split:], p_ret, y_dir[split:], p_dir, prices[split:]),
                        "seconds": durations[name]})
        test_series[name] = p_ret

    for name, (clf, reg) in _models().items():
        t0 = time.time()
        clf.fit(Xtr, y_dir[:split])
        reg.fit(Xtr, y_ret[:split])
        record(name, clf.predict(Xte), reg.predict(Xte), t0)

    # Zaman serisi modelleri (kurulu değilse veya hata verirse atlanır)
    for name, fn in (
        ("ARIMA", lambda: seq_models.arima(df["close"].pct_change(), data.index, split)),
        ("LSTM (Derin Öğrenme)", lambda: seq_models.lstm(X, y_dir, y_ret, split, np.vstack([X, last_x]))),
    ):
        t0 = time.time()
        try:
            out = fn()
        except ImportError:
            continue  # isteğe bağlı kütüphane (ör. PyTorch) kurulu değilse model atlanır
        except Exception as e:  # noqa: BLE001
            info[name] = f"çalıştırılamadı: {e}"
            continue
        record(name, out["test_dir"], out["test_ret"], t0)
        next_out[name] = (out["next_up_prob"], out["next_ret"])
        info[name] = out["info"]

    ml_results = [r for r in results if r["model"] != "Naif Model (referans)"]
    best_name = max(ml_results, key=lambda r: r["direction_accuracy"])["model"]

    if best_name in next_out:
        up_prob, exp_ret = next_out[best_name]
    else:
        # En iyi modeli tüm veriyle yeniden eğitip bir sonraki gün için tahmin üret
        clf, reg = _models()[best_name]
        clf.fit(X, y_dir)
        reg.fit(X, y_ret)
        up_prob = float(clf.predict_proba(last_x)[0][1])
        exp_ret = float(reg.predict(last_x)[0])
    last_price = float(df["close"].iloc[-1])

    # Öznitelik önemleri, yorumlanabilirlik için Rastgele Orman sınıflandırıcısından alınır
    rf = _models()["Rastgele Orman"][0].fit(X, y_dir)
    importance = sorted(
        [{"feature": f, "importance": round(float(v), 4)} for f, v in zip(FEATURES, rf.feature_importances_)],
        key=lambda d: -d["importance"],
    )

    times = df.loc[data.index[split:], "time"].values
    next_times = list(times[1:]) + [int(times[-1]) + 86400]
    chart = {
        "actual": [{"time": int(t), "value": round(float(p * (1 + r)), 6)}
                   for t, p, r in zip(next_times, prices[split:], y_ret[split:])],
        "predicted": [{"time": int(t), "value": round(float(p * (1 + r)), 6)}
                      for t, p, r in zip(next_times, prices[split:], test_series[best_name])],
    }

    return {
        "best_model": best_name,
        "metrics": results,
        "train_size": split,
        "test_size": len(Xte),
        "forecast": {
            "last_price": last_price,
            "up_probability": round(up_prob * 100, 2),
            "direction": "Yükseliş" if up_prob >= 0.5 else "Düşüş",
            "expected_return_pct": round(exp_ret * 100, 4),
            "expected_price": round(last_price * (1 + exp_ret), 6),
        },
        "feature_importance": importance,
        "model_info": info,
        "all_forecasts": {k: {"up_probability": round(v[0] * 100, 2), "expected_return_pct": round(v[1] * 100, 4)}
                          for k, v in next_out.items()},
        "chart": chart,
        "disclaimer": "Bu tahminler istatistiksel modellere dayanır, yatırım tavsiyesi değildir.",
    }
