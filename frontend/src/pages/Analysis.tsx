import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtPct, fmtPrice, tone, type Candle, type Point } from '../api'
import Chart, { ChartStyleToggle, COLORS, type Marker, type PriceLine, type SeriesSpec } from '../components/Chart'
import { Disclaimer, ErrorBox, Loading, Stat, SymbolPicker } from '../components/common'
import { ExportButton, NewsCard } from '../components/extras'
import { KapCard } from './Kap'
import TradePanel from '../components/TradePanel'
import { heikinAshi, Modal, saveChartImage } from '../components/ui'
import Markdown from '../components/Markdown'
import type { IChartApi } from 'lightweight-charts'

type Signal = { name: string; value: number | null; signal: string; note: string }
type Pattern = { time: number; key: string; name: string; direction: string; description: string; price: number }
type Level = { price: number; touches: number; type: 'destek' | 'direnç'; distance_pct: number }
type AnalysisRes = {
  indicators: Record<string, Point[]>
  summary: { signals: Signal[]; score: number; overall: string; stats: Record<string, number | null> }
  patterns: Pattern[]; levels: Level[]
}
type MtfRow = { timeframe: string; overall?: string; score?: number; count?: number; rsi?: number; macd?: string; trend?: string; change_pct?: number; error?: string }
type Drawings = { hlines: number[]; trends: { t1: number; p1: number; t2: number; p2: number }[] }

const EMPTY_DRAW: Drawings = { hlines: [], trends: [] }
const drawKey = (s: string) => `finanaliz_draw_${s}`
function loadDrawings(s: string): Drawings {
  try { return JSON.parse(localStorage.getItem(drawKey(s)) || '') as Drawings } catch { return EMPTY_DRAW }
}
function saveDrawings(s: string, d: Drawings) { try { localStorage.setItem(drawKey(s), JSON.stringify(d)) } catch { /* yoksay */ } }
const verdictCls = (v?: string) => v?.includes('Al') ? 'up' : v?.includes('Sat') ? 'down' : ''

const PERIODS = [
  { p: '5d', i: '15m', label: '5G' }, { p: '1mo', i: '1h', label: '1A' }, { p: '3mo', i: '1d', label: '3A' },
  { p: '6mo', i: '1d', label: '6A' }, { p: '1y', i: '1d', label: '1Y' }, { p: '2y', i: '1d', label: '2Y' },
  { p: '5y', i: '1wk', label: '5Y' },
]
const OVERLAYS = [
  { key: 'sma20', label: 'SMA 20', color: COLORS.yellow },
  { key: 'sma50', label: 'SMA 50', color: COLORS.orange },
  { key: 'sma200', label: 'SMA 200', color: COLORS.purple },
  { key: 'ema12', label: 'EMA 12', color: COLORS.teal },
  { key: 'ema26', label: 'EMA 26', color: COLORS.pink },
  { key: 'bb', label: 'Bollinger', color: COLORS.blue },
]

export default function Analysis() {
  const [params, setParams] = useSearchParams()
  const symbol = params.get('s') || 'THYAO.IS'
  const [range, setRange] = useState(PERIODS[4])
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ sma20: true, sma50: true, bb: false })
  const [panes, setPanes] = useState({ rsi: true, macd: true })
  const [hist, setHist] = useState<{ name: string; currency: string; candles: Candle[] } | null>(null)
  const [ana, setAna] = useState<AnalysisRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showPatterns, setShowPatterns] = useState(true)
  const [heikin, setHeikin] = useState(false)
  const [insight, setInsight] = useState<{ text: string; source: string } | 'loading' | null>(null)
  const askInsight = () => { setInsight('loading'); api<{ text: string; source: string }>(`/ai/chart-insight/${encodeURIComponent(symbol)}`).then(setInsight).catch(e => { setInsight(null); setMsg(e.message) }) }
  const [full, setFull] = useState(false)
  const [chartApi, setChartApi] = useState<IChartApi | null>(null)
  useEffect(() => {
    const f = () => setFull(x => !x)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('finanaliz:fullscreen', f); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('finanaliz:fullscreen', f); window.removeEventListener('keydown', esc) }
  }, [])
  const savePng = () => saveChartImage(chartApi, `Grafik_${symbol}`).then(r => setMsg(`Grafik kaydedildi: ${r.path}`)).catch(e => setMsg(e.message))
  const [showLevels, setShowLevels] = useState(true)
  const [tool, setTool] = useState<'none' | 'hline' | 'trend'>('none')
  const [pending, setPending] = useState<{ t: number; p: number } | null>(null)
  const [draw, setDraw] = useState<Drawings>(() => loadDrawings(symbol))
  const [mtf, setMtf] = useState<MtfRow[] | null>(null)

  useEffect(() => { setDraw(loadDrawings(symbol)); setPending(null); setTool('none') }, [symbol])
  useEffect(() => { setMtf(null); api<MtfRow[]>(`/mtf/${encodeURIComponent(symbol)}`).then(setMtf).catch(() => setMtf([])) }, [symbol])
  const updateDraw = (d: Drawings) => { setDraw(d); saveDrawings(symbol, d) }

  const onChartClick = (time: number | null, price: number | null) => {
    if (price === null || tool === 'none') return
    if (tool === 'hline') { updateDraw({ ...draw, hlines: [...draw.hlines, price] }); setTool('none'); return }
    if (time === null) return
    if (!pending) { setPending({ t: time, p: price }); return }
    if (time !== pending.t) {
      const [a, b] = time > pending.t ? [pending, { t: time, p: price }] : [{ t: time, p: price }, pending]
      updateDraw({ ...draw, trends: [...draw.trends, { t1: a.t, p1: a.p, t2: b.t, p2: b.p }] })
    }
    setPending(null); setTool('none')
  }

  useEffect(() => {
    setHist(null); setAna(null); setError(null)
    const q = `period=${range.p}&interval=${range.i}`
    Promise.all([api(`/history/${encodeURIComponent(symbol)}?${q}`), api<AnalysisRes>(`/analysis/${encodeURIComponent(symbol)}?${q}`)])
      .then(([h, a]) => { setHist(h); setAna(a) })
      .catch(e => setError(e.message))
  }, [symbol, range])

  const series = useMemo<SeriesSpec[]>(() => {
    if (!hist || !ana) return []
    const s: SeriesSpec[] = [{ kind: 'candle', data: heikin ? heikinAshi(hist.candles) : hist.candles }, { kind: 'volume', data: hist.candles }]
    for (const o of OVERLAYS) {
      if (!overlays[o.key]) continue
      if (o.key === 'bb') {
        s.push({ kind: 'line', data: ana.indicators.bb_upper, color: o.color, width: 1, dashed: true })
        s.push({ kind: 'line', data: ana.indicators.bb_mid, color: o.color, width: 1 })
        s.push({ kind: 'line', data: ana.indicators.bb_lower, color: o.color, width: 1, dashed: true })
      } else s.push({ kind: 'line', data: ana.indicators[o.key], color: o.color, width: 1 })
    }
    let pane = 1
    if (panes.rsi) s.push({ kind: 'line', data: ana.indicators.rsi, color: COLORS.purple, title: 'RSI', pane: pane++ })
    if (panes.macd) {
      s.push({ kind: 'hist', data: ana.indicators.macd_hist, pane })
      s.push({ kind: 'line', data: ana.indicators.macd, color: COLORS.blue, title: 'MACD', pane, width: 1 })
      s.push({ kind: 'line', data: ana.indicators.macd_signal, color: COLORS.orange, title: 'Sinyal', pane, width: 1 })
    }
    for (const t of draw.trends) s.push({ kind: 'line', data: [{ time: t.t1, value: t.p1 }, { time: t.t2, value: t.p2 }], color: COLORS.yellow, width: 2 })
    return s
  }, [hist, ana, overlays, panes, draw.trends, heikin])

  const markers = useMemo<Marker[] | undefined>(() => !ana || !showPatterns ? undefined : ana.patterns.map(p => ({
    time: p.time,
    position: p.direction === 'yükseliş' ? 'belowBar' : p.direction === 'düşüş' ? 'aboveBar' : 'inBar',
    color: p.direction === 'yükseliş' ? COLORS.up : p.direction === 'düşüş' ? COLORS.down : COLORS.gray,
    shape: p.direction === 'yükseliş' ? 'arrowUp' : p.direction === 'düşüş' ? 'arrowDown' : 'circle',
    text: p.key === 'doji' ? '' : p.name,
  })), [ana, showPatterns])

  const priceLines = useMemo<PriceLine[]>(() => [
    ...(showLevels && ana ? ana.levels.map(l => ({ price: l.price, color: l.type === 'destek' ? COLORS.up : COLORS.down, title: l.type === 'destek' ? 'Destek' : 'Direnç', dashed: true })) : []),
    ...draw.hlines.map(p => ({ price: p, color: COLORS.yellow, width: 2 })),
  ], [ana, showLevels, draw.hlines])

  const levels = useMemo(() => panes.rsi ? [{ pane: 1, value: 70, color: COLORS.down }, { pane: 1, value: 30, color: COLORS.up }] : [], [panes.rsi])
  const paneHeights = useMemo(() => [380, ...(panes.rsi ? [110] : []), ...(panes.macd ? [120] : [])], [panes])
  const chartHeight = paneHeights.reduce((a, b) => a + b, 0)

  const addWatch = () => api('/watchlist', { body: { symbol } }).then(() => setMsg(`${symbol} izleme listesine eklendi.`)).catch(e => setMsg(e.message))

  const st = ana?.summary.stats
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Teknik Analiz</h1><p className="muted">Etkileşimli grafik, teknik göstergeler ve otomatik sinyal özeti</p></div>
        <div className="row gap">
          <SymbolPicker value={symbol} onChange={s => setParams({ s })} />
          <button className="btn ghost" onClick={addWatch}>☆ İzlemeye ekle</button>
          <button className="btn primary glow" onClick={askInsight}>🧠 Grafiği yorumla</button>
          <ExportButton label="PDF rapor" endpoint={`/export/analysis/${encodeURIComponent(symbol)}`} />
        </div>
      </header>
      {msg && <div className="info-box" onClick={() => setMsg(null)}>{msg}</div>}
      <ErrorBox error={error} />

      <div className={`card ${full ? 'chart-full' : ''}`}>
        <div className="toolbar">
          <div>
            <span className="title-sym">{symbol}</span> <span className="muted">{hist?.name}</span>
            {st && <span className="title-price mono">{fmtPrice(st.last)} <small>{hist?.currency}</small> <span className={tone(st.change_1d)}>{fmtPct(st.change_1d)}</span></span>}
          </div>
          <div className="row gap wrap">
            <ChartStyleToggle />
            <div className="seg">
              {PERIODS.map(p => <button key={p.label} className={p.label === range.label ? 'active' : ''} onClick={() => setRange(p)}>{p.label}</button>)}
            </div>
          </div>
        </div>
        <div className="toolbar wrap">
          <div className="chips">
            {OVERLAYS.map(o => (
              <label key={o.key} className={`chip ${overlays[o.key] ? 'on' : ''}`} style={{ '--c': o.color } as CSSProperties}>
                <input type="checkbox" checked={!!overlays[o.key]} onChange={e => setOverlays({ ...overlays, [o.key]: e.target.checked })} />{o.label}
              </label>
            ))}
            <label className={`chip ${panes.rsi ? 'on' : ''}`} style={{ '--c': COLORS.purple } as CSSProperties}>
              <input type="checkbox" checked={panes.rsi} onChange={e => setPanes({ ...panes, rsi: e.target.checked })} />RSI
            </label>
            <label className={`chip ${panes.macd ? 'on' : ''}`} style={{ '--c': COLORS.blue } as CSSProperties}>
              <input type="checkbox" checked={panes.macd} onChange={e => setPanes({ ...panes, macd: e.target.checked })} />MACD
            </label>
          </div>
        </div>
        <div className="toolbar wrap">
          <div className="chips">
            <label className={`chip ${showPatterns ? 'on' : ''}`}><input type="checkbox" checked={showPatterns} onChange={e => setShowPatterns(e.target.checked)} />Mum formasyonları</label>
            <label className={`chip ${showLevels ? 'on' : ''}`}><input type="checkbox" checked={showLevels} onChange={e => setShowLevels(e.target.checked)} />Destek / Direnç</label>
            <label className={`chip ${heikin ? 'on' : ''}`} title="Heikin-Ashi mumları gürültüyü azaltıp trendi daha net gösterir"><input type="checkbox" checked={heikin} onChange={e => setHeikin(e.target.checked)} />Heikin-Ashi</label>
          </div>
          <div className="row gap">
            <span className="muted small">Çizim:</span>
            <button className={`btn small ${tool === 'hline' ? 'primary' : 'ghost'}`} onClick={() => { setTool(tool === 'hline' ? 'none' : 'hline'); setPending(null) }}>─ Yatay çizgi</button>
            <button className={`btn small ${tool === 'trend' ? 'primary' : 'ghost'}`} onClick={() => { setTool(tool === 'trend' ? 'none' : 'trend'); setPending(null) }}>╱ Trend çizgisi</button>
            {(draw.hlines.length > 0 || draw.trends.length > 0) && <button className="btn ghost small" onClick={() => updateDraw(EMPTY_DRAW)}>Çizimleri temizle</button>}
            <button className="btn ghost small" onClick={savePng} title="Grafiği PNG olarak kaydet">📷 Resim</button>
            <button className="btn ghost small" onClick={() => setFull(!full)} title="Tam ekran (F)">{full ? '🗗 Küçült' : '⛶ Tam ekran'}</button>
          </div>
        </div>
        {tool !== 'none' && <div className="info-box small mb">
          {tool === 'hline' ? 'Yatay çizgi eklemek için grafikte bir fiyat seviyesine tıklayın.' : pending ? 'Trend çizgisinin ikinci noktasına tıklayın.' : 'Trend çizgisinin ilk noktasına tıklayın.'}
          {' '}Çizimler bu varlık için kaydedilir.</div>}
        {!error && series.length === 0 ? <Loading /> : series.length > 0 &&
          <Chart series={series} height={full ? Math.max(chartHeight, window.innerHeight - 190) : chartHeight} paneHeights={paneHeights} levels={levels} markers={markers}
            priceLines={priceLines} onClick={onChartClick} cursor={tool !== 'none' ? 'crosshair' : undefined} onChart={setChartApi} />}
      </div>

      {ana && st && (
        <div className="grid2">
          <div className="card">
            <div className="row between">
              <h3>Gösterge Sinyalleri</h3>
              <span className={`verdict ${ana.summary.overall.includes('Al') ? 'up' : ana.summary.overall.includes('Sat') ? 'down' : ''}`}>{ana.summary.overall}</span>
            </div>
            <table className="table">
              <thead><tr><th>Gösterge</th><th className="r">Değer</th><th>Yorum</th><th className="r">Sinyal</th></tr></thead>
              <tbody>
                {ana.summary.signals.map(s => (
                  <tr key={s.name}>
                    <td>{s.name}</td><td className="r mono">{fmtPrice(s.value)}</td><td className="muted">{s.note}</td>
                    <td className="r"><span className={`pill ${s.signal === 'al' ? 'up' : s.signal === 'sat' ? 'down' : ''}`}>{s.signal.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>İstatistikler</h3>
            <div className="stats">
              <Stat label="Son fiyat" value={fmtPrice(st.last)} />
              <Stat label="Günlük değişim" value={fmtPct(st.change_1d)} cls={tone(st.change_1d)} />
              <Stat label="1 aylık değişim" value={fmtPct(st.change_1m)} cls={tone(st.change_1m)} />
              <Stat label="Dönem değişimi" value={fmtPct(st.change_period)} cls={tone(st.change_period)} />
              <Stat label="Dönem en yüksek" value={fmtPrice(st.high)} />
              <Stat label="Dönem en düşük" value={fmtPrice(st.low)} />
              <Stat label="Yıllık oynaklık" value={fmtPct(st.volatility, false)} />
              <Stat label="ATR (14)" value={fmtPrice(st.atr)} />
            </div>
            <div className="row gap mt wrap">
              <Link className="btn ghost" to={`/tahmin?s=${encodeURIComponent(symbol)}`}>🤖 YZ tahmini</Link>
              <Link className="btn ghost" to={`/backtest?s=${encodeURIComponent(symbol)}`}>⏱ Strateji testi</Link>
              <Link className="btn ghost" to={`/haberler?s=${encodeURIComponent(symbol)}`}>📰 Tüm haberler</Link>
              <Link className="btn ghost" to={`/temel?s=${encodeURIComponent(symbol)}`}>🏢 Temel analiz</Link>
            </div>
          </div>
        </div>
      )}
      <div className="card">
        <h3>Al / Sat — {symbol.replace('.IS', '')}</h3>
        <TradePanel symbol={symbol} />
      </div>

      {ana && (
        <div className="grid2">
          <div className="card">
            <h3>Son Mum Formasyonları</h3>
            {ana.patterns.length === 0 ? <p className="muted">Bu dönemde formasyon bulunamadı.</p> : (
              <table className="table">
                <thead><tr><th>Tarih</th><th>Formasyon</th><th>Yön</th><th className="r">Kapanış</th></tr></thead>
                <tbody>
                  {[...ana.patterns].reverse().slice(0, 8).map((p, i) => (
                    <tr key={i}>
                      <td className="nowrap">{new Date(p.time * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</td>
                      <td>{p.name}<div className="muted small">{p.description}</div></td>
                      <td><span className={`pill ${p.direction === 'yükseliş' ? 'up' : p.direction === 'düşüş' ? 'down' : ''}`}>{p.direction}</span></td>
                      <td className="r mono">{fmtPrice(p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h3>Destek & Direnç Seviyeleri</h3>
            <table className="table">
              <thead><tr><th>Tür</th><th className="r">Seviye</th><th className="r">Uzaklık</th><th className="r">Temas</th></tr></thead>
              <tbody>
                {[...ana.levels].sort((a, b) => b.price - a.price).map((l, i) => (
                  <tr key={i}>
                    <td><span className={`pill ${l.type === 'destek' ? 'up' : 'down'}`}>{l.type === 'destek' ? 'Destek' : 'Direnç'}</span></td>
                    <td className="r mono">{fmtPrice(l.price)}</td>
                    <td className={`r mono ${tone(l.distance_pct)}`}>{fmtPct(l.distance_pct)}</td>
                    <td className="r mono">{l.touches}</td>
                  </tr>
                ))}
                {ana.levels.length === 0 && <tr><td colSpan={4} className="muted">Belirgin seviye bulunamadı.</td></tr>}
              </tbody>
            </table>
            <p className="muted small">Seviyeler, yerel tepe ve diplerin ATR'ye göre kümelenmesiyle bulunur; "temas" o bölgede kaç kez dönüş yaşandığını gösterir.</p>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Çoklu Zaman Dilimi Özeti</h3>
        {!mtf ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Zaman dilimi</th><th className="c">Genel görünüm</th><th className="r">RSI</th><th className="c">MACD</th><th className="c">Trend (SMA20/50)</th><th className="r">Son mum değişimi</th></tr></thead>
            <tbody>
              {mtf.map(r => r.error ? (
                <tr key={r.timeframe}><td>{r.timeframe}</td><td colSpan={5} className="muted">Veri yok</td></tr>
              ) : (
                <tr key={r.timeframe}>
                  <td><strong>{r.timeframe}</strong></td>
                  <td className="c"><span className={`verdict small ${verdictCls(r.overall)}`}>{r.overall}</span></td>
                  <td className={`r mono ${r.rsi! < 30 ? 'up' : r.rsi! > 70 ? 'down' : ''}`}>{r.rsi?.toLocaleString('tr-TR')}</td>
                  <td className="c"><span className={`pill ${r.macd === 'al' ? 'up' : 'down'}`}>{r.macd?.toUpperCase()}</span></td>
                  <td className="c"><span className={`pill ${r.trend === 'Yükseliş' ? 'up' : r.trend === 'Düşüş' ? 'down' : ''}`}>{r.trend}</span></td>
                  <td className={`r mono ${tone(r.change_pct)}`}>{fmtPct(r.change_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Farklı zaman dilimlerindeki sinyallerin aynı yönü göstermesi, eğilimin daha güçlü olduğuna işaret eder.</p>
      </div>

      {symbol.endsWith('.IS') && <KapCard symbol={symbol} />}
      <NewsCard symbol={symbol} />
      {insight && (
        <Modal title={`🧠 Yapay Zekâ Grafik Yorumu — ${symbol.replace('.IS', '')}`} onClose={() => setInsight(null)} wide>
          {insight === 'loading' ? <div className="ai-thinking"><span className="ai-dot" /><span className="ai-dot" /><span className="ai-dot" /> Grafik, göstergeler, formasyonlar ve seviyeler inceleniyor…</div> : (
            <>
              <Markdown text={insight.text} />
              <p className="muted small">{insight.source === 'llm' ? 'Bu yorum yapay zekâ (Claude) tarafından yazıldı.' : 'Bu yorum göstergelerden kural tabanlı üretildi. Ayarlar\'da LLM anahtarı tanımlarsanız yorumu yapay zekâ yazar.'}</p>
            </>
          )}
        </Modal>
      )}
      <Disclaimer />
    </div>
  )
}
