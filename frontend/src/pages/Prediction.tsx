import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtPct, fmtPrice, tone, type Point } from '../api'
import Chart, { COLORS, type SeriesSpec } from '../components/Chart'
import { ErrorBox, Loading, Stat, SymbolPicker } from '../components/common'

type Metric = { model: string; direction_accuracy: number; mae: number; rmse: number; mae_pct: number; seconds?: number }
type PredRes = {
  best_model: string; metrics: Metric[]; train_size: number; test_size: number
  forecast: { last_price: number; up_probability: number; direction: string; expected_return_pct: number; expected_price: number }
  feature_importance: { feature: string; importance: number }[]
  model_info: Record<string, string>
  all_forecasts: Record<string, { up_probability: number; expected_return_pct: number }>
  chart: { actual: Point[]; predicted: Point[] }
  disclaimer: string
}

const FEATURE_LABELS: Record<string, string> = {
  ret1: '1 günlük getiri', ret2: '2 günlük getiri', ret3: '3 günlük getiri', ret5: '5 günlük getiri', ret10: '10 günlük getiri',
  rsi: 'RSI', macd_hist: 'MACD histogram', dist_sma20: 'SMA20 uzaklığı', dist_sma50: 'SMA50 uzaklığı',
  bb_pos: 'Bollinger konumu', vol10: '10 günlük oynaklık', vol_chg: 'Hacim değişimi', range: 'Gün içi aralık',
}

export default function Prediction() {
  const [params, setParams] = useSearchParams()
  const symbol = params.get('s') || 'BTC-USD'
  const [period, setPeriod] = useState('2y')
  const [res, setRes] = useState<PredRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    setBusy(true); setError(null); setRes(null)
    api<PredRes>(`/predict/${encodeURIComponent(symbol)}?period=${period}`).then(setRes).catch(e => setError(e.message)).finally(() => setBusy(false))
  }

  const series = useMemo<SeriesSpec[]>(() => res ? [
    { kind: 'line', data: res.chart.actual, color: COLORS.gray, title: 'Gerçek', width: 2 },
    { kind: 'line', data: res.chart.predicted, color: COLORS.orange, title: 'Tahmin', width: 1 },
  ] : [], [res])

  const maxImp = res?.feature_importance[0]?.importance ?? 1

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Yapay Zekâ ile Fiyat Tahmini</h1><p className="muted">Makine öğrenmesi modelleriyle ertesi gün fiyat yönü ve getiri tahmini</p></div>
      </header>
      <div className="card">
        <div className="row gap wrap">
          <SymbolPicker value={symbol} onChange={s => { setParams({ s }); setRes(null) }} />
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="1y">1 yıllık veri</option><option value="2y">2 yıllık veri</option><option value="5y">5 yıllık veri</option>
          </select>
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Modeller eğitiliyor…' : 'Modelleri Eğit ve Tahmin Et'}</button>
        </div>
        <p className="muted small mt">
          Fiyat geçmişinden 13 öznitelik (getiriler, RSI, MACD, hareketli ortalama uzaklıkları, Bollinger konumu, oynaklık, hacim) türetilir.
          Verinin ilk %80'i ile eğitim, son %20'si ile zaman sırası korunarak test yapılır. Lojistik/Ridge regresyon, Rastgele Orman,
          Gradyan Artırma, Yapay Sinir Ağı (MLP) ve klasik zaman serisi modeli <b>ARIMA</b> karşılaştırılır.
          Test döneminde yön doğruluğu en yüksek olan model tahmin için kullanılır.
        </p>
      </div>
      <ErrorBox error={error} />
      {busy && <Loading text="Veriler hazırlanıyor ve modeller eğitiliyor…" />}
      {res && (
        <>
          <div className="grid4">
            <div className="card kpi">
              <div className="muted small">Ertesi gün beklenen yön</div>
              <div className={`kpi-value ${res.forecast.up_probability >= 50 ? 'up' : 'down'}`}>{res.forecast.up_probability >= 50 ? '▲' : '▼'} {res.forecast.direction}</div>
              <div className="muted small">Yükseliş olasılığı: %{res.forecast.up_probability.toFixed(1)}</div>
              <div className="prob"><div style={{ width: `${res.forecast.up_probability}%` }} /></div>
            </div>
            <div className="card kpi"><div className="muted small">Son fiyat</div><div className="kpi-value">{fmtPrice(res.forecast.last_price)}</div></div>
            <div className="card kpi">
              <div className="muted small">Beklenen getiri (regresyon)</div>
              <div className={`kpi-value ${tone(res.forecast.expected_return_pct)}`}>{fmtPct(res.forecast.expected_return_pct)}</div>
              <div className="muted small">Tahmini fiyat: {fmtPrice(res.forecast.expected_price)}</div>
            </div>
            <div className="card kpi"><div className="muted small">Seçilen model</div><div className="kpi-value sm">{res.best_model}</div>
              <div className="muted small">Eğitim: {res.train_size} gün · Test: {res.test_size} gün</div></div>
          </div>

          <div className="card">
            <h3>Model Karşılaştırması (test verisi)</h3>
            <table className="table">
              <thead><tr><th>Model</th><th className="r">Yön Doğruluğu</th><th className="r">MAE (fiyat)</th><th className="r">RMSE (fiyat)</th><th className="r">MAE (getiri %)</th><th className="r">Süre</th></tr></thead>
              <tbody>
                {res.metrics.map(m => (
                  <tr key={m.model} className={m.model === res.best_model ? 'highlight' : ''}>
                    <td>{m.model}{m.model === res.best_model && <span className="pill up ml">seçildi</span>}
                      {res.model_info[m.model] && <div className="muted small">{res.model_info[m.model]}</div>}</td>
                    <td className="r mono">%{m.direction_accuracy.toFixed(2)}</td>
                    <td className="r mono">{fmtPrice(m.mae)}</td>
                    <td className="r mono">{fmtPrice(m.rmse)}</td>
                    <td className="r mono">{m.mae_pct.toFixed(3)}</td>
                    <td className="r mono muted">{m.seconds !== undefined ? `${m.seconds.toLocaleString('tr-TR')} sn` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Not: Finansal zaman serilerinde %50'nin belirgin üzerinde yön doğruluğu elde etmek zordur. Naif model, karşılaştırma için referans olarak verilmiştir.</p>
          </div>

          {Object.keys(res.all_forecasts).length > 0 && (
            <div className="card">
              <h3>Zaman Serisi Modellerinin Ertesi Gün Tahminleri</h3>
              <table className="table">
                <thead><tr><th>Model</th><th className="r">Yükseliş olasılığı</th><th className="r">Beklenen getiri</th><th className="r">Yön</th></tr></thead>
                <tbody>
                  {Object.entries(res.all_forecasts).map(([k, f]) => (
                    <tr key={k}><td>{k}</td><td className="r mono">%{f.up_probability.toFixed(1)}</td>
                      <td className={`r mono ${tone(f.expected_return_pct)}`}>{fmtPct(f.expected_return_pct)}</td>
                      <td className="r"><span className={`pill ${f.up_probability >= 50 ? 'up' : 'down'}`}>{f.up_probability >= 50 ? 'Yükseliş' : 'Düşüş'}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid2">
            <div className="card">
              <h3>Test Döneminde Gerçek ve Tahmin Edilen Fiyat ({res.best_model})</h3>
              <Chart series={series} height={320} />
            </div>
            <div className="card">
              <h3>Öznitelik Önemi</h3>
              {res.feature_importance.length === 0 ? <p className="muted">Öznitelik önemi yalnızca ağaç tabanlı (Rastgele Orman) modelde gösterilir.</p> : (
                <div className="bars">
                  {res.feature_importance.map(f => (
                    <div key={f.feature} className="bar-row">
                      <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                      <div className="bar"><div style={{ width: `${(f.importance / maxImp) * 100}%` }} /></div>
                      <span className="mono small">{(f.importance * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid2 mt">
                <Stat label="Yükseliş olasılığı" value={`%${res.forecast.up_probability.toFixed(1)}`} />
                <Stat label="Düşüş olasılığı" value={`%${(100 - res.forecast.up_probability).toFixed(1)}`} />
              </div>
            </div>
          </div>
          <p className="disclaimer">{res.disclaimer}</p>
        </>
      )}
    </div>
  )
}
