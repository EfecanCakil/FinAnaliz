import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Tarayıcıdaki gibi çoklu sekme: her sekme bir sayfa adresini tutar; sekmeler bu bilgisayarda hatırlanır.
type Tab = { id: number; path: string }
const KEY = 'finanaliz_tabs'
const MAX_TABS = 10

function load(): { tabs: Tab[]; active: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '')
    if (Array.isArray(v.tabs) && v.tabs.length) return v
  } catch { /* yoksay */ }
  return { tabs: [{ id: 1, path: '/' }], active: 1 }
}

export function openInNewTab(path: string) {
  window.dispatchEvent(new CustomEvent('finanaliz:new-tab', { detail: path }))
}

export default function TabBar({ titleOf }: { titleOf: (path: string) => { label: string; icon: string } }) {
  const [state, setState] = useState(load)
  const location = useLocation()
  const nav = useNavigate()
  const save = (s: { tabs: Tab[]; active: number }) => { setState(s); try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* yoksay */ } }

  // Sayfa değiştikçe etkin sekmenin adresini güncelle
  useEffect(() => {
    const path = location.pathname + location.search
    setState(s => {
      const next = { ...s, tabs: s.tabs.map(t => t.id === s.active ? { ...t, path } : t) }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* yoksay */ }
      return next
    })
  }, [location.pathname, location.search])

  useEffect(() => {
    const h = (e: Event) => add((e as CustomEvent<string>).detail)
    window.addEventListener('finanaliz:new-tab', h)
    return () => window.removeEventListener('finanaliz:new-tab', h)
  })

  const add = (path = '/') => {
    const id = Math.max(0, ...state.tabs.map(t => t.id)) + 1
    const tabs = [...state.tabs, { id, path }].slice(-MAX_TABS)
    save({ tabs, active: id })
    nav(path)
  }
  const select = (t: Tab) => { save({ ...state, active: t.id }); nav(t.path) }
  const close = (t: Tab) => {
    if (state.tabs.length === 1) { save({ tabs: [{ id: t.id, path: '/' }], active: t.id }); nav('/'); return }
    const i = state.tabs.findIndex(x => x.id === t.id)
    const tabs = state.tabs.filter(x => x.id !== t.id)
    if (t.id === state.active) {
      const n = tabs[Math.max(0, i - 1)]
      save({ tabs, active: n.id }); nav(n.path)
    } else save({ ...state, tabs })
  }

  return (
    <div className="tabbar">
      {state.tabs.map(t => {
        const info = titleOf(t.path)
        const sym = new URLSearchParams(t.path.split('?')[1] ?? '').get('s')
        return (
          <div key={t.id} className={`tab ${t.id === state.active ? 'active' : ''}`} onClick={() => select(t)} onAuxClick={e => { if (e.button === 1) close(t) }} title={info.label}>
            <span>{info.icon}</span><span className="tab-label">{info.label}{sym ? ` · ${sym.replace('.IS', '')}` : ''}</span>
            <button className="tab-x" onClick={e => { e.stopPropagation(); close(t) }} title="Sekmeyi kapat">×</button>
          </div>
        )
      })}
      <button className="tab-add" onClick={() => add('/')} title="Yeni sekme (menüde orta tıklama veya Ctrl+tıklama da yeni sekmede açar)">＋</button>
    </div>
  )
}
