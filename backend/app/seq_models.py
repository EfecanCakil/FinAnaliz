"""Zaman serisi modelleri: ARIMA (statsmodels) ve LSTM derin öğrenme modeli (PyTorch).

Her iki model de ml.py'deki diğer modellerle aynı eğitim/test ayrımında
değerlendirilir ve aynı arayüzü döndürür:
    test_dir, test_ret      -> test dönemindeki yön (0/1) ve getiri tahminleri
    next_up_prob, next_ret  -> bir sonraki işlem günü için yükseliş olasılığı ve beklenen getiri
"""
import math
import warnings

import numpy as np
import pandas as pd


# ----------------------------------------------------------------------------- ARIMA
def arima(returns: pd.Series, data_index: pd.Index, split: int) -> dict:
    """returns: günlük getiri serisi; data_index: ml.py'deki öznitelik satırlarının tarihleri.
    Hedef, her satır tarihinden bir sonraki günün getirisidir."""
    from statsmodels.tsa.arima.model import ARIMA

    r = returns.dropna()
    train_end = data_index[split - 1]
    train = r[r.index <= train_end]

    # Küçük bir (p, q) ızgarasında AIC'ye göre model seçimi
    best, best_aic, best_order = None, math.inf, None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for p in range(3):
            for q in range(3):
                try:
                    res = ARIMA(train.values, order=(p, 0, q), trend="c").fit()
                except Exception:
                    continue
                if res.aic < best_aic:
                    best, best_aic, best_order = res, res.aic, (p, 0, q)
        # Eğitimde bulunan parametreler değiştirilmeden tüm seriye uygulanır (tek adım ileri tahmin)
        full = best.apply(r.values)
        one_step = pd.Series(full.predict(), index=r.index)  # t anındaki değer, t-1'e kadarki bilgiyle tahmin
        fc = full.get_forecast(1)
        next_ret = float(fc.predicted_mean[0])
        se = float(np.sqrt(fc.var_pred_mean[0])) or 1e-9

    pred_next = one_step.shift(-1)  # satır tarihi t için t+1 getirisinin tahmini
    test_ret = pred_next.reindex(data_index[split:]).fillna(0).values
    return {
        "test_ret": test_ret,
        "test_dir": (test_ret > 0).astype(int),
        "next_ret": next_ret,
        "next_up_prob": float(0.5 * (1 + math.erf(next_ret / se / math.sqrt(2)))),
        "info": f"ARIMA{best_order}, AIC={best_aic:.1f}",
    }


# ----------------------------------------------------------------------------- LSTM
SEQ_LEN = 20


def _sequences(X: np.ndarray, length: int) -> np.ndarray:
    out = np.zeros((len(X), length, X.shape[1]), dtype=np.float32)
    for i in range(len(X)):
        window = X[max(0, i - length + 1): i + 1]
        out[i, length - len(window):] = window  # başta yeterli geçmiş yoksa sıfırla doldurulur
    return out


def _train_lstm(Xs, y_dir, y_ret, epochs=60, seed=42):
    import torch
    from torch import nn

    torch.manual_seed(seed)
    np.random.seed(seed)

    class Net(nn.Module):
        def __init__(self, n_feat):
            super().__init__()
            self.lstm = nn.LSTM(n_feat, 32, batch_first=True)
            self.drop = nn.Dropout(0.2)
            self.cls = nn.Linear(32, 1)
            self.reg = nn.Linear(32, 1)

        def forward(self, x):
            h = self.drop(self.lstm(x)[0][:, -1])
            return self.cls(h).squeeze(-1), self.reg(h).squeeze(-1)

    ret_scale = float(np.std(y_ret)) or 1.0
    X_t = torch.tensor(Xs)
    yd_t = torch.tensor(y_dir, dtype=torch.float32)
    yr_t = torch.tensor(y_ret / ret_scale, dtype=torch.float32)

    # Son %15 doğrulama; en iyi doğrulama kaybındaki ağırlıklar kullanılır (erken durdurma)
    n_val = max(int(len(Xs) * 0.15), 10)
    idx_tr, idx_val = np.arange(len(Xs) - n_val), np.arange(len(Xs) - n_val, len(Xs))
    net = Net(Xs.shape[2])
    opt = torch.optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-4)
    bce, mse = nn.BCEWithLogitsLoss(), nn.MSELoss()
    best_state, best_loss, patience = None, math.inf, 0
    for _ in range(epochs):
        net.train()
        for b in np.array_split(np.random.permutation(idx_tr), max(1, len(idx_tr) // 64)):
            opt.zero_grad()
            logit, reg = net(X_t[b])
            loss = bce(logit, yd_t[b]) + mse(reg, yr_t[b])
            loss.backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            logit, reg = net(X_t[idx_val])
            val = float(bce(logit, yd_t[idx_val]) + mse(reg, yr_t[idx_val]))
        if val < best_loss - 1e-4:
            best_loss, patience = val, 0
            best_state = {k: v.clone() for k, v in net.state_dict().items()}
        else:
            patience += 1
            if patience >= 10:
                break
    if best_state:
        net.load_state_dict(best_state)
    net.eval()

    def predict(Xq):
        with torch.no_grad():
            logit, reg = net(torch.tensor(Xq))
        return torch.sigmoid(logit).numpy(), reg.numpy() * ret_scale

    return predict


def lstm(X: np.ndarray, y_dir: np.ndarray, y_ret: np.ndarray, split: int, X_last_rows: np.ndarray) -> dict:
    """X: tüm satırların öznitelikleri; X_last_rows: hedefi henüz bilinmeyen son satırlar dahil tüm öznitelikler."""
    import torch
    from sklearn.preprocessing import StandardScaler

    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
    scaler = StandardScaler().fit(X[:split])
    Xs = _sequences(scaler.transform(X).astype(np.float32), SEQ_LEN)
    predict = _train_lstm(Xs[:split], y_dir[:split], y_ret[:split])
    prob, ret = predict(Xs[split:])

    # Tahmin için tüm veriyle yeniden eğitim
    scaler_all = StandardScaler().fit(X)
    Xs_all = _sequences(scaler_all.transform(X_last_rows).astype(np.float32), SEQ_LEN)
    predict_all = _train_lstm(Xs_all[: len(X)], y_dir, y_ret)
    p_next, r_next = predict_all(Xs_all[-1:])
    return {
        "test_dir": (prob >= 0.5).astype(int),
        "test_ret": ret,
        "next_up_prob": float(p_next[0]),
        "next_ret": float(r_next[0]),
        "info": f"LSTM (32 birim, {SEQ_LEN} günlük pencere, erken durdurma)",
    }
