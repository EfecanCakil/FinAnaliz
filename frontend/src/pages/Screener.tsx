import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtPct, fmtPrice, MARKET_LABELS, tone } from '../api'
import { Disclaimer, ErrorBox, Loading } from '../components/common'
import { ExportButton } from '../components/extras'
import { TradeModal } from '../components/TradePanel'
import { useAutoRefresh } from '../refresh'

type Row = {
  symbol: string; name: string; market: string; sector: string | null; currency: string; featured: boolean
  price: number; change_pct: number | null; change_1w: number | null; change_1m: number | null; change_3m: number | null
  rsi: number; rsi_prev: number | null
  dist_sma20: number | null; dist_sma50: number | null; dist_sma200: number | null
  golden_cross: boolean; death_cross: boolean; macd_cross_up: boolean; macd_cross_down: boolean; macd_above: boolean
  sma200_cross_up: boolean; sma200_cross_down: boolean; macd_hist: number | null
  bb_pct: number | null; bb_width: number | null; vol_ratio: number | null; has_volume: boolean
  dist_high_52w: number; dist_low_52w: number; volatility: number; trend: string
  score: number; signal: string; last_date: string | null
}
type ScanRes = { rows: Row[]; scanned: number; universe: number; computed_at: number; data_at: number | null }
type Cond = { field: keyof Row; op: '<' | '>'; value: string }
type Match = 'all' | 'any'

const num = (v: number | null | undefined) => v ?? NaN
const pct = (v: number | null | undefined) => fmtPct(v)

// Basit mod: sade dille sorulmuş "sorular". Her biri ne aradığını, neden önemli olduğunu ve sonucun nedenini anlatır.
type Question = { id: string; icon: string; title: string; short: string; explain: string; test: (r: Row) => boolean; reason: (r: Row) => string; sort: [keyof Row, 1 | -1]; volume?: boolean }
const QUESTIONS: Question[] = [
  { id: 'strong', icon: '⭐', title: 'Teknik görünümü en güçlüler', short: 'Göstergelerin çoğu "al" diyor',
    explain: 'RSI, MACD, hareketli ortalamalar (20/50/200 gün) ve Bollinger bantlarının hepsine bakılır. Göstergelerin büyük çoğunluğu olumlu olan varlıklar "Güçlü Al" sayılır. Trendi güçlü, momentumu yerinde olanları bulmak için iyi bir başlangıç noktasıdır.',
    test: r => r.signal === 'Güçlü Al', reason: r => `Teknik skor ${r.score}/100`, sort: ['score', -1] },
  { id: 'oversold', icon: '📉', title: 'Çok düşmüş, tepki verebilecekler', short: 'RSI 30\'un altında (aşırı satım)',
    explain: 'RSI, son 14 günde fiyatın ne kadar sert düştüğünü/yükseldiğini 0–100 arası ölçer. 30\'un altı "aşırı satım" demektir: satış baskısı abartılmış olabilir ve kısa vadeli bir tepki yükselişi gelebilir. Ancak düşüş trendi devam edebilir; tek başına alım sinyali değildir.',
    test: r => r.rsi < 30, reason: r => `RSI ${r.rsi.toFixed(0)} · son 1 ay ${pct(r.change_1m)}`, sort: ['rsi', 1] },
  { id: 'rebound', icon: '🔄', title: 'Dipten dönüş sinyali verenler', short: 'MACD yukarı kesti veya RSI 30\'u geri aldı',
    explain: 'Düşüşün yavaşlayıp yukarı dönmeye başladığına dair erken işaretler: MACD çizgisinin son 3 günde sinyal çizgisini yukarı kesmesi ya da RSI\'ın 30\'un altından yukarı çıkması. Erken sinyaller sık yanılabilir; teyit için birkaç gün izlemek iyi olur.',
    test: r => r.macd_cross_up || (r.rsi_prev !== null && r.rsi_prev < 30 && r.rsi >= 30),
    reason: r => r.macd_cross_up ? 'MACD son 3 günde yukarı kesti' : `RSI ${r.rsi_prev?.toFixed(0)} → ${r.rsi.toFixed(0)}`, sort: ['change_pct', -1] },
  { id: 'uptrend', icon: '🚀', title: 'Yükseliş trendindekiler', short: 'Fiyat > 50 gün ort. > 200 gün ort.',
    explain: 'Fiyat 50 günlük ortalamanın, 50 günlük ortalama da 200 günlük ortalamanın üzerindeyse varlık hem kısa hem uzun vadede yükseliş trendindedir. "Trend dostunuzdur" yaklaşımıyla yatırım yapanların en çok baktığı filtredir.',
    test: r => r.trend === 'Yükseliş', reason: r => `200 gün ort. ${pct(r.dist_sma200)} üzerinde`, sort: ['change_3m', -1] },
  { id: 'newup', icon: '✨', title: 'Yeni yükseliş sinyali', short: 'Altın kesişim veya 200 gün ortalaması kırıldı',
    explain: '"Altın kesişim": 50 günlük ortalamanın 200 günlük ortalamayı yukarı kesmesi; uzun vadeli trendin yukarı döndüğünün klasik işaretidir. Ayrıca fiyatın son günlerde 200 günlük ortalamanın üzerine çıktığı varlıklar da listelenir.',
    test: r => r.golden_cross || r.sma200_cross_up, reason: r => r.golden_cross ? 'Altın kesişim (son 10 gün)' : 'Fiyat 200 gün ortalamasının üzerine çıktı', sort: ['change_1w', -1] },
  { id: 'newdown', icon: '⚠️', title: 'Düşüşe geçme sinyali', short: 'Ölüm kesişimi veya 200 gün ortalaması kaybedildi',
    explain: '"Ölüm kesişimi": 50 günlük ortalamanın 200 günlük ortalamayı aşağı kesmesi; uzun vadeli trendin bozulduğuna işaret eder. Elinizde olan varlıklar bu listedeyse dikkatle izlemek isteyebilirsiniz.',
    test: r => r.death_cross || r.sma200_cross_down, reason: r => r.death_cross ? 'Ölüm kesişimi (son 10 gün)' : 'Fiyat 200 gün ortalamasının altına indi', sort: ['change_1w', 1] },
  { id: 'high', icon: '🏔', title: 'Yıllık zirvesine yakın', short: '52 haftanın en yüksek seviyesine %3\'ten yakın',
    explain: 'Son bir yılın en yüksek fiyatına çok yakın olan varlıklar. Güçlü momentumu gösterir; zirve kırılırsa yükseliş hızlanabilir, kırılamazsa geri çekilme görülebilir.',
    test: r => r.dist_high_52w > -3, reason: r => `Zirveye ${pct(r.dist_high_52w)}`, sort: ['dist_high_52w', -1] },
  { id: 'low', icon: '🕳', title: 'Yıllık dibine yakın', short: '52 haftanın en düşük seviyesine %5\'ten yakın',
    explain: 'Son bir yılın en düşük fiyatına yakın varlıklar. "Ucuzlamış" görünebilirler ama genellikle zayıf trenddedirler; dip seviyesi kırılırsa düşüş sürebilir.',
    test: r => r.dist_low_52w < 5, reason: r => `Dibin ${pct(r.dist_low_52w)} üzerinde`, sort: ['dist_low_52w', 1] },
  { id: 'overbought', icon: '🔥', title: 'Çok yükselmiş, yorulmuş olabilecekler', short: 'RSI 70\'in üzerinde (aşırı alım)',
    explain: 'RSI 70\'in üzerindeyse fiyat kısa sürede çok hızlı yükselmiştir. Kâr satışları gelebilir; yeni alım için beklemek isteyebilirsiniz. Güçlü trendlerde RSI uzun süre 70 üzerinde kalabilir.',
    test: r => r.rsi > 70, reason: r => `RSI ${r.rsi.toFixed(0)} · son 1 ay ${pct(r.change_1m)}`, sort: ['rsi', -1] },
  { id: 'volume', icon: '📊', title: 'Hacmi patlayanlar', short: 'Bugünkü işlem hacmi ortalamanın 2 katından fazla', volume: true,
    explain: 'Hacim, o gün ne kadar alım-satım yapıldığıdır. Ortalamanın çok üzerindeki hacim, varlıkla ilgili önemli bir gelişme (haber, KAP açıklaması vb.) olduğuna ve hareketin güçlü olduğuna işaret eder. Hacim verisi yalnızca öne çıkan varlıklar için mevcuttur.',
    test: r => num(r.vol_ratio) > 2, reason: r => `Hacim ortalamanın ${r.vol_ratio?.toFixed(1)} katı`, sort: ['vol_ratio', -1] },
]

// Gelişmiş mod: birden fazla teknik koşulu birleştirme
const PRESETS: { id: string; label: string; test: (r: Row) => boolean }[] = [
  { id: 'strong_buy', label: 'Sinyal: Güçlü Al', test: r => r.signal === 'Güçlü Al' },
  { id: 'buy', label: 'Sinyal: Al veya Güçlü Al', test: r => r.signal.includes('Al') },
  { id: 'strong_sell', label: 'Sinyal: Güçlü Sat', test: r => r.signal === 'Güçlü Sat' },
  { id: 'oversold', label: 'RSI < 30', test: r => r.rsi < 30 },
  { id: 'overbought', label: 'RSI > 70', test: r => r.rsi > 70 },
  { id: 'golden', label: 'Altın kesişim', test: r => r.golden_cross },
  { id: 'death', label: 'Ölüm kesişimi', test: r => r.death_cross },
  { id: 'macd_up', label: 'MACD yukarı kesti', test: r => r.macd_cross_up },
  { id: 'macd_down', label: 'MACD aşağı kesti', test: r => r.macd_cross_down },
  { id: 'above200', label: 'Fiyat > SMA200', test: r => num(r.dist_sma200) > 0 },
  { id: 'below200', label: 'Fiyat < SMA200', test: r => num(r.dist_sma200) < 0 },
  { id: 'uptrend', label: 'Yükseliş trendi', test: r => r.trend === 'Yükseliş' },
  { id: 'downtrend', label: 'Düşüş trendi', test: r => r.trend === 'Düşüş' },
  { id: 'week_up', label: 'Haftalık > +%10', test: r => num(r.change_1w) > 10 },
  { id: 'week_down', label: 'Haftalık < −%10', test: r => num(r.change_1w) < -10 },
  { id: 'squeeze', label: 'Bollinger sıkışması', test: r => num(r.bb_width) < 6 },
  { id: 'bb_low', label: 'Bollinger alt bandı altında', test: r => num(r.bb_pct) < 0 },
  { id: 'bb_high', label: 'Bollinger üst bandı üstünde', test: r => num(r.bb_pct) > 100 },
]
const FIELDS: { key: keyof Row; label: string }[] = [
  { key: 'score', label: 'Teknik skor (−100…100)' }, { key: 'rsi', label: 'RSI (14)' }, { key: 'change_pct', label: 'Günlük değişim %' },
  { key: 'change_1w', label: 'Haftalık değişim %' }, { key: 'change_1m', label: 'Aylık değişim %' }, { key: 'change_3m', label: '3 aylık değişim %' },
  { key: 'dist_sma50', label: 'SMA50\'ye uzaklık %' }, { key: 'dist_sma200', label: 'SMA200\'e uzaklık %' },
  { key: 'dist_high_52w', label: '52H zirveye uzaklık %' }, { key: 'dist_low_52w', label: '52H dibe uzaklık %' },
  { key: 'volatility', label: 'Yıllık oynaklık %' }, { key: 'vol_ratio', label: 'Hacim oranı (×)' }, { key: 'price', label: 'Fiyat' },
]
const SIGNAL_CLS: Record<string, string> = { 'Güçlü Al': 'up', 'Al': 'up', 'Sat': 'down', 'Güçlü Sat': 'down', 'Nötr': '' }
const MARKET_OPTS: [string, string][] = [['bist', 'Borsa İstanbul'], ['us', 'ABD (S&P 500)'], ['crypto', 'Kripto'], ['fx', 'Döviz & Emtia']]
const PAGE = 50
const PREF_KEY = 'finanaliz_screener_v2'

function loadPref() {
  const d = { market: 'bist', question: 'strong' as string | null, advanced: false, presets: [] as string[], conds: [] as Cond[], sector: '', match: 'all' as Match }
  try { const v = localStorage.getItem(PREF_KEY); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d }
}
const condValid = (c: Cond) => c.value.trim() !== '' && Number.isFinite(Number(c.value.replace(',', '.')))
const condTest = (r: Row, c: Cond) => {
  const v = r[c.field] as number | null
  const x = Number(c.value.replace(',', '.'))
  return v !== null && v !== undefined && (c.op === '<' ? v < x : v > x)
}
const timeStr = (t: number | null | undefined) => t ? new Date(t * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—'
const tagsOf = (r: Row) => [
  r.golden_cross && 'Altın kesişim', r.death_cross && 'Ölüm kesişimi', r.macd_cross_up && 'MACD ↑', r.macd_cross_down && 'MACD ↓',
  r.rsi < 30 && `RSI ${r.rsi.toFixed(0)}`, r.rsi > 70 && `RSI ${r.rsi.toFixed(0)}`, num(r.vol_ratio) > 2 && 'Yüksek hacim',
].filter(Boolean).join(' · ')

export default function Screener() {
  const init = loadPref()
  const [market, setMarket] = useState<string>(init.market)
  const [question, setQuestion] = useState<string | null>(init.question)
  const [advanced, setAdvanced] = useState<boolean>(init.advanced)
  const [presets, setPresets] = useState<string[]>(init.presets)
  const [conds, setConds] = useState<Cond[]>(init.conds)
  const [sector, setSector] = useState<string>(init.sector)
  const [match, setMatch] = useState<Match>(init.match)
  const [data, setData] = useState<ScanRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 } | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [watch, setWatch] = useState<Set<string>>(new Set())
  const [trade, setTrade] = useState<string | null>(null)
  const reqId = useRef(0)
  const nav = useNavigate()

  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ market, question, advanced, presets, conds, sector, match })) } catch { /* yoksay */ }
  }, [market, question, advanced, presets, conds, sector, match])

  const load = (force = false) => {
    const id = ++reqId.current
    setBusy(true); setError(null)
    api<ScanRes>(`/screener?markets=${market}&scope=all${force ? '&force=true' : ''}`)
      .then(d => { if (id === reqId.current) setData(d) })
      .catch(e => { if (id === reqId.current) setError(e.message) })
      .finally(() => { if (id === reqId.current) setBusy(false) })
  }
  useEffect(() => { setData(null); setSector(''); load() }, [market])
  useAutoRefresh(() => load())
  useEffect(() => { api<{ symbol: string }[]>('/watchlist').then(l => setWatch(new Set(l.map(x => x.symbol)))).catch(() => {}) }, [])
  useEffect(() => { setLimit(PAGE); setSort(null) }, [question])
  useEffect(() => { setLimit(PAGE) }, [presets, conds, sector, q, match, market, advanced])

  const toggleWatch = async (s: string) => {
    try {
      if (watch.has(s)) await api(`/watchlist/${encodeURIComponent(s)}`, { method: 'DELETE' })
      else await api('/watchlist', { body: { symbol: s } })
      setWatch(w => { const n = new Set(w); if (n.has(s)) n.delete(s); else n.add(s); return n })
    } catch (e) { setError((e as Error).message) }
  }

  const rows = data?.rows ?? null
  const anyVolume = !!rows?.some(r => r.has_volume)
  const quest = QUESTIONS.find(x => x.id === question) ?? null
  const sectors = useMemo(() => [...new Set((rows ?? []).map(r => r.sector || 'Diğer'))].sort((a, b) => a.localeCompare(b, 'tr')), [rows])
  const validConds = conds.filter(condValid)

  const base = useMemo(() => {
    if (!rows) return []
    const term = q.trim().toLocaleLowerCase('tr')
    return rows.filter(r => (!sector || (r.sector || 'Diğer') === sector)
      && (!term || r.symbol.toLocaleLowerCase('tr').includes(term) || r.name.toLocaleLowerCase('tr').includes(term)))
  }, [rows, sector, q])

  const counts = useMemo(() => Object.fromEntries(QUESTIONS.map(x => [x.id, base.filter(x.test).length])), [base])

  const filtered = useMemo(() => {
    const extra = advanced ? [...PRESETS.filter(p => presets.includes(p.id)).map(p => p.test), ...validConds.map(c => (r: Row) => condTest(r, c))] : []
    const list = base.filter(r => (!quest || quest.test(r))
      && (extra.length === 0 || (match === 'all' ? extra.every(t => t(r)) : extra.some(t => t(r)))))
    const [key, dir] = sort ? [sort.key, sort.dir] : quest ? quest.sort : ['score' as keyof Row, -1 as const]
    return list.sort((a, b) => {
      const av = a[key], bv = b[key]
      if (typeof av === 'string' || typeof bv === 'string') return String(av ?? '').localeCompare(String(bv ?? ''), 'tr') * dir
      const an = av == null ? null : Number(av), bn = bv == null ? null : Number(bv)
      if (an === null && bn === null) return 0
      if (an === null) return 1
      if (bn === null) return -1
      return (an - bn) * dir
    })
  }, [base, quest, advanced, presets, conds, match, sort])

  const toggle = <T,>(list: T[], v: T) => list.includes(v) ? list.filter(x => x !== v) : [...list, v]
  const th = (key: keyof Row, label: string, cls = 'r') => {
    const on = sort?.key === key
    return <th className={`${cls} sortable`} onClick={() => setSort(s => ({ key, dir: s?.key === key ? (-s.dir as 1 | -1) : -1 }))}>{label}{on ? (sort!.dir === -1 ? ' ▾' : ' ▴') : ''}</th>
  }
  const title = quest ? quest.title : 'Teknik tarama'
  const advCount = presets.length + validConds.length

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Teknik Tarama</h1>
          <p className="muted">Yüzlerce hisse arasından aradığınız duruma uyanları saniyeler içinde bulur. Bir piyasa ve bir soru seçin.</p>
        </div>
        <div className="row gap">
          <span className="muted small">{busy ? 'Hesaplanıyor…' : data ? `Güncellendi ${timeStr(data.computed_at)}` : ''}</span>
          <button className="btn ghost" onClick={() => load(true)} disabled={busy}>↻ Yenile</button>
          <ExportButton label="Excel" endpoint="/export/screener" body={{ title, rows: filtered }} />
        </div>
      </header>

      <div className="card">
        <div className="scr-step"><span className="scr-num">1</span><b>Piyasa</b></div>
        <div className="seg scr-markets">
          {MARKET_OPTS.map(([k, v]) => <button key={k} className={market === k ? 'active' : ''} onClick={() => setMarket(k)}>{v}</button>)}
        </div>
        <div className="scr-step mt"><span className="scr-num">2</span><b>Ne arıyorsunuz?</b></div>
        <div className="q-grid">
          {QUESTIONS.map(x => {
            const off = x.volume && rows !== null && !anyVolume
            return (
              <button key={x.id} className={`q-card ${question === x.id ? 'on' : ''}`} disabled={off}
                title={off ? 'Bu piyasada hacim verisi yok' : x.short} onClick={() => setQuestion(question === x.id ? null : x.id)}>
                <span className="q-icon">{x.icon}</span>
                <span className="q-text"><b>{x.title}</b><small className="muted">{x.short}</small></span>
                <span className="q-count">{rows ? (off ? '—' : counts[x.id]) : '…'}</span>
              </button>
            )
          })}
        </div>
        {quest && <div className="info-box mt"><b>{quest.icon} Bu ne demek?</b> {quest.explain}</div>}

        <button className="btn ghost small mt" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '▾' : '▸'} Gelişmiş filtreler{advCount ? ` (${advCount} etkin)` : ''}
        </button>
        {advanced && (
          <div className="adv-box">
            <p className="muted small">Yukarıdaki soruya ek olarak uygulanır. Birden fazla koşul seçebilirsiniz.</p>
            <div className="row gap wrap">
              <span className="muted small">Seçilen koşullar:</span>
              <div className="seg">
                <button className={match === 'all' ? 'active' : ''} onClick={() => setMatch('all')}>Hepsi sağlansın</button>
                <button className={match === 'any' ? 'active' : ''} onClick={() => setMatch('any')}>Biri yeterli</button>
              </div>
            </div>
            <div className="chips mt">
              {PRESETS.map(p => <button key={p.id} className={`chip ${presets.includes(p.id) ? 'on' : ''}`} onClick={() => setPresets(toggle(presets, p.id))}>{p.label}</button>)}
            </div>
            <h4 className="mt">Özel koşul</h4>
            {conds.map((c, i) => (
              <div key={i} className="cond-row">
                <select value={c.field} onChange={e => setConds(conds.map((x, j) => j === i ? { ...x, field: e.target.value as keyof Row } : x))}>
                  {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select value={c.op} onChange={e => setConds(conds.map((x, j) => j === i ? { ...x, op: e.target.value as '<' | '>' } : x))}>
                  <option value=">">büyüktür</option><option value="<">küçüktür</option>
                </select>
                <input type="text" inputMode="decimal" value={c.value} placeholder="değer" className={c.value.trim() && !condValid(c) ? 'invalid' : ''}
                  onChange={e => setConds(conds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                <button className="btn ghost small" onClick={() => setConds(conds.filter((_, j) => j !== i))}>Kaldır</button>
              </div>
            ))}
            <div className="row gap">
              <button className="btn ghost small" onClick={() => setConds([...conds, { field: 'rsi', op: '<', value: '40' }])}>+ Koşul ekle</button>
              {advCount > 0 && <button className="btn ghost small" onClick={() => { setPresets([]); setConds([]) }}>Temizle</button>}
            </div>
          </div>
        )}
      </div>

      <ErrorBox error={error} />
      {!rows && !error && <Loading text={market === 'bist' || market === 'us' ? 'Tüm hisseler taranıyor… (ilk seferde ~20 sn sürebilir)' : 'Taranıyor…'} />}
      {rows && (
        <div className={`card ${busy ? 'is-busy' : ''}`}>
          <div className="row between wrap gap">
            <h3>{quest ? `${quest.icon} ${quest.title}` : 'Tüm varlıklar'}: {filtered.length} sonuç <span className="muted small">/ {data!.scanned} {MARKET_LABELS[market] ?? ''} varlığı tarandı</span></h3>
            <div className="row gap wrap">
              <input className="screener-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Sonuçlarda ara…" />
              {sectors.length > 1 && (
                <select value={sector} onChange={e => setSector(e.target.value)}>
                  <option value="">Tüm sektörler</option>
                  {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th />
                {th('symbol', 'Varlık', '')}{th('price', 'Fiyat')}{th('change_pct', 'Bugün')}{th('change_1m', '1 Ay')}
                <th>{quest ? 'Neden listede?' : 'Öne çıkanlar'}</th>
                {th('score', 'Teknik görünüm', 'c')}<th />
              </tr></thead>
              <tbody>
                {filtered.slice(0, limit).map(r => (
                  <tr key={r.symbol}>
                    <td><button className={`star ${watch.has(r.symbol) ? 'on' : ''}`} title={watch.has(r.symbol) ? 'Favorilerden çıkar' : 'Favorilere ekle'} onClick={() => toggleWatch(r.symbol)}>{watch.has(r.symbol) ? '★' : '☆'}</button></td>
                    <td className="clickable" onClick={() => nav(`/analiz?s=${encodeURIComponent(r.symbol)}`)} title="Grafiği ve teknik analizi aç">
                      <div className="sym">{r.symbol.replace('.IS', '')}</div>
                      <div className="muted small ellipsis">{r.name}{r.sector && r.sector !== 'Diğer' ? ` · ${r.sector}` : ''}</div>
                    </td>
                    <td className="r mono">{fmtPrice(r.price)}</td>
                    <td className={`r mono ${tone(r.change_pct)}`}>{fmtPct(r.change_pct)}</td>
                    <td className={`r mono ${tone(r.change_1m)}`}>{fmtPct(r.change_1m)}</td>
                    <td className="small">{quest ? quest.reason(r) : tagsOf(r) || <span className="muted">—</span>}</td>
                    <td className="c"><span className={`pill ${SIGNAL_CLS[r.signal]}`} title={`Teknik skor: ${r.score}/100 (RSI, MACD, ortalamalar ve Bollinger oylarından)`}>{r.signal}</span></td>
                    <td className="r"><button className="btn ghost small" onClick={() => setTrade(r.symbol)}>Al / Sat</button></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={8} className="muted">Şu anda bu duruma uyan varlık yok. Başka bir soru veya piyasa seçin.</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <div className="row center mt gap">
              <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>Daha fazla göster ({filtered.length - limit} kaldı)</button>
            </div>
          )}
          <p className="muted small mt">💡 Bir hisseye tıklayınca grafiğini ve detaylı teknik analizini görürsünüz. "Teknik görünüm" göstergelerin genel oylamasıdır; yatırım tavsiyesi değildir.</p>
        </div>
      )}

      <NlScreener />
      {trade && <TradeModal symbol={trade} onClose={() => setTrade(null)} />}
      <Disclaimer />
    </div>
  )
}

type NlRes = { query: string; parsed: { markets: string[]; sector: string | null; dividend: boolean; conditions: { field: string; op: string; value: unknown }[]; sort: string | null }
  method: string; results: (Row & { ttm_dividend_yield?: number })[]; scanned: number }
const FIELD_TR: Record<string, string> = { rsi: 'RSI', trend: 'Trend', vol_ratio: 'Hacim oranı', dist_high_52w: '52H zirveye uzaklık %', dist_low_52w: '52H dibe uzaklık %',
  golden_cross: 'Altın kesişim', death_cross: 'Ölüm kesişimi', macd_cross_up: 'MACD al', macd_cross_down: 'MACD sat', change_1m: 'Aylık değişim', change_pct: 'Günlük değişim' }
const EXAMPLES = ["RSI 35'in altında temettü veren BIST hisseleri", 'Yükseliş trendindeki banka hisseleri', 'Aşırı satımdaki ABD hisseleri', 'Hacmi artan ve zirveye yakın hisseler', 'Son ayın en çok yükselen kripto paraları']

function NlScreener() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<NlRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()
  const run = (text = q) => { if (!text.trim()) return; setQ(text); setBusy(true); setErr(null); api<NlRes>('/screener/nl', { body: { query: text } }).then(setRes).catch(e => setErr(e.message)).finally(() => setBusy(false)) }
  return (
    <div className="card nl-card">
      <h3>🧠 Ya da kendi cümlenizle sorun</h3>
      <form className="nl-bar" onSubmit={e => { e.preventDefault(); run() }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ne aradığınızı yazın… ör. RSI 30'un altında temettü veren bankalar" />
        <button className="btn primary" disabled={busy}>{busy ? 'Aranıyor…' : 'Ara'}</button>
      </form>
      <div className="chips mt">{EXAMPLES.map(x => <button key={x} className="chip" onClick={() => run(x)}>{x}</button>)}</div>
      {err && <div className="error-box mt">{err}</div>}
      {res && (
        <div className="mt">
          <div className="row gap wrap small">
            <span className="muted">Anlaşılan ({res.method === 'llm' ? 'yapay zekâ' : 'kural tabanlı'}):</span>
            {res.parsed.markets.map(m => <span key={m} className="pill">{MARKET_LABELS[m] ?? m}</span>)}
            {res.parsed.sector && <span className="pill">{res.parsed.sector}</span>}
            {res.parsed.dividend && <span className="pill up">Temettü veren</span>}
            {res.parsed.conditions.map((c, i) => <span key={i} className="pill">{FIELD_TR[c.field] ?? c.field} {c.op === '=' ? (c.value === true ? '' : `= ${c.value}`) : `${c.op} ${c.value}`}</span>)}
            {res.parsed.sort && <span className="pill">Sıralama: {FIELD_TR[res.parsed.sort.replace('-', '')] ?? res.parsed.sort}</span>}
            <span className="muted">· {res.results.length} sonuç / {res.scanned} varlık</span>
          </div>
          {res.results.length > 0 && (
            <div className="table-wrap mt"><table className="table">
              <thead><tr><th>Varlık</th><th className="r">Fiyat</th><th className="r">Günlük</th><th className="r">Aylık</th><th className="r">RSI</th><th className="c">Trend</th><th className="c">Teknik</th>{res.parsed.dividend && <th className="r">Temettü verimi</th>}</tr></thead>
              <tbody>{res.results.map(r => (
                <tr key={r.symbol} className="clickable" onClick={() => nav(`/analiz?s=${encodeURIComponent(r.symbol)}`)}>
                  <td><span className="sym">{r.symbol.replace('.IS', '')}</span> <span className="muted small">{r.name}</span></td>
                  <td className="r mono">{fmtPrice(r.price)}</td><td className={`r mono ${tone(r.change_pct)}`}>{fmtPct(r.change_pct)}</td>
                  <td className={`r mono ${tone(r.change_1m)}`}>{fmtPct(r.change_1m)}</td><td className="r mono">{r.rsi.toFixed(1)}</td>
                  <td className="c"><span className={`pill ${r.trend === 'Yükseliş' ? 'up' : r.trend === 'Düşüş' ? 'down' : ''}`}>{r.trend}</span></td>
                  <td className="c">{r.signal && <span className={`pill ${SIGNAL_CLS[r.signal]}`}>{r.signal}</span>}</td>
                  {res.parsed.dividend && <td className="r mono">{fmtPct(r.ttm_dividend_yield, false)}</td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  )
}
