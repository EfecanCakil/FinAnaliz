import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, MARKET_LABELS } from '../api'
import { useCatalog } from './common'

type Asset = { symbol: string; name: string; market: string }

const PAGES = [
  { to: '/', name: 'Piyasa Özeti' }, { to: '/bulten', name: 'Günün Bülteni' }, { to: '/piyasa/bist', name: 'Borsa İstanbul' },
  { to: '/piyasa/abd', name: 'ABD Borsaları' }, { to: '/piyasa/doviz', name: 'Döviz & Emtia' }, { to: '/piyasa/kripto', name: 'Kripto Paralar' },
  { to: '/haberler', name: 'Haberler' }, { to: '/takvim', name: 'Ekonomik Takvim' }, { to: '/tarama', name: 'Teknik Tarama' },
  { to: '/analiz', name: 'Teknik Analiz' }, { to: '/tahmin', name: 'YZ Tahmin' },
  { to: '/karsilastir', name: 'Karşılaştırma' }, { to: '/backtest', name: 'Strateji Testi' }, { to: '/portfoy', name: 'Portföy' },
  { to: '/izleme', name: 'İzleme & Alarmlar' }, { to: '/ayarlar', name: 'Ayarlar' },
]

/** Ctrl+K ile açılan hızlı arama: varlıklara ve sayfalara klavyeyle hızlı geçiş. */
export default function QuickSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [remote, setRemote] = useState<Asset[]>([])
  const catalog = useCatalog()
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
      if (e.key === 'Escape') setOpen(false)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('finanaliz:search', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('finanaliz:search', onOpen) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  useEffect(() => {
    if (q.trim().length < 2) { setRemote([]); return }
    const id = setTimeout(() => api<Asset[]>(`/search?q=${encodeURIComponent(q)}`).then(setRemote).catch(() => {}), 300)
    return () => clearTimeout(id)
  }, [q])

  if (!open) return null
  const ql = q.toLocaleLowerCase('tr')
  const pages = PAGES.filter(p => ql && p.name.toLocaleLowerCase('tr').includes(ql)).map(p => ({ kind: 'page' as const, ...p }))
  const local = catalog.filter(a => !ql || a.symbol.toLowerCase().includes(ql) || a.name.toLocaleLowerCase('tr').includes(ql))
  const assets = [...local, ...remote.filter(r => !local.some(l => l.symbol === r.symbol))].slice(0, 12)
    .map(a => ({ kind: 'asset' as const, ...a }))
  const items = [...pages, ...assets]
  if (!items.length && q.trim()) items.push({ kind: 'asset', symbol: q.trim().toUpperCase(), name: 'Sembolü doğrudan aç', market: '' })

  const go = (i: number) => {
    const it = items[i]
    if (!it) return
    nav(it.kind === 'page' ? it.to : `/analiz?s=${encodeURIComponent(it.symbol)}`)
    setOpen(false)
  }

  return (
    <div className="qs-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="qs-box" onMouseDown={e => e.stopPropagation()}>
        <input ref={input} value={q} placeholder="Varlık veya sayfa ara… (ör. THYAO, altın, tarama)" onChange={e => { setQ(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
            if (e.key === 'Enter') go(sel)
          }} />
        <div className="qs-list">
          {items.map((it, i) => (
            <div key={(it.kind === 'page' ? it.to : it.symbol) + i} className={`qs-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              {it.kind === 'page'
                ? <><span className="muted small">Sayfa</span><span>{it.name}</span><span /></>
                : <><span className="sym">{it.symbol}</span><span className="muted">{it.name}</span><span className="muted small">{MARKET_LABELS[it.market] ?? ''}</span></>}
            </div>
          ))}
        </div>
        <div className="qs-hint"><span><kbd>↑</kbd> <kbd>↓</kbd> seç</span><span><kbd>Enter</kbd> aç</span><span><kbd>Esc</kbd> kapat</span></div>
      </div>
    </div>
  )
}
