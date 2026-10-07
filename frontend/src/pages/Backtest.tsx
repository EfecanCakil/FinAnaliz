import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtPct, fmtPrice, tone, type Point } from '../api'
import Chart, { COLORS, type SeriesSpec } from '../components/Chart'
import { Disclaimer, ErrorBox, Loading, Stat, SymbolPicker } from '../components/common'

type Trade = { entry_time: number; entry_price: number; exit_time: number | null; exit_price: number; return_pct: number }
type BtRes = {
  strategy: string
  metrics: Record<string, number>
  equity: Point[]; benchmark: Point[]; trades: Trade[]
}

const PARAMS: Record<string, { key: string; label: string; def: number }[]> = {
  sma_cross: [{ key: 'fast', label: 'Hızlı SMA', def: 20 }, { key: 'slow', label: 'Yavaş SMA', def: 50 }],
  rsi: [{ key: 'period', label: 'RSI periyodu', def: 14 }, { key: 'lower', label: 'Alış eşiği', def: 30 }, { key: 'upper', label: 'Satış eşiği', def: 70 }],
  bollinger: [{ key: 'period', label: 'Bant periyodu', def: 20 }],
  macd: [], buy_hold: [],
}

export default function Backtest() {
  const [sp, setSp] = useSearchParams()
  const symbol = sp.get('s') || 'AAPL'
  const [strategies, setStrategies] = useState<Record<string, string>>({})
  const [strategy, setStrategy] = useState('sma_cross')
  const [period, setPeriod] = useState('2y')
  const [capital, setCapital] = useState(10000)
  const [commission, setCommission] = useState(0.1)
  const [params, setParams] = useState<Record<string, number>>({})
  const [res, setRes] = useState<BtRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { api('/backtest/strategies').then(setStrategies).catch(() => {}) }, [])
  useEffect(() => { setParams(Object.fromEntries(PARAMS[strategy].map(p => [p.key, p.def]))) }, [strategy])

  const run = () => {
    setBusy(true); setError(null)
    api<BtRes>('/backtest', { body: { symbol, strategy, period, params, capital, commission_pct: commission } })
      .then(setRes).catch(e => setError(e.message)).finally(() => setBusy(false))
  }

  const series = useMemo<SeriesSpec[]>(() => res ? [
    { kind: 'area', data: res.equity, color: COLORS.blue, title: 'Strateji' },
    { kind: 'line', data: res.benchmark, color: COLORS.gray, title: 'Al-Tut', width: 1 },
  ] : [], [res])

  const m = res?.metrics
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Strateji Testi (Backtesting)</h1><p className="muted">Teknik göstergelere dayalı stratejileri geçmiş veriler üzerinde deneyin</p></div>
      </header>
      <div className="card">
        <div className="form-grid">
          <label>Varlık<SymbolPicker value={symbol} onChange={s => setSp({ s })} /></label>
          <label>Strateji
            <select value={strategy} onChange={e => setStrategy(e.target.value)}>
              {Object.entries(strategies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Dönem
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="6mo">6 ay</option><option value="1y">1 yıl</option><option value="2y">2 yıl</option><option value="5y">5 yıl</option>
            </select>
          </label>
          <label>Başlangıç sermayesi<input type="number" min={100} value={capital} onChange={e => setCapital(+e.target.value)} /></label>
          <label>Komisyon (%)<input type="number" step="0.01" min={0} value={commission} onChange={e => setCommission(+e.target.value)} /></label>
          {PARAMS[strategy].map(p => (
            <label key={p.key}>{p.label}<input type="number" value={params[p.key] ?? p.def} onChange={e => setParams({ ...params, [p.key]: +e.target.value })} /></label>
          ))}
        </div>
        <button className="btn primary mt" onClick={run} disabled={busy}>{busy ? 'Test ediliyor…' : '▶ Testi Çalıştır'}</button>
        <p className="muted small mt">Sinyaller gün sonu kapanışına göre üretilir ve pozisyon ertesi gün açılır (ileriye bakma hatası önlenir). Yalnızca alım yönlü işlemler simüle edilir.</p>
      </div>
      <ErrorBox error={error} />
      {busy && <Loading />}
      {res && m && (
        <>
          <div className="card">
            <h3>{res.strategy} — {symbol}</h3>
            <div className="stats">
              <Stat label="Son portföy değeri" value={fmtPrice(m.final_equity)} />
              <Stat label="Toplam getiri" value={fmtPct(m.total_return_pct)} cls={tone(m.total_return_pct)} />
              <Stat label="Al-Tut getirisi" value={fmtPct(m.benchmark_return_pct)} cls={tone(m.benchmark_return_pct)} />
              <Stat label="Yıllık bileşik getiri" value={fmtPct(m.cagr_pct)} cls={tone(m.cagr_pct)} />
              <Stat label="Maks. düşüş" value={fmtPct(m.max_drawdown_pct)} cls="down" />
              <Stat label="Sharpe oranı" value={m.sharpe.toFixed(2)} />
              <Stat label="İşlem sayısı" value={m.trade_count} />
              <Stat label="Başarılı işlem oranı" value={fmtPct(m.win_rate_pct, false)} />
            </div>
            <Chart series={series} height={340} />
          </div>
          <div className="card">
            <h3>İşlemler (son {res.trades.length})</h3>
            {res.trades.length === 0 ? <p className="muted">Bu dönemde işlem oluşmadı.</p> : (
              <table className="table">
                <thead><tr><th>Giriş</th><th className="r">Giriş fiyatı</th><th>Çıkış</th><th className="r">Çıkış fiyatı</th><th className="r">Getiri</th></tr></thead>
                <tbody>
                  {[...res.trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td>{fmtDate(t.entry_time)}</td><td className="r mono">{fmtPrice(t.entry_price)}</td>
                      <td>{t.exit_time ? fmtDate(t.exit_time) : <span className="pill">açık</span>}</td><td className="r mono">{fmtPrice(t.exit_price)}</td>
                      <td className={`r mono ${tone(t.return_pct)}`}>{fmtPct(t.return_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  )
}
