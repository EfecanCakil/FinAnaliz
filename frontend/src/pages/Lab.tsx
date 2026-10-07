import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, fmtPct } from '../api'
import Chart, { COLORS, PALETTE, type SeriesSpec } from '../components/Chart'
import { ErrorBox, SymbolPicker } from '../components/common'
import { Skeleton } from '../components/ui'

type Pack = { weights: Record<string, number>; return_pct: number; volatility_pct: number; sharpe: number | null }
type Opt = { symbols: string[]; cloud: { vol: number; ret: number; sharpe: number }[]; min_volatility: Pack; max_sharpe: Pack; equal_weight: Pack
  assets: { symbol: string; return_pct: number; volatility_pct: number }[]; days: number }
type MC = { bands: Record<string, { time: number; value: number }[]>; final: Record<string, number>; prob_loss: number; prob_gain_20: number
  start_value: number; days: number; paths: number; history_days: number }
type Inf = { last_month: string; yearly: number; monthly: number; series: { month: string; yearly: number }[]; source: string }

function Frontier({ opt }: { opt: Opt }) {
  const W = 640, H = 340, P = 44
  const vs = [...opt.cloud.map(c => c.vol), ...opt.assets.map(a => a.volatility_pct)]
  const rs = [...opt.cloud.map(c => c.ret), ...opt.assets.map(a => a.return_pct)]
  const [x0, x1, y0, y1] = [Math.min(...vs) * 0.9, Math.max(...vs) * 1.05, Math.min(...rs, 0) - 5, Math.max(...rs) + 5]
  const X = (v: number) => P + (v - x0) / (x1 - x0) * (W - P - 10), Y = (r: number) => H - P + 10 - (r - y0) / (y1 - y0) * (H - P - 10)
  const sMin = Math.min(...opt.cloud.map(c => c.sharpe)), sMax = Math.max(...opt.cloud.map(c => c.sharpe))
  const col = (s: number) => `hsl(${(s - sMin) / (sMax - sMin || 1) * 120}, 65%, 50%)`
  const ticks = (a: number, b: number) => Array.from({ length: 5 }, (_, i) => a + (b - a) * i / 4)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="frontier">
      {ticks(x0, x1).map(t => <g key={'x' + t}><line x1={X(t)} x2={X(t)} y1={10} y2={H - P + 10} className="grid-line" /><text x={X(t)} y={H - P + 26} textAnchor="middle">%{t.toFixed(0)}</text></g>)}
      {ticks(y0, y1).map(t => <g key={'y' + t}><line x1={P} x2={W - 10} y1={Y(t)} y2={Y(t)} className="grid-line" /><text x={P - 6} y={Y(t) + 4} textAnchor="end">%{t.toFixed(0)}</text></g>)}
      {opt.cloud.map((c, i) => <circle key={i} cx={X(c.vol)} cy={Y(c.ret)} r={2} fill={col(c.sharpe)} opacity={0.55} />)}
      {opt.assets.map((a, i) => <g key={a.symbol}><circle cx={X(a.volatility_pct)} cy={Y(a.return_pct)} r={5} fill={PALETTE[i % PALETTE.length]} />
        <text x={X(a.volatility_pct) + 7} y={Y(a.return_pct) + 4} className="lbl">{a.symbol.replace('.IS', '')}</text></g>)}
      {([['max_sharpe', '★ En yüksek Sharpe', '#f5c542'], ['min_volatility', '◆ En düşük risk', '#4c8dff'], ['equal_weight', '● Eşit ağırlık', '#8892a0']] as const).map(([k, l, c]) => (
        <g key={k}><circle cx={X(opt[k].volatility_pct)} cy={Y(opt[k].return_pct)} r={7} fill={c} stroke="#fff" strokeWidth={2} />
          <text x={X(opt[k].volatility_pct) + 10} y={Y(opt[k].return_pct) - 8} className="lbl strong">{l}</text></g>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" className="axis">Yıllık oynaklık (risk)</text>
      <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="axis">Yıllık getiri (TL)</text>
    </svg>
  )
}

function Weights({ title, p, color }: { title: string; p: Pack; color: string }) {
  return (
    <div className="card weight-card" style={{ borderTopColor: color }}>
      <h3>{title}</h3>
      <div className="row gap small muted"><span>Getiri {fmtPct(p.return_pct)}</span><span>Risk {fmtPct(p.volatility_pct, false)}</span><span>Sharpe {p.sharpe?.toFixed(2)}</span></div>
      <div className="bars mt">{Object.entries(p.weights).sort((a, b) => b[1] - a[1]).map(([s, w]) => (
        <div key={s} className="bar-row"><span>{s.replace('.IS', '')}</span><div className="bar"><div style={{ width: `${w}%`, background: color }} /></div><span className="mono small">%{w.toFixed(1)}</span></div>
      ))}</div>
    </div>
  )
}

export default function Lab() {
  const [symbols, setSymbols] = useState<string[]>([])
  const [opt, setOpt] = useState<Opt | null>(null)
  const [mc, setMc] = useState<MC | null>(null)
  const [inf, setInf] = useState<Inf | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(252)
  const [calc, setCalc] = useState({ start: new Date(Date.now() - 365 * 864e5).toLocaleDateString('sv-SE'), nominal: '40' })
  const [real, setReal] = useState<{ inflation_pct: number; real_pct: number } | null>(null)

  useEffect(() => {
    api<{ items: { symbol: string }[] }>('/portfolio').then(p => setSymbols(p.items.length >= 2 ? p.items.map(i => i.symbol).slice(0, 8) : ['XU100.IS', '^GSPC', 'GRAM-ALTIN', 'BTC-USD'])).catch(() => {})
    api<Inf>('/inflation').then(setInf).catch(() => {})
  }, [])

  const runOpt = () => { setBusy('opt'); setError(null); api<Opt>('/optimize', { body: { symbols } }).then(setOpt).catch(e => setError(e.message)).finally(() => setBusy(null)) }
  const runMc = () => { setBusy('mc'); setError(null); api<MC>('/montecarlo', { body: { days } }).then(setMc).catch(e => setError(e.message)).finally(() => setBusy(null)) }
  const runReal = () => api<{ inflation_pct: number; real_pct: number }>(`/real-return?start=${calc.start}&nominal_pct=${+calc.nominal || 0}`).then(setReal).catch(e => setError(e.message))

  const mcSeries = useMemo<SeriesSpec[]>(() => mc ? [
    { kind: 'line', data: mc.bands['95'], color: COLORS.up, title: '%95', width: 1, dashed: true },
    { kind: 'line', data: mc.bands['75'], color: COLORS.teal, title: '%75', width: 1 },
    { kind: 'area', data: mc.bands['50'], color: COLORS.blue, title: 'Medyan' },
    { kind: 'line', data: mc.bands['25'], color: COLORS.orange, title: '%25', width: 1 },
    { kind: 'line', data: mc.bands['5'], color: COLORS.down, title: '%5', width: 1, dashed: true },
  ] : [], [mc])

  return (
    <div className="page">
      <header className="page-head"><div><h1>Portföy Laboratuvarı</h1><p className="muted">Portföy optimizasyonu, Monte Carlo simülasyonu ve enflasyona göre reel getiri</p></div></header>
      <ErrorBox error={error} />

      <div className="card">
        <h3>Etkin Sınır (Portföy Optimizasyonu)</h3>
        <p className="muted small">Seçilen varlıklarla binlerce rastgele dağılım denenir; son 1 yılın TL bazlı getiri ve riskine göre en düşük riskli ve getiri/risk oranı (Sharpe) en yüksek dağılım bulunur.</p>
        <div className="chips mt">
          {symbols.map((s, i) => <span key={s} className="chip on" style={{ ['--c' as string]: PALETTE[i % PALETTE.length] }}>{s}<button className="x" onClick={() => setSymbols(symbols.filter(x => x !== s))}>×</button></span>)}
        </div>
        <div className="row gap mt wrap">
          <div style={{ minWidth: 280 }}><SymbolPicker onChange={s => !symbols.includes(s) && symbols.length < 10 && setSymbols([...symbols, s])} placeholder="Varlık ekle (en fazla 10)" /></div>
          <button className="btn primary" onClick={runOpt} disabled={symbols.length < 2 || busy === 'opt'}>{busy === 'opt' ? 'Hesaplanıyor…' : '⚙ Optimize et'}</button>
        </div>
        {busy === 'opt' && <Skeleton rows={5} />}
        {opt && (
          <>
            <Frontier opt={opt} />
            <div className="grid3">
              <Weights title="★ En yüksek Sharpe" p={opt.max_sharpe} color="#f5c542" />
              <Weights title="◆ En düşük risk" p={opt.min_volatility} color="#4c8dff" />
              <Weights title="● Eşit ağırlık" p={opt.equal_weight} color="#8892a0" />
            </div>
            <p className="muted small">Hesaplama {opt.days} işlem gününe dayanır. Geçmiş performans gelecekteki sonuçların garantisi değildir.</p>
          </>
        )}
      </div>

      <div className="card">
        <div className="row between wrap gap">
          <h3>Monte Carlo Simülasyonu (mevcut portföyünüz)</h3>
          <div className="row gap">
            <select value={days} onChange={e => setDays(+e.target.value)}><option value={63}>3 ay</option><option value={126}>6 ay</option><option value={252}>1 yıl</option><option value={504}>2 yıl</option></select>
            <button className="btn primary" onClick={runMc} disabled={busy === 'mc'}>{busy === 'mc' ? 'Simüle ediliyor…' : '🎲 Simülasyonu çalıştır'}</button>
          </div>
        </div>
        <p className="muted small">Portföyünüzün son 2 yıldaki günlük getirileri rastgele yeniden örneklenerek 2.000 olası gelecek senaryosu üretilir. Bantlar, senaryoların %5–%95 aralığını gösterir.</p>
        {busy === 'mc' && <Skeleton rows={5} />}
        {mc && (
          <>
            <div className="grid4">
              <div className="card kpi"><div className="muted small">Başlangıç (yatırımlar)</div><div className="kpi-value sm">{fmtMoney(mc.start_value, 'TRY')}</div></div>
              <div className="card kpi"><div className="muted small">Medyan sonuç</div><div className="kpi-value sm">{fmtMoney(mc.final['50'], 'TRY')}</div><div className="muted small">{fmtPct((mc.final['50'] / mc.start_value - 1) * 100)}</div></div>
              <div className="card kpi"><div className="muted small">%90 olasılık aralığı</div><div className="kpi-value sm">{fmtMoney(mc.final['5'], 'TRY')} – {fmtMoney(mc.final['95'], 'TRY')}</div></div>
              <div className="card kpi"><div className="muted small">Zarar olasılığı / %20+ kazanç</div><div className="kpi-value sm"><span className="down">%{mc.prob_loss.toFixed(0)}</span> / <span className="up">%{mc.prob_gain_20.toFixed(0)}</span></div></div>
            </div>
            <Chart series={mcSeries} height={320} />
          </>
        )}
      </div>

      <ScenarioCard />
      <CorrelationCard />

      <div className="grid2">
        <div className="card">
          <h3>Enflasyon (TÜFE)</h3>
          {!inf ? <Skeleton rows={3} /> : (
            <>
              <div className="stats">
                <div className="stat"><div className="stat-label">Yıllık TÜFE ({inf.last_month})</div><div className="stat-value down">%{inf.yearly.toLocaleString('tr-TR')}</div></div>
                <div className="stat"><div className="stat-label">Aylık TÜFE</div><div className="stat-value">%{inf.monthly.toLocaleString('tr-TR')}</div></div>
              </div>
              <div className="div-bars">{inf.series.map(s => (
                <div key={s.month} className="div-col" title={`${s.month}: %${s.yearly}`}><div className="div-bar" style={{ height: `${s.yearly / Math.max(...inf.series.map(x => x.yearly)) * 100}%`, background: 'var(--down)' }} /></div>
              ))}</div>
              <p className="muted small">Son 36 ayın yıllık TÜFE değişimi. Kaynak: {inf.source}.</p>
            </>
          )}
        </div>
        <div className="card">
          <h3>Reel Getiri Hesaplayıcı</h3>
          <p className="muted small">Bir yatırımın nominal getirisini, aynı dönemdeki enflasyona göre düzeltin.</p>
          <div className="form-grid">
            <label>Başlangıç tarihi<input type="date" value={calc.start} onChange={e => setCalc({ ...calc, start: e.target.value })} /></label>
            <label>Nominal getiri (%)<input type="number" step="any" value={calc.nominal} onChange={e => setCalc({ ...calc, nominal: e.target.value })} /></label>
          </div>
          <button className="btn primary mt" onClick={runReal}>Hesapla</button>
          {real && (
            <div className="stats mt">
              <div className="stat"><div className="stat-label">Dönem enflasyonu</div><div className="stat-value">{fmtPct(real.inflation_pct, false)}</div></div>
              <div className="stat"><div className="stat-label">Reel getiri</div><div className={`stat-value ${real.real_pct >= 0 ? 'up' : 'down'}`}>{fmtPct(real.real_pct)}</div></div>
            </div>
          )}
          {real && <p className="small">{real.real_pct >= 0 ? 'Yatırımınız enflasyonun üzerinde getiri sağlamış; satın alma gücünüz artmış.' : 'Yatırımınız enflasyonun gerisinde kalmış; satın alma gücünüz azalmış.'}</p>}
        </div>
      </div>
    </div>
  )
}

type Corr = { symbols: string[]; matrix: number[][]; average: number | null; most_similar: { a: string; b: string; corr: number }[]; most_different: { a: string; b: string; corr: number }[]; days: number }

function CorrelationCard() {
  const [c, setC] = useState<Corr | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Corr>('/correlation', { body: {} }).then(setC).catch(e => setErr(e.message)) }, [])
  const color = (v: number) => v >= 0 ? `rgba(239,83,80,${0.12 + Math.abs(v) * 0.7})` : `rgba(76,141,255,${0.12 + Math.abs(v) * 0.7})`
  return (
    <div className="card">
      <h3>Portföy Korelasyon Isı Haritası</h3>
      <p className="muted small">Varlıklarınızın son 1 yılda birlikte ne kadar hareket ettiğini gösterir. Kırmızı: aynı yönde (çeşitlendirme zayıf), mavi: ters yönde (çeşitlendirme güçlü).</p>
      {err ? <p className="muted">{err} Portföyünüze farklı varlıklar ekledikçe bu harita oluşur.</p> : !c ? <Skeleton rows={4} /> : (
        <div className="grid-trade">
          <div className="table-wrap">
            <table className="corr-grid">
              <thead><tr><th />{c.symbols.map(s => <th key={s}>{s.replace('.IS', '').replace('-USD', '').replace('=X', '')}</th>)}</tr></thead>
              <tbody>{c.matrix.map((row, i) => (
                <tr key={i}><th>{c.symbols[i].replace('.IS', '').replace('-USD', '').replace('=X', '')}</th>
                  {row.map((v, j) => <td key={j} style={{ background: i === j ? 'var(--panel-2)' : color(v) }} title={`${c.symbols[i]} – ${c.symbols[j]}: ${v.toFixed(2)}`}>{v.toFixed(2)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <div>
            <div className="stat"><div className="stat-label">Ortalama korelasyon</div><div className="stat-value">{c.average?.toFixed(2)}</div></div>
            <p className="small">{(c.average ?? 0) > 0.6 ? '⚠️ Varlıklarınız büyük ölçüde birlikte hareket ediyor; çeşitlendirme sınırlı.' : (c.average ?? 0) > 0.3 ? 'ℹ️ Orta düzeyde birlikte hareket var.' : '✅ Varlıklarınız iyi çeşitlendirilmiş görünüyor.'}</p>
            <div className="muted small mt">En çok birlikte hareket eden</div>
            {c.most_similar.map(p => <div key={p.a + p.b} className="small">{p.a} ↔ {p.b}: <b>{p.corr.toFixed(2)}</b></div>)}
            <div className="muted small mt">En bağımsız hareket eden</div>
            {c.most_different.map(p => <div key={p.a + p.b} className="small">{p.a} ↔ {p.b}: <b>{p.corr.toFixed(2)}</b></div>)}
          </div>
        </div>
      )}
    </div>
  )
}

type Scn = { shocks: Record<string, number>; items: { symbol: string; value: number; impact_pct: number; impact_try: number; betas: Record<string, number>; r2: number }[]
  before: number; after: number; impact_try: number; impact_pct: number; days: number }
const SCN_PRESETS: { label: string; shocks: Record<string, number> }[] = [
  { label: '💵 Dolar %10 yükselirse', shocks: { 'USDTRY=X': 10 } },
  { label: '📉 BIST %15 düşerse', shocks: { 'XU100.IS': -15 } },
  { label: '🌎 Küresel satış (S&P −%20)', shocks: { '^GSPC': -20 } },
  { label: '🥇 Altın %20 yükselirse', shocks: { 'GC=F': 20 } },
  { label: '₿ Kripto çöküşü (BTC −%40)', shocks: { 'BTC-USD': -40 } },
  { label: '🔥 Kriz: BIST −%20, Dolar +%15', shocks: { 'XU100.IS': -20, 'USDTRY=X': 15 } },
]

function ScenarioCard() {
  const [factors, setFactors] = useState<Record<string, string>>({})
  const [shocks, setShocks] = useState<Record<string, string>>({ 'USDTRY=X': '10' })
  const [res, setRes] = useState<Scn | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Record<string, string>>('/scenario/factors').then(setFactors).catch(() => {}) }, [])
  const run = (sh = shocks) => {
    setBusy(true); setErr(null)
    api<Scn>('/scenario', { body: { shocks: Object.fromEntries(Object.entries(sh).filter(([, v]) => +v).map(([k, v]) => [k, +v])) } })
      .then(setRes).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  return (
    <div className="card">
      <h3>Senaryo Analizi — "Şu olursa portföyüm ne olur?"</h3>
      <p className="muted small">Her varlığınızın son 1 yıldaki TL getirisi, seçilen piyasa değişkenlerine göre regresyonla modellenir ve senaryo uygulanır.</p>
      <div className="chips">{SCN_PRESETS.map(p => <button key={p.label} className="chip" onClick={() => { const s = Object.fromEntries(Object.entries(p.shocks).map(([k, v]) => [k, String(v)])); setShocks(s); run(s) }}>{p.label}</button>)}</div>
      <div className="form-grid mt">
        {Object.entries(factors).map(([k, name]) => (
          <label key={k}>{name} değişimi (%)<input type="number" step="any" value={shocks[k] ?? ''} onChange={e => setShocks({ ...shocks, [k]: e.target.value })} placeholder="0" /></label>
        ))}
      </div>
      <button className="btn primary mt" onClick={() => run()} disabled={busy}>{busy ? 'Hesaplanıyor…' : '▶ Senaryoyu uygula'}</button>
      {err && <div className="error-box mt">{err}</div>}
      {res && (
        <div className="mt">
          <div className="grid4">
            <div className="card kpi"><div className="muted small">Senaryo öncesi</div><div className="kpi-value sm">{fmtMoney(res.before, 'TRY')}</div></div>
            <div className="card kpi"><div className="muted small">Senaryo sonrası (tahmini)</div><div className="kpi-value sm">{fmtMoney(res.after, 'TRY')}</div></div>
            <div className="card kpi"><div className="muted small">Etki</div><div className={`kpi-value sm ${res.impact_try >= 0 ? 'up' : 'down'}`}>{fmtMoney(res.impact_try, 'TRY')} ({fmtPct(res.impact_pct)})</div></div>
          </div>
          <table className="table mt">
            <thead><tr><th>Varlık</th><th className="r">Değer</th><th className="r">Tahmini etki</th><th>Duyarlılık (beta)</th><th className="r">Model uyumu</th></tr></thead>
            <tbody>{res.items.map(i => (
              <tr key={i.symbol}><td className="sym">{i.symbol.replace('.IS', '')}</td><td className="r mono">{fmtMoney(i.value, 'TRY')}</td>
                <td className={`r mono ${i.impact_try >= 0 ? 'up' : 'down'}`}>{fmtMoney(i.impact_try, 'TRY')} ({fmtPct(i.impact_pct)})</td>
                <td className="small muted">{Object.entries(i.betas).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                <td className="r mono small">%{(i.r2 * 100).toFixed(0)}</td></tr>
            ))}</tbody>
          </table>
          <p className="muted small">Beta: değişken %1 hareket ettiğinde varlığın ortalama % tepkisi. "Model uyumu" (R²) düşükse tahmin daha belirsizdir.</p>
        </div>
      )}
    </div>
  )
}
