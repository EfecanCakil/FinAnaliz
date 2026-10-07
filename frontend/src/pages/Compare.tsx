import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, fmtPct, fmtPrice, tone, type Point } from '../api'
import Chart, { PALETTE, type SeriesSpec } from '../components/Chart'
import { Disclaimer, ErrorBox, Loading, SymbolPicker } from '../components/common'
import { fmtBig } from './Fundamentals'

type CmpRes = {
  series: { symbol: string; name: string; points: Point[]; return_pct: number; volatility_pct: number }[]
  correlation: { symbols: string[]; matrix: number[][] }
}
type Profile = {
  symbol: string; name?: string; currency?: string; error?: string
  technical?: { overall: string; stats: Record<string, number | null>; signals: Record<string, string> }
  fundamentals?: Record<string, any>
  dividend?: { pays: boolean; yield_pct?: number | null; streak_years?: number }
  news?: { label: string; avg_score: number; count: number } | null
}

// [etiket, değer alıcı, biçim, daha yüksek daha iyi mi (null: kıyaslanmaz)]
type Metric = [string, (p: Profile) => number | null | undefined, (v: number | null | undefined, p: Profile) => string, boolean | null]
const GROUPS: { title: string; rows: Metric[] }[] = [
  { title: 'Fiyat ve risk', rows: [
    ['Son fiyat', p => p.technical?.stats.last, (v, p) => v == null ? '—' : `${fmtPrice(v)} ${p.currency ?? ''}`, null],
    ['1 aylık getiri', p => p.technical?.stats.change_1m, v => fmtPct(v), true],
    ['1 yıllık getiri', p => p.technical?.stats.change_period, v => fmtPct(v), true],
    ['Oynaklık (son 30 gün)', p => p.technical?.stats.volatility, v => fmtPct(v, false), false],
  ] },
  { title: 'Değerleme ve kârlılık', rows: [
    ['Piyasa değeri', p => p.fundamentals?.market_cap, (v, p) => fmtBig(v, p.currency ?? ''), null],
    ['F/K', p => p.fundamentals?.pe, v => v == null ? '—' : `${v.toFixed(2)}×`, false],
    ['PD/DD', p => p.fundamentals?.pb, v => v == null ? '—' : `${v.toFixed(2)}×`, false],
    ['Net kâr marjı', p => p.fundamentals?.profit_margin, v => fmtPct(v, false), true],
    ['Özkaynak kârlılığı', p => p.fundamentals?.roe, v => fmtPct(v, false), true],
    ['Satış büyümesi', p => p.fundamentals?.revenue_growth, v => fmtPct(v), true],
    ['Borç / özkaynak', p => p.fundamentals?.debt_to_equity, v => v == null ? '—' : v.toFixed(1), false],
  ] },
  { title: 'Temettü ve haberler', rows: [
    ['Temettü verimi', p => p.dividend?.yield_pct ?? null, v => fmtPct(v, false), true],
    ['Kesintisiz temettü yılı', p => p.dividend?.streak_years ?? null, v => v == null ? '—' : String(v), true],
    ['Haber duygu skoru', p => p.news?.avg_score, (v, p) => v == null ? '—' : `${p.news?.label} (${v.toFixed(2)})`, true],
  ] },
]

const DEFAULT = ['XU100.IS', '^GSPC', 'USDTRY=X', 'BTC-USD', 'GC=F']
const LIST_KEY = 'finanaliz_compare', PERIOD_KEY = 'finanaliz_compare_period', HISTORY_KEY = 'finanaliz_compare_history'
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* yoksay */ } }
const short = (s: string) => s.replace('.IS', '')

// Sayfadan çıkıp dönüldüğünde son sonuçlar yeniden yüklenmeden anında gösterilir
const memo: { key?: string; res?: CmpRes; details?: { key: string; list: Profile[] } } = {}

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [symbols, setSymbolsState] = useState<string[]>(() => {
    // Eski "Kafa Kafaya" bağlantıları (?a=..&b=..) karşılaştırmaya yönlendirilir
    const a = params.get('a'), b = params.get('b')
    if (a || b) return [a, b].filter(Boolean) as string[]
    const v = read<unknown>(LIST_KEY, DEFAULT)
    return Array.isArray(v) ? v : DEFAULT
  })
  const [period, setPeriodState] = useState(() => { try { return localStorage.getItem(PERIOD_KEY) || '1y' } catch { return '1y' } })
  const [history, setHistory] = useState<string[][]>(() => read(HISTORY_KEY, []))
  const key = `${symbols.join(',')}|${period}`
  const [res, setRes] = useState<CmpRes | null>(memo.key === key ? memo.res! : null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<Profile[] | null>(memo.details?.key === symbols.join(',') ? memo.details.list : null)
  const [detailsBusy, setDetailsBusy] = useState(false)

  const setSymbols = (s: string[]) => {
    setSymbolsState(s); write(LIST_KEY, s)
    if (s.length >= 2) {
      const h = [s, ...history.filter(x => x.join(',') !== s.join(','))].slice(0, 8)
      setHistory(h); write(HISTORY_KEY, h)
    }
  }
  const setPeriod = (p: string) => { setPeriodState(p); try { localStorage.setItem(PERIOD_KEY, p) } catch { /* yoksay */ } }
  useEffect(() => { if (params.get('a') || params.get('b')) { setSymbols(symbols); setParams({}, { replace: true }) } }, [])

  useEffect(() => {
    if (!symbols.length) { setRes(null); return }
    if (memo.key === key && memo.res) { setRes(memo.res); return }
    setError(null)
    api<CmpRes>(`/compare?symbols=${encodeURIComponent(symbols.join(','))}&period=${period}`)
      .then(r => { memo.key = key; memo.res = r; setRes(r) }).catch(e => setError(e.message))
  }, [key])

  useEffect(() => {
    const k = symbols.join(',')
    if (memo.details?.key === k) { setDetails(memo.details.list); return }
    setDetails(null)
    if (!symbols.length) return
    setDetailsBusy(true)
    api<Profile[]>(`/compare/details?symbols=${encodeURIComponent(k)}`)
      .then(list => { memo.details = { key: k, list }; setDetails(list) }).catch(() => setDetails([])).finally(() => setDetailsBusy(false))
  }, [symbols.join(',')])

  const series = useMemo<SeriesSpec[]>(() => res ? res.series.map(s => (
    { kind: 'line', data: s.points, color: PALETTE[symbols.indexOf(s.symbol) % PALETTE.length] ?? PALETTE[0], title: short(s.symbol), width: 2 })) : [], [res])

  // Her satırda en iyi değeri bulan varlık ✓ alır; toplam kazanılan kriter sayılır
  const table = useMemo(() => {
    if (!details) return null
    const ok = details.filter(d => !d.error)
    const wins: Record<string, number> = Object.fromEntries(ok.map(d => [d.symbol, 0]))
    const groups = GROUPS.map(g => ({
      title: g.title,
      rows: g.rows.map(m => {
        const vals = ok.map(d => m[1](d))
        let best: number | null = null
        if (m[3] !== null) {
          const nums = vals.filter((v): v is number => v != null)
          if (nums.length >= 2) {
            const target = m[3] ? Math.max(...nums) : Math.min(...nums)
            if (nums.filter(v => v === target).length === 1) best = vals.indexOf(target)
          }
        }
        if (best !== null) wins[ok[best].symbol]++
        return { m, vals, best }
      }).filter(r => r.vals.some(v => v != null)),
    })).filter(g => g.rows.length)
    return { ok, groups, wins }
  }, [details])

  const corrColor = (v: number) => v >= 0 ? `rgba(76,141,255,${Math.abs(v) * 0.7})` : `rgba(239,83,80,${Math.abs(v) * 0.7})`
  const colorOf = (s: string) => PALETTE[symbols.indexOf(s) % PALETTE.length]
  const leader = table && table.ok.length >= 2 ? [...table.ok].sort((a, b) => table.wins[b.symbol] - table.wins[a.symbol])[0] : null

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Varlık Karşılaştırma</h1><p className="muted">Getiri, risk, teknik görünüm, temel oranlar, temettü ve haber duygusunu yan yana karşılaştırın</p></div>
      </header>
      <div className="card">
        <div className="row gap wrap">
          <SymbolPicker onChange={s => !symbols.includes(s) && symbols.length < 6 && setSymbols([...symbols, s])} placeholder="Karşılaştırmaya varlık ekle (en fazla 6)" />
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="1mo">1 ay</option><option value="3mo">3 ay</option><option value="6mo">6 ay</option><option value="1y">1 yıl</option><option value="2y">2 yıl</option><option value="5y">5 yıl</option>
          </select>
          {symbols.length > 0 && <button className="btn ghost small" onClick={() => setSymbols([])}>Listeyi temizle</button>}
        </div>
        <div className="chips mt">
          {symbols.map(s => (
            <span key={s} className="chip on" style={{ '--c': colorOf(s) } as CSSProperties}>
              {short(s)}<button className="x" onClick={() => setSymbols(symbols.filter(x => x !== s))}>×</button>
            </span>
          ))}
          {symbols.length === 0 && <span className="muted small">Yukarıdan en az iki varlık ekleyin.</span>}
        </div>
        {history.length > 0 && (
          <div className="row gap wrap mt small">
            <span className="muted">Son karşılaştırmalar:</span>
            {history.map(h => (
              <button key={h.join(',')} className={`chip ${h.join(',') === symbols.join(',') ? 'on' : ''}`} onClick={() => setSymbols(h)}>{h.map(short).join(' · ')}</button>
            ))}
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      {!res && !error && symbols.length > 0 && <Loading />}
      {res && (
        <>
          <div className="card">
            <h3>Başlangıca Göre Getiri (%)</h3>
            <Chart series={series} height={380} percent />
          </div>

          <div className="card">
            <div className="row between wrap gap">
              <h3>Detaylı Karşılaştırma</h3>
              {leader && <span className="pill up">🏆 En çok kriterde önde: {short(leader.symbol)} ({table!.wins[leader.symbol]})</span>}
            </div>
            {!table ? <Loading text={detailsBusy ? 'Temel oranlar, temettü ve haberler çekiliyor…' : 'Yükleniyor…'} /> : (
              <div className="table-wrap">
                <table className="table cmp-table">
                  <thead><tr>
                    <th />
                    {table.ok.map(d => (
                      <th key={d.symbol} className="r clickable" style={{ borderTop: `3px solid ${colorOf(d.symbol)}` }} onClick={() => nav(`/analiz?s=${encodeURIComponent(d.symbol)}`)} title="Teknik analizde aç">
                        <div className="sym">{short(d.symbol)}</div><div className="muted small ellipsis">{d.name}</div>
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    <tr><td className="muted">Teknik görünüm</td>{table.ok.map(d => {
                      const o = d.technical?.overall ?? '—'
                      return <td key={d.symbol} className="r"><span className={`pill ${o.includes('Al') ? 'up' : o.includes('Sat') ? 'down' : ''}`}>{o}</span></td>
                    })}</tr>
                    {table.groups.map(g => [
                      <tr key={g.title} className="group-row"><td colSpan={table.ok.length + 1}>{g.title}</td></tr>,
                      ...g.rows.map(({ m, vals, best }) => (
                        <tr key={m[0]}>
                          <td className="muted">{m[0]}</td>
                          {table.ok.map((d, i) => (
                            <td key={d.symbol} className={`r mono ${best === i ? 'win' : ''}`}>{m[2](vals[i], d)}{best === i && ' ✓'}</td>
                          ))}
                        </tr>
                      )),
                    ])}
                    <tr className="total-row"><td>🏆 Kazanılan kriter</td>{table.ok.map(d => <td key={d.symbol} className="r strong">{table.wins[d.symbol]}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small mt">✓ o satırda en iyi değere sahip varlığı gösterir (getiri ve kârlılıkta yüksek, risk, F/K ve borçta düşük olan daha iyi sayılır). Temel oranlar yalnızca hisselerde vardır.</p>
          </div>

          <div className="grid2">
            <div className="card">
              <h3>Performans Özeti</h3>
              <table className="table">
                <thead><tr><th>Varlık</th><th className="r">Dönem getirisi</th><th className="r">Yıllık oynaklık</th></tr></thead>
                <tbody>
                  {[...res.series].sort((a, b) => b.return_pct - a.return_pct).map(s => (
                    <tr key={s.symbol}><td><span className="sym">{short(s.symbol)}</span> <span className="muted small">{s.name}</span></td>
                      <td className={`r mono ${tone(s.return_pct)}`}>{fmtPct(s.return_pct)}</td><td className="r mono">{fmtPct(s.volatility_pct, false)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Günlük Getiri Korelasyonu</h3>
              <table className="table corr">
                <thead><tr><th />{res.correlation.symbols.map(s => <th key={s} className="c">{short(s)}</th>)}</tr></thead>
                <tbody>
                  {res.correlation.matrix.map((row, i) => (
                    <tr key={i}><th>{short(res.correlation.symbols[i])}</th>
                      {row.map((v, j) => <td key={j} className="c mono" style={{ background: corrColor(v) }}>{v.toFixed(2)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">+1: aynı yönde hareket, 0: ilişkisiz, −1: ters yönde hareket.</p>
            </div>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  )
}
