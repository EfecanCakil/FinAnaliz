import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { IChartApi } from 'lightweight-charts'
import { api, fmtPct, fmtPrice, tone, type Candle, type Quote } from '../api'
import { useAutoRefresh } from '../refresh'

/* ------------------------------------------------------------------ Canlı fiyat */
/** Değer değiştiğinde kısa süre yeşil/kırmızı yanıp sönen fiyat. */
export function LivePrice({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState<'' | 'flash-up' | 'flash-down'>('')
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down')
      const id = setTimeout(() => setFlash(''), 1200)
      prev.current = value
      return () => clearTimeout(id)
    }
    prev.current = value
  }, [value])
  return <span className={`mono ${className} ${flash}`}>{fmtPrice(value)}</span>
}

/* ------------------------------------------------------------------ İskelet yükleyici */
export function Skeleton({ rows = 4, text }: { rows?: number; text?: string }) {
  return (
    <div className="skeleton" aria-busy="true">
      {text && <div className="muted small">{text}</div>}
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="sk-line" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  )
}

/* ------------------------------------------------------------------ Kayan fiyat bandı */
const TAPE = ['XU100.IS', 'XU030.IS', '^GSPC', '^IXIC', '^DJI', 'USDTRY=X', 'EURTRY=X', 'GRAM-ALTIN', 'GC=F', 'BZ=F', 'BTC-USD', 'ETH-USD',
  'THYAO.IS', 'ASELS.IS', 'GARAN.IS', 'AAPL', 'NVDA', 'TSLA']

export function TickerTape() {
  const [qs, setQs] = useState<Quote[]>([])
  const nav = useNavigate()
  const load = () => api<Quote[]>(`/quotes?symbols=${encodeURIComponent(TAPE.join(','))}`).then(setQs).catch(() => {})
  useEffect(() => { load() }, [])
  useAutoRefresh(load)
  if (!qs.length) return <div className="tape" />
  const items = qs.filter(q => q.price != null)
  return (
    <div className="tape">
      <div className="tape-track">
        {[...items, ...items].map((q, i) => (
          <span key={i} className="tape-item" onClick={() => nav(`/analiz?s=${encodeURIComponent(q.symbol)}`)}>
            <b>{q.name}</b> <LivePrice value={q.price} /> <span className={tone(q.change_pct)}>{(q.change_pct ?? 0) >= 0 ? '▲' : '▼'} {fmtPct(q.change_pct)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Bildirim merkezi */
type Notif = { id: number; kind: string; title: string; body: string; link: string | null; read: number; created_at: string; icon: string }

export function NotificationBell({ onNew }: { onNew: (n: Notif[]) => void }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ items: Notif[]; unread: number }>({ items: [], unread: 0 })
  const last = useRef<number | null>(null)
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)

  const load = () => api<{ items: Notif[]; unread: number }>('/notifications').then(d => {
    setData(d)
    const maxId = d.items[0]?.id ?? 0
    if (last.current !== null && maxId > last.current) onNew(d.items.filter(n => n.id > last.current!).reverse())
    last.current = Math.max(last.current ?? 0, maxId)
  }).catch(() => {})
  useEffect(() => { load(); const id = setInterval(load, 20_000); return () => clearInterval(id) }, [])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const toggle = () => setOpen(o => !o)
    document.addEventListener('mousedown', close)
    window.addEventListener('finanaliz:notifications', toggle)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('finanaliz:notifications', toggle) }
  }, [])

  const markAll = () => api('/notifications/read', { body: {} }).then(load)
  const clear = () => api('/notifications', { method: 'DELETE' }).then(load)
  const go = (n: Notif) => { api('/notifications/read', { body: { ids: [n.id] } }).then(load); if (n.link) nav(n.link); setOpen(false) }

  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" onClick={() => setOpen(!open)} title="Bildirimler (N)">🔔{data.unread > 0 && <span className="bell-badge">{data.unread > 99 ? '99+' : data.unread}</span>}</button>
      {open && (
        <div className="bell-menu">
          <div className="row between bell-head">
            <strong>Bildirimler</strong>
            <div className="row gap"><button className="btn ghost small" onClick={markAll}>Tümünü okundu say</button><button className="btn ghost small" onClick={clear}>Temizle</button></div>
          </div>
          <div className="bell-list">
            {data.items.length === 0 && <p className="muted pad">Henüz bildirim yok. Alarmlar, emirler, botlar, takaslar ve rozetler burada görünür.</p>}
            {data.items.map(n => (
              <div key={n.id} className={`bell-item ${n.read ? '' : 'unread'}`} onClick={() => go(n)}>
                <span className="bell-icon">{n.icon}</span>
                <div><div className="strong small">{n.title}</div>{n.body && <div className="muted small">{n.body}</div>}
                  <div className="muted tiny">{new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Klavye kısayolları */
export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl + K  veya  /', label: 'Hızlı arama' }, { keys: '?', label: 'Kısayol listesini aç' },
  { keys: 'D', label: 'Ana ekran (piyasa özeti)' }, { keys: 'P', label: 'Portföy' }, { keys: 'A', label: 'Teknik analiz' },
  { keys: 'İ', label: 'İzleme listesi ve alarmlar' }, { keys: 'M', label: 'Çoklu grafik' }, { keys: 'B', label: 'Botlar' },
  { keys: 'N', label: 'Bildirimleri aç / kapat' }, { keys: 'R', label: 'Sayfadaki verileri yenile' }, { keys: 'T', label: 'Açık / koyu tema' },
  { keys: 'F', label: 'Grafiği tam ekran yap (analiz sayfasında)' }, { keys: 'Esc', label: 'Pencereleri kapat' },
]

export function useShortcuts(actions: { toggleTheme: () => void; openHelp: () => void }) {
  const nav = useNavigate()
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return
      const k = e.key.toLocaleLowerCase('tr')
      const routes: Record<string, string> = { d: '/', p: '/portfoy', a: '/analiz', 'i': '/izleme', 'ı': '/izleme', m: '/coklu-grafik', b: '/botlar' }
      if (k === '/') { e.preventDefault(); window.dispatchEvent(new Event('finanaliz:search')) }
      else if (k === '?') actions.openHelp()
      else if (k === 'n') window.dispatchEvent(new Event('finanaliz:notifications'))
      else if (k === 'r') window.dispatchEvent(new Event('finanaliz:refresh-now'))
      else if (k === 't') actions.toggleTheme()
      else if (k === 'f') window.dispatchEvent(new Event('finanaliz:fullscreen'))
      else if (routes[k]) nav(routes[k])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [actions])
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <div className="row between"><h3>{title}</h3><button className="btn ghost small" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="⌨️ Klavye Kısayolları" onClose={onClose}>
      <table className="table"><tbody>
        {SHORTCUTS.map(s => <tr key={s.label}><td><kbd>{s.keys}</kbd></td><td>{s.label}</td></tr>)}
      </tbody></table>
      <p className="muted small">Kısayollar bir yazı alanına yazarken çalışmaz.</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Tanıtım turu */
const TOUR = [
  { icon: '👋', title: 'FinAnaliz\'e hoş geldiniz', text: 'Borsa İstanbul, ABD borsaları, döviz, altın ve kripto paraları tek uygulamada takip edip yapay zekâ destekli analizler yapabilirsiniz. Kısa bir tur atalım.' },
  { icon: '◧', title: 'Piyasa Özeti', text: 'Ana ekranda endeksler, favorileriniz, günün bülteni ve öne çıkan hareketler yer alır. "Düzenle" ile kartların yerini ve görünürlüğünü değiştirebilirsiniz.' },
  { icon: '📈', title: 'Analiz', text: 'Teknik analiz sayfasında mum grafiği, göstergeler, formasyonlar, destek/direnç, çizim araçları, temel analiz, KAP bildirimleri ve haberler bulunur.' },
  { icon: '💼', title: '100.000 TL sanal hesap', text: 'Al / Sat paneliyle gerçek fiyatlardan sanal işlem yapın. Limit, zarar durdur ve kâr al emirleri verebilir, T0/T1/T2 takas bakiyelerini izleyebilirsiniz.' },
  { icon: '🤖', title: 'Yapay zekâ ve otomasyon', text: 'Fiyat tahmini, grafik yorumu, günlük bülten, portföy danışmanı ve strateji botları sizin için çalışır. Alarmlar ve emirler arka planda kontrol edilir.' },
  { icon: '🔔', title: 'Bildirimler ve kısayollar', text: 'Sağ üstteki zil tüm bildirimleri toplar. Klavyede "?" tuşuna basarak kısayolları, Ctrl+K ile hızlı aramayı açabilirsiniz. İyi analizler!' },
]

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const step = TOUR[i]
  return (
    <div className="qs-backdrop">
      <div className="modal tour">
        <div className="tour-icon">{step.icon}</div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-dots">{TOUR.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="row between">
          <button className="btn ghost" onClick={onClose}>Turu atla</button>
          <div className="row gap">
            {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>Geri</button>}
            {i < TOUR.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>İleri</button> : <button className="btn primary" onClick={onClose}>Başlayalım</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Açılış ekranı */
export function Splash({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false)
  useEffect(() => { if (done) { const id = setTimeout(() => setGone(true), 500); return () => clearTimeout(id) } }, [done])
  if (gone) return null
  return (
    <div className={`splash ${done ? 'out' : ''}`}>
      <div className="splash-logo">◆</div>
      <div className="splash-name">FinAnaliz</div>
      <div className="muted">Yapay Zekâ Destekli Finansal Analiz</div>
      <div className="splash-bar"><div /></div>
    </div>
  )
}

/* ------------------------------------------------------------------ Grafik araçları */
export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  candles.forEach((c, i) => {
    const close = (c.open + c.high + c.low + c.close) / 4
    const open = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2
    out.push({ ...c, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close) })
  })
  return out
}

/** Grafiği PNG olarak İndirilenler\FinAnaliz klasörüne kaydeder. */
export async function saveChartImage(chart: IChartApi | null, name: string) {
  if (!chart) throw new Error('Grafik hazır değil.')
  const canvas = chart.takeScreenshot()
  const data = canvas.toDataURL('image/png').split(',')[1]
  return api<{ path: string }>('/export/image', { body: { name, data } })
}

/* ------------------------------------------------------------------ Treemap */
type TmNode = { key: string; value: number; label: string; sub?: string; change: number | null; onClick?: () => void }
type Rect = { x: number; y: number; w: number; h: number }

function squarify(nodes: { value: number }[], rect: Rect): Rect[] {
  const total = nodes.reduce((s, n) => s + n.value, 0)
  if (!total) return nodes.map(() => ({ ...rect, w: 0, h: 0 }))
  const scaled = nodes.map(n => n.value / total * rect.w * rect.h)
  const out: Rect[] = []
  let { x, y, w, h } = rect
  let i = 0
  while (i < scaled.length) {
    const short = Math.min(w, h)
    let row = [scaled[i]], j = i + 1
    const worst = (r: number[]) => { const s = r.reduce((a, b) => a + b, 0); const mx = Math.max(...r), mn = Math.min(...r); return Math.max(short * short * mx / (s * s), s * s / (short * short * mn)) }
    while (j < scaled.length && worst([...row, scaled[j]]) <= worst(row)) { row.push(scaled[j]); j++ }
    const sum = row.reduce((a, b) => a + b, 0)
    if (w >= h) {
      const cw = sum / h; let cy = y
      row.forEach(v => { const ch = v / cw; out.push({ x, y: cy, w: cw, h: ch }); cy += ch })
      x += cw; w -= cw
    } else {
      const rh = sum / w; let cx = x
      row.forEach(v => { const cw2 = v / rh; out.push({ x: cx, y, w: cw2, h: rh }); cx += cw2 })
      y += rh; h -= rh
    }
    i = j
  }
  return out
}

const heatColor = (v: number | null) => {
  if (v == null) return 'rgba(139,150,168,0.35)'
  const a = Math.min(Math.abs(v) / 3, 1)
  return v >= 0 ? `rgba(38,166,154,${0.25 + a * 0.7})` : `rgba(239,83,80,${0.25 + a * 0.7})`
}

/** İki seviyeli (sektör → hisse) kare ağırlıklı ağaç haritası. */
export function Treemap({ groups, height = 560 }: { groups: { name: string; nodes: TmNode[] }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  useEffect(() => {
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const layout = useMemo(() => {
    const gs = groups.map(g => ({ ...g, value: g.nodes.reduce((s, n) => s + n.value, 0) })).filter(g => g.value > 0).sort((a, b) => b.value - a.value)
    const rects = squarify(gs, { x: 0, y: 0, w: width, h: height })
    return gs.map((g, i) => {
      const r = rects[i]
      const inner = { x: r.x + 2, y: r.y + 18, w: Math.max(r.w - 4, 0), h: Math.max(r.h - 20, 0) }
      const nodes = [...g.nodes].sort((a, b) => b.value - a.value)
      return { g, r, cells: squarify(nodes, inner).map((c, k) => ({ c, n: nodes[k] })) }
    })
  }, [groups, width, height])
  return (
    <div className="treemap" ref={ref} style={{ height }}>
      {layout.map(({ g, r, cells }) => (
        <div key={g.name}>
          <div className="tm-group" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}><span>{g.name}</span></div>
          {cells.map(({ c, n }) => (
            <div key={n.key} className="tm-cell" onClick={n.onClick} title={`${n.label}${n.sub ? ' · ' + n.sub : ''} · ${fmtPct(n.change)}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: heatColor(n.change) }}>
              {c.w > 44 && c.h > 26 && <><b style={{ fontSize: Math.min(16, Math.max(10, c.w / 6)) }}>{n.label}</b>{c.h > 40 && <span>{fmtPct(n.change)}</span>}</>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
