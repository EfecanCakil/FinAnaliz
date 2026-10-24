import { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtPct, fmtPrice } from '../api'
import { ErrorBox, Loading } from '../components/common'
import { openStock } from '../components/StockCard'
import { useAutoRefresh } from '../refresh'

type Tile = { symbol: string; name: string; sector: string; mcap: number | null; price: number
  change_pct: number | null; change_1w: number | null; change_1m: number | null; change_ytd: number | null }
type Res = { tiles: Tile[]; fetched_at: number | null; refreshing: boolean }
type Rect = { x: number; y: number; w: number; h: number }
type Period = 'change_pct' | 'change_1w' | 'change_1m' | 'change_ytd'

const PERIODS: [Period, string, number][] = [['change_pct', 'Bugün', 3], ['change_1w', '1 Hafta', 6], ['change_1m', '1 Ay', 10], ['change_ytd', 'Yılbaşından beri', 25]]
const LIMITS: Record<string, number> = { bist: 200, us: 250 }

// Squarified treemap: kutuları mümkün olduğunca kareye yakın yerleştirir
function squarify<T>(items: { v: number; item: T }[], r: Rect): (Rect & { item: T })[] {
  const out: (Rect & { item: T })[] = []
  const total = items.reduce((s, i) => s + i.v, 0)
  if (!total || r.w <= 0 || r.h <= 0) return out
  const scale = (r.w * r.h) / total
  const list = items.map(i => ({ a: i.v * scale, item: i.item })).sort((a, b) => b.a - a.a)
  let { x, y, w, h } = r
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0), mx = Math.max(...row), mn = Math.min(...row)
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  let i = 0
  while (i < list.length) {
    const side = Math.min(w, h)
    const row = [list[i].a]
    let j = i + 1
    while (j < list.length && worst([...row, list[j].a], side) <= worst(row, side)) { row.push(list[j].a); j++ }
    const s = row.reduce((a, b) => a + b, 0)
    if (w >= h) {  // sütun olarak sola yerleştir
      const cw = s / h
      let cy = y
      for (let k = i; k < j; k++) { const ch = list[k].a / cw; out.push({ x, y: cy, w: cw, h: ch, item: list[k].item }); cy += ch }
      x += cw; w -= cw
    } else {  // satır olarak üste yerleştir
      const rh = s / w
      let cx = x
      for (let k = i; k < j; k++) { const cw2 = list[k].a / rh; out.push({ x: cx, y, w: cw2, h: rh, item: list[k].item }); cx += cw2 }
      y += rh; h -= rh
    }
    i = j
  }
  return out
}

function color(v: number | null, range: number) {
  if (v == null) return 'var(--panel-2)'
  const t = Math.max(-1, Math.min(1, v / range))
  const mix = (a: number[], b: number[], k: number) => a.map((x, i) => Math.round(x + (b[i] - x) * k))
  const neutral = [58, 63, 75], green = [22, 163, 74], red = [220, 38, 38]
  const [r, g, b] = t >= 0 ? mix(neutral, green, t) : mix(neutral, red, -t)
  return `rgb(${r},${g},${b})`
}

export default function Heatmap() {
  const [mkt, setMkt] = useState<'bist' | 'us'>(() => { try { return (localStorage.getItem('finanaliz_heatmap_mkt') as 'bist' | 'us') || 'bist' } catch { return 'bist' } })
  const [period, setPeriod] = useState<Period>('change_pct')
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(1000)
  const box = useRef<HTMLDivElement>(null)

  const load = () => api<Res>(`/heatmap/${mkt}`).then(d => { setData(d); setError(null) }).catch(e => setError(e.message))
  useEffect(() => { setData(null); load(); try { localStorage.setItem('finanaliz_heatmap_mkt', mkt) } catch { /* yoksay */ } }, [mkt])
  useAutoRefresh(load)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(e => setWidth(Math.floor(e[0].contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [data !== null])

  const height = Math.max(420, Math.min(760, Math.round(width * 0.62)))
  const range = PERIODS.find(p => p[0] === period)![2]

  const layout = useMemo(() => {
    if (!data) return null
    const caps = data.tiles.map(t => t.mcap).filter((v): v is number => !!v).sort((a, b) => a - b)
    const median = caps[Math.floor(caps.length / 2)] || 1
    const top = [...data.tiles].sort((a, b) => (b.mcap ?? median) - (a.mcap ?? median)).slice(0, LIMITS[mkt])
    const bySector = new Map<string, Tile[]>()
    for (const t of top) bySector.set(t.sector, [...(bySector.get(t.sector) ?? []), t])
    const sectors = squarify([...bySector.entries()].map(([name, list]) => ({ v: list.reduce((s, t) => s + (t.mcap ?? median), 0), item: { name, list } })),
      { x: 0, y: 0, w: width, h: height })
    return sectors.map(s => {
      const head = s.h > 60 && s.w > 70 ? 18 : 0
      const tiles = squarify(s.item.list.map(t => ({ v: t.mcap ?? median, item: t })), { x: s.x + 1, y: s.y + head + 1, w: s.w - 2, h: s.h - head - 2 })
      const sectorChg = (() => {
        const xs = s.item.list.filter(t => t[period] != null)
        const wsum = xs.reduce((a, t) => a + (t.mcap ?? median), 0)
        return wsum ? xs.reduce((a, t) => a + (t[period] as number) * (t.mcap ?? median), 0) / wsum : null
      })()
      return { ...s, head, tiles, sectorChg }
    })
  }, [data, width, height, period, mkt])

  const stats = useMemo(() => {
    if (!data) return null
    const vals = data.tiles.map(t => t[period]).filter((v): v is number => v != null)
    return { up: vals.filter(v => v > 0).length, down: vals.filter(v => v < 0).length, total: vals.length }
  }, [data, period])

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Piyasa Isı Haritası</h1>
          <p className="muted">Her kutu bir şirket: <b className="up">yeşil</b> yükselen, <b className="down">kırmızı</b> düşen. Kutu büyüklüğü şirketin piyasa değerini gösterir. Bir kutuya tıklayınca özeti açılır.</p></div>
        <div className="row gap wrap">
          <div className="seg">
            <button className={mkt === 'bist' ? 'active' : ''} onClick={() => setMkt('bist')}>Borsa İstanbul</button>
            <button className={mkt === 'us' ? 'active' : ''} onClick={() => setMkt('us')}>ABD (S&P 500)</button>
          </div>
          <div className="seg">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        </div>
      </header>
      <ErrorBox error={error} />
      {!data && !error && <Loading text="Tüm hisselerin verisi hazırlanıyor…" />}
      {data && (
        <div className="card">
          <div className="row between wrap gap small">
            <span>
              {stats && <><b className="up">▲ {stats.up} yükselen</b> · <b className="down">▼ {stats.down} düşen</b> · <span className="muted">en büyük {LIMITS[mkt]} şirket gösteriliyor</span></>}
            </span>
            <span className="muted">{data.refreshing ? 'Güncelleniyor… · ' : ''}Veri: {data.fetched_at ? new Date(data.fetched_at * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—'} (gecikmeli olabilir)</span>
          </div>
          <div ref={box} className="heatmap" style={{ height }}>
            {layout?.map(s => (
              <div key={s.item.name}>
                <div className="hm-sector" style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
                  {s.head > 0 && <div className="hm-sector-name">{s.item.name} <span className="mono">{fmtPct(s.sectorChg)}</span></div>}
                </div>
                {s.tiles.map(t => {
                  const v = t.item[period]
                  const big = t.w > 54 && t.h > 34, huge = t.w > 110 && t.h > 70
                  return (
                    <button key={t.item.symbol} className="hm-tile" onClick={() => openStock(t.item.symbol)}
                      title={`${t.item.name} (${t.item.symbol.replace('.IS', '')})\nFiyat: ${fmtPrice(t.item.price)}\nDeğişim: ${fmtPct(v)}`}
                      style={{ left: t.x, top: t.y, width: Math.max(t.w - 1, 0), height: Math.max(t.h - 1, 0), background: color(v, range), fontSize: huge ? 16 : 11 }}>
                      {big && <><b>{t.item.symbol.replace('.IS', '')}</b><span>{fmtPct(v)}</span></>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="hm-legend">
            <span className="muted small">−%{range}</span>
            {[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map(k => <span key={k} style={{ background: color(k * range, range) }} />)}
            <span className="muted small">+%{range}</span>
          </div>
        </div>
      )}
    </div>
  )
}
