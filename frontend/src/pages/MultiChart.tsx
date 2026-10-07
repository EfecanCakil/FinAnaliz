import { useEffect, useMemo, useState } from 'react'
import { api, fmtPct, fmtPrice, tone, type Candle } from '../api'
import Chart, { ChartStyleToggle, type SeriesSpec } from '../components/Chart'
import { SymbolPicker } from '../components/common'
import { Skeleton } from '../components/ui'

const DEFAULTS = ['XU100.IS', 'USDTRY=X', 'GRAM-ALTIN', 'BTC-USD']
const PERIODS = [{ p: '1mo', i: '1h', l: '1A' }, { p: '3mo', i: '1d', l: '3A' }, { p: '6mo', i: '1d', l: '6A' }, { p: '1y', i: '1d', l: '1Y' }, { p: '5y', i: '1wk', l: '5Y' }]
const KEY = 'finanaliz_multichart'

function Panel({ symbol, onChange, period, sync }: { symbol: string; onChange: (s: string) => void; period: typeof PERIODS[number]; sync: boolean }) {
  const [data, setData] = useState<{ name: string; currency: string; candles: Candle[] } | null>(null)
  useEffect(() => {
    setData(null)
    api(`/history/${encodeURIComponent(symbol)}?period=${period.p}&interval=${period.i}`).then(setData).catch(() => setData({ name: symbol, currency: '', candles: [] }))
  }, [symbol, period])
  const series = useMemo<SeriesSpec[]>(() => data?.candles.length ? [{ kind: 'candle', data: data.candles }, { kind: 'volume', data: data.candles }] : [], [data])
  const c = data?.candles ?? []
  const last = c[c.length - 1]?.close, first = c[0]?.close
  return (
    <div className="card mc-panel">
      <div className="row between gap">
        <SymbolPicker value={symbol} onChange={onChange} />
        {last != null && <div className="nowrap"><span className="mono strong">{fmtPrice(last)}</span> <span className={`small ${tone(last - first)}`}>{fmtPct((last / first - 1) * 100)}</span></div>}
      </div>
      {!data ? <Skeleton rows={6} /> : series.length ? <Chart series={series} height={300} syncGroup={sync ? 'multi' : undefined} /> : <p className="muted">Veri yok.</p>}
    </div>
  )
}

export default function MultiChart() {
  const [symbols, setSymbols] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) || '') } catch { return DEFAULTS } })
  const [period, setPeriod] = useState(PERIODS[3])
  const [sync, setSync] = useState(true)
  const set = (i: number, s: string) => {
    const next = symbols.map((x, k) => k === i ? s : x)
    setSymbols(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* yoksay */ }
  }
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Çoklu Grafik</h1><p className="muted">Dört varlığı yan yana izleyin; kaydırma ve yakınlaştırma tüm grafiklerde birlikte çalışır</p></div>
        <div className="row gap">
          <ChartStyleToggle />
          <label className="toggle-row small"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />Zaman eksenini eşle</label>
          <div className="seg">{PERIODS.map(p => <button key={p.l} className={p.l === period.l ? 'active' : ''} onClick={() => setPeriod(p)}>{p.l}</button>)}</div>
        </div>
      </header>
      <div className="grid-multi">
        {symbols.map((s, i) => <Panel key={i} symbol={s} onChange={x => set(i, x)} period={period} sync={sync} />)}
      </div>
    </div>
  )
}
