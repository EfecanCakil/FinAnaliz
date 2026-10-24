"""Tanıtım uygulamasındaki "Deney sonuçları" bölümü için gerçek sonuçları üretir (sonuclar.js).

Projenin kendi modülleri (market, ml, backtest) gerçek piyasa verisiyle, uygulamadaki
varsayılan ayarlarla çalıştırılır. Sonuçlar dosyaya yazılır; tanıtım uygulaması internet
olmadan da bu ölçülmüş değerleri gösterir. İnternet gerektirir (Yahoo Finance).
"""
import json
import os
import sys
import tempfile
import time
import warnings
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "sonuclar.js"
# Önbellek kullanıcının veritabanına değil geçici bir klasöre yazılsın
os.environ["FINANS_DATA_DIR"] = str(Path(tempfile.gettempdir()) / "trademetrix-tanitim-sonuc")
Path(os.environ["FINANS_DATA_DIR"]).mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / "backend"))
warnings.filterwarnings("ignore")

from app import backtest, market, ml  # noqa: E402
from app.db import init_db  # noqa: E402

ASSETS = [
    ("THYAO.IS", "Türk Hava Yolları", "BIST"),
    ("GARAN.IS", "Garanti BBVA", "BIST"),
    ("XU100.IS", "BIST 100 Endeksi", "BIST"),
    ("AAPL", "Apple", "ABD"),
    ("USDTRY=X", "Dolar/TL", "Döviz"),
    ("BTC-USD", "Bitcoin", "Kripto"),
]


def main():
    init_db()
    results = []
    for symbol, name, market_name in ASSETS:
        t0 = time.time()
        try:
            df = market.to_frame(market.history(symbol, "2y", "1d"))
            pred = ml.predict(df)
            tests = [{"key": k, **backtest.run(df, k, {}, 10000, 0.1)["metrics"]} for k in backtest.STRATEGIES]
        except Exception as e:  # noqa: BLE001
            print(f"  {symbol}: atlandı ({e})")
            continue
        step = max(1, len(pred["chart"]["actual"]) // 60)
        extra = {}
        if not results:  # ilk varlık için tam fiyat serisi ve öznitelikler (sunumdaki etkileşimli grafikler için)
            feats = ml.build_features(df)
            data = feats.dropna(subset=ml.FEATURES + ["target_ret"])
            split = int(len(data) * 0.8)
            last = feats[ml.FEATURES].dropna().iloc[-1]
            extra = {
                "series": [[int(r.time), round(r.open, 4), round(r.high, 4), round(r.low, 4), round(r.close, 4), int(r.volume)]
                           for r in df.itertuples()],
                "features_last": {k: round(float(v), 6) for k, v in last.items()},
                "features_date": feats[ml.FEATURES].dropna().index[-1].strftime("%d.%m.%Y"),
                "data_start": int(df.loc[data.index[0], "time"]), "split_time": int(df.loc[data.index[split], "time"]),
                "dropped_rows": len(df) - len(data),
            }
        results.append({**extra,
            "symbol": symbol, "name": name, "market": market_name, "days": len(df),
            "start": df.index[0].strftime("%d.%m.%Y"), "end": df.index[-1].strftime("%d.%m.%Y"),
            "best_model": pred["best_model"], "train_size": pred["train_size"], "test_size": pred["test_size"],
            "metrics": pred["metrics"], "importance": pred["feature_importance"], "model_info": pred["model_info"],
            "forecast": pred["forecast"],
            "chart": {k: v[::step] for k, v in pred["chart"].items()},
            "backtest": tests,
        })
        print(f"  {symbol}: {len(df)} gün, en iyi {pred['best_model']} ({time.time() - t0:.0f} sn)")
    data = {"generated": datetime.now().strftime("%d.%m.%Y %H:%M"), "strategies": backtest.STRATEGIES, "assets": results}
    OUT.write_text("window.SONUC = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"{len(results)} varlık -> {OUT.name}")


if __name__ == "__main__":
    main()
