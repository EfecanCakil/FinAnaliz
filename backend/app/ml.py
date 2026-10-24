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


def _next_session(df: pd.DataFrame) -> int:
    """Son mumdan sonraki işlem günü (hafta sonu işlem görmeyen varlıklarda cumartesi/pazar atlanır)."""
    t = int(df["time"].iloc[-1])
    days = (pd.to_datetime(df["time"].iloc[-30:], unit="s") + pd.Timedelta(hours=12)).dt.dayofweek  # yerel işlem günü
    trades_weekend = bool((days >= 5).any())
    nxt = t + 86400
    while not trades_weekend and (pd.Timestamp(nxt, unit="s") + pd.Timedelta(hours=12)).dayofweek >= 5:
        nxt += 86400
    return nxt


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
        explain_clf, explain_name = _models()["Rastgele Orman"][0].fit(X, y_dir), "Rastgele Orman"
    else:
        # En iyi modeli tüm veriyle yeniden eğitip bir sonraki gün için tahmin üret
        clf, reg = _models()[best_name]
        clf.fit(X, y_dir)
        reg.fit(X, y_ret)
        up_prob = float(clf.predict_proba(last_x)[0][1])
        exp_ret = float(reg.predict(last_x)[0])
        explain_clf, explain_name = clf, best_name
    try:
        explanation = explain(explain_clf, X, last_x, explain_name)
    except Exception:
        explanation = None
    last_price = float(df["close"].iloc[-1])

    # Öznitelik önemleri, yorumlanabilirlik için Rastgele Orman sınıflandırıcısından alınır
    rf = _models()["Rastgele Orman"][0].fit(X, y_dir)
    importance = sorted(
        [{"feature": f, "importance": round(float(v), 4)} for f, v in zip(FEATURES, rf.feature_importances_)],
        key=lambda d: -d["importance"],
    )

    times = df.loc[data.index[split:], "time"].values
    next_times = list(times[1:]) + [_next_session(df)]
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
            "data_date": (pd.Timestamp(int(df["time"].iloc[-1]), unit="s") + pd.Timedelta(hours=12)).strftime("%Y-%m-%d"),
            "target_date": (pd.Timestamp(_next_session(df), unit="s") + pd.Timedelta(hours=12)).strftime("%Y-%m-%d"),
            "up_probability": round(up_prob * 100, 2),
            "direction": "Yükseliş" if up_prob >= 0.5 else "Düşüş",
            "expected_return_pct": round(exp_ret * 100, 4),
            "expected_price": round(last_price * (1 + exp_ret), 6),
        },
        "feature_importance": importance,
        "explanation": explanation,
        "model_info": info,
        "all_forecasts": {k: {"up_probability": round(v[0] * 100, 2), "expected_return_pct": round(v[1] * 100, 4)}
                          for k, v in next_out.items()},
        "chart": chart,
        "disclaimer": "Bu tahminler istatistiksel modellere dayanır, yatırım tavsiyesi değildir.",
    }


# ----------------------------------------------------------------------------- açıklanabilir yapay zekâ
def _describe(feature: str, v: float) -> str:
    """Özniteliğin bugünkü değerini sade Türkçeyle anlatır."""
    def pct(x: float, d: int = 1) -> str:
        return f"%{abs(x) * 100:.{d}f}".replace(".", ",")
    sign = "+" if v >= 0 else "−"
    if feature.startswith("ret"):
        return f"Son {feature[3:]} günlük getiri {sign}{pct(v)}"
    if feature == "rsi":
        r = v * 100
        return f"RSI {r:.0f}" + (" (aşırı alım bölgesi)" if r >= 70 else " (aşırı satım bölgesi)" if r <= 30 else "")
    if feature == "macd_hist":
        return "MACD histogramı pozitif (yükseliş momentumu)" if v >= 0 else "MACD histogramı negatif (düşüş momentumu)"
    if feature in ("dist_sma20", "dist_sma50"):
        return f"Fiyat {feature[-2:]} günlük ortalamanın {pct(v)} {'üzerinde' if v >= 0 else 'altında'}"
    if feature == "bb_pos":
        return f"Bollinger bandı içindeki konum %{v * 100:.0f}" + (" (üst banda yakın)" if v >= 0.8 else " (alt banda yakın)" if v <= 0.2 else "")
    if feature == "vol10":
        return f"Son 10 günde günlük ortalama oynaklık {pct(v)}"
    if feature == "vol_chg":
        return f"İşlem hacmi 20 günlük ortalamanın {pct(v, 0)} {'üzerinde' if v >= 0 else 'altında'}"
    if feature == "range":
        return f"Son günün fiyat aralığı {pct(v)}"
    return f"{feature} = {v:.4g}"


def explain(clf, X: np.ndarray, last_x: np.ndarray, model_name: str) -> dict:
    """Bugünkü tahmine her özniteliğin katkısı (yerel açıklama). Her öznitelik sırayla eğitim verisindeki tipik
    (medyan) değerine çekilir; yükseliş olasılığındaki değişim, o özniteliğin tahmine katkısı sayılır."""
    base_x = np.median(X, axis=0, keepdims=True)
    p_now = float(clf.predict_proba(last_x)[0][1])
    p_base = float(clf.predict_proba(base_x)[0][1])
    trial = np.repeat(last_x, len(FEATURES), axis=0)
    for i in range(len(FEATURES)):
        trial[i, i] = base_x[0, i]
    p_without = clf.predict_proba(trial)[:, 1]
    factors = []
    for i, f in enumerate(FEATURES):
        c = (p_now - float(p_without[i])) * 100
        factors.append({"feature": f, "value": float(last_x[0, i]), "contribution": round(c, 2),
                        "text": _describe(f, float(last_x[0, i]))})
    factors.sort(key=lambda d: -abs(d["contribution"]))
    top = [d for d in factors if abs(d["contribution"]) >= 0.05][:6]
    ups = [d for d in top if d["contribution"] > 0]
    downs = [d for d in top if d["contribution"] < 0]
    summary = f"Model yarın için %{p_now * 100:.0f} yükseliş olasılığı veriyor (tipik bir günde bu oran %{p_base * 100:.0f})."
    if ups:
        summary += f" En çok yukarı iten: {ups[0]['text'][0].lower() + ups[0]['text'][1:]}."
    if downs:
        summary += f" En çok aşağı çeken: {downs[0]['text'][0].lower() + downs[0]['text'][1:]}."
    return {"model": model_name, "probability": round(p_now * 100, 2), "baseline": round(p_base * 100, 2),
            "factors": factors, "top": top, "summary": summary,
            "method": "Her gösterge tek tek tipik değerine çekilerek tahminin ne kadar değiştiği ölçüldü (yerel duyarlılık analizi)."}


# ----------------------------------------------------------------------------- model başarı karnesi
_card_cache: dict[tuple, tuple[float, dict]] = {}
CARD_TTL = 6 * 3600


def scorecard(df: pd.DataFrame, key: tuple, test_days: int = 126, step: int = 21) -> dict:
    """İleriye yürüyen (walk-forward) test: son ~6 ayda her ay yalnızca o güne kadarki veriyle yeniden eğitilen modeller
    ertesi günün yönünü tahmin eder. Sonuçlar yazı-tura ve basit kurallarla karşılaştırılır."""
    from scipy.stats import binomtest
    hit = _card_cache.get(key)
    if hit and time.time() - hit[0] < CARD_TTL:
        return hit[1]
    feats = build_features(df)
    data = feats.dropna(subset=FEATURES + ["target_ret"])
    if len(data) < test_days + 200:
        raise ValueError("Başarı karnesi için en az ~1,5 yıllık fiyat geçmişi gerekir; daha uzun bir veri dönemi seçin.")
    X, y_ret = data[FEATURES].values, data["target_ret"].values
    y_dir = (y_ret > 0).astype(int)
    start = len(data) - test_days
    names = ["Lojistik/Ridge Regresyon", "Rastgele Orman", "Gradyan Artırma"]
    probs = {n: np.full(test_days, np.nan) for n in names}
    for a in range(start, len(data), step):
        b = min(a + step, len(data))
        for n in names:
            clf = _models()[n][0]
            clf.fit(X[:a], y_dir[:a])
            probs[n][a - start:b - start] = clf.predict_proba(X[a:b])[:, 1]
    actual, rets = y_dir[start:], y_ret[start:]
    n = len(actual)
    up_rate = float(actual.mean() * 100)
    persist = (data["ret1"].values[start:] > 0).astype(int)
    times = df.loc[data.index[start:], "time"].values
    next_times = list(times[1:]) + [int(times[-1]) + 86400]

    models = []
    for name in names:
        p = probs[name]
        pred = (p >= 0.5).astype(int)
        correct = int((pred == actual).sum())
        pval = float(binomtest(correct, n, 0.5, alternative="greater").pvalue)
        conf = (p >= 0.6) | (p <= 0.4)
        conf_acc = float((pred[conf] == actual[conf]).mean() * 100) if conf.sum() >= 5 else None
        strat = np.cumprod(1 + np.where(pred == 1, rets, 0.0)) - 1
        monthly = [{"from": int(next_times[a]), "accuracy": round(float((pred[a:a + step] == actual[a:a + step]).mean() * 100), 1),
                    "days": int(len(actual[a:a + step]))} for a in range(0, n, step)]
        models.append({"model": name, "accuracy": round(correct / n * 100, 2), "correct": correct, "days": n,
                       "p_value": round(pval, 4), "confident_accuracy": round(conf_acc, 2) if conf_acc is not None else None,
                       "confident_days": int(conf.sum()), "strategy_return": round(float(strat[-1] * 100), 2), "monthly": monthly,
                       "equity": [{"time": int(t), "value": round(float(v * 100), 3)} for t, v in zip(next_times, strat)]})
    hold = np.cumprod(1 + rets) - 1
    best = max(models, key=lambda m: m["accuracy"])
    bar = max(50.0, up_rate)
    acc_s = f"%{best['accuracy']:.1f}".replace(".", ",")
    pv = f"{best['p_value']:.3f}".replace(".", ",")
    bar_s = f"%{bar:.1f}".replace(".", ",")
    if best["p_value"] < 0.05 and best["accuracy"] > bar + 2:
        grade = "A"
        verdict = f"{best['model']} son {n} işlem gününde {acc_s} isabetle yazı-turadan istatistiksel olarak anlamlı biçimde daha iyi (p = {pv})."
    elif best["accuracy"] > bar + 2:
        grade = "B"
        verdict = (f"{best['model']} {acc_s} isabetle basit kuralların ({bar_s}) üzerinde, ancak fark istatistiksel olarak kesin değil "
                   f"(p = {pv}); şansla da açıklanabilir.")
    else:
        grade = "C"
        verdict = (f"Modeller bu varlıkta yazı-tura veya “her gün yükselir” gibi basit kurallardan ({bar_s}) belirgin şekilde iyi değil "
                   f"(en iyi model {acc_s}). Bu varlık için tahminleri temkinli yorumlayın.")
    out = {"days": n, "retrain_every": step, "grade": grade, "verdict": verdict, "best": best["model"],
           "baselines": {"coin": 50.0, "always_up": round(up_rate, 2), "persistence": round(float((persist == actual).mean() * 100), 2)},
           "buy_hold_return": round(float(hold[-1] * 100), 2),
           "buy_hold": [{"time": int(t), "value": round(float(v * 100), 3)} for t, v in zip(next_times, hold)],
           "models": models,
           "method": (f"Son {n} işlem günü aylık parçalara bölündü. Her parçanın başında modeller yalnızca o tarihe kadarki verilerle "
                      "yeniden eğitildi ve parçadaki her günün ertesi gün yönünü tahmin etti; gelecekteki veri hiçbir zaman eğitimde "
                      "kullanılmadı (ileriye yürüyen test).")}
    _card_cache[key] = (time.time(), out)
    return out
