import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, MARKET_LABELS } from '../api'

type Asset = { symbol: string; name: string; market: string }
let catalogCache: Asset[] | null = null

export function useCatalog() {
  const [items, setItems] = useState<Asset[]>(catalogCache ?? [])
  useEffect(() => {
    if (catalogCache) return
    api<{ catalog: Record<string, { symbol: string; name: string }[]>; universe?: Record<string, { symbol: string; name: string }[]> }>('/markets').then(r => {
      const base = Object.entries(r.catalog).flatMap(([m, list]) => list.map(a => ({ ...a, market: m })))
      const seen = new Set(base.map(a => a.symbol))
      const extra = Object.entries(r.universe ?? {}).flatMap(([m, list]) => list.filter(a => !seen.has(a.symbol)).map(a => ({ ...a, market: m })))
      catalogCache = [...base, ...extra]
      setItems(catalogCache)
    }).catch(() => {})
  }, [])
  return items
}

/** Katalogdan veya Yahoo Finance aramasından sembol seçimi. */
export function SymbolPicker({ value, onChange, placeholder = 'Sembol ara (ör. THYAO, AAPL, BTC)' }:
  { value?: string; onChange: (symbol: string) => void; placeholder?: string }) {
  const catalog = useCatalog()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<Asset[]>([])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) { setRemote([]); return }
    const id = setTimeout(() => api<Asset[]>(`/search?q=${encodeURIComponent(q)}`).then(setRemote).catch(() => {}), 350)
    return () => clearTimeout(id)
  }, [q])

  const ql = q.toLowerCase()
  const local = catalog.filter(a => !q || a.symbol.toLowerCase().includes(ql) || a.name.toLowerCase().includes(ql))
  const list = [...local, ...remote.filter(r => !local.some(l => l.symbol === r.symbol))]
  const current = catalog.find(a => a.symbol === value)

  const pick = (s: string) => { onChange(s); setQ(''); setOpen(false) }

  return (
    <div className="picker" ref={box}>
      <input
        value={open ? q : value ? `${value}${current ? ' · ' + current.name : ''}` : ''}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (list[0]) pick(list[0].symbol)
            else if (q.trim()) pick(q.trim().toUpperCase())
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && (
        <div className="picker-menu">
          {list.length === 0 && <div className="muted pad">Sonuç yok — Enter ile “{q.toUpperCase()}” sembolünü deneyin.</div>}
          {list.slice(0, 40).map(a => (
            <button key={a.symbol} className="picker-item" onMouseDown={e => e.preventDefault()} onClick={() => pick(a.symbol)}>
              <span className="sym">{a.symbol}</span>
              <span className="name">{a.name}</span>
              <span className="tag">{MARKET_LABELS[a.market] ?? a.market}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sparkline({ data, width = 96, height = 30 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...data), max = Math.max(...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`)
  const up = data[data.length - 1] >= data[0]
  return (
    <svg width={width} height={height} className="spark">
      <polyline points={pts.join(' ')} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.5" />
    </svg>
  )
}

export function Loading({ text = 'Yükleniyor…' }: { text?: string }) {
  return (
    <div className="skeleton" aria-busy="true">
      <div className="loading-text"><span className="spinner" />{text}</div>
      <div className="sk-line" style={{ width: '92%' }} /><div className="sk-line" style={{ width: '78%' }} /><div className="sk-line" style={{ width: '64%' }} />
    </div>
  )
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error-box">{error}</div> : null
}

export function Stat({ label, value, cls = '' }: { label: ReactNode; value: ReactNode; cls?: string }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className={`stat-value ${cls}`}>{value}</div></div>
}

export function Disclaimer() {
  return <p className="disclaimer">Bu platformdaki veriler ve analizler yalnızca eğitim ve bilgilendirme amaçlıdır; yatırım tavsiyesi değildir. Veriler gecikmeli olabilir.</p>
}
