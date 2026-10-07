import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, session } from './api'
import { hydratePrefs } from './prefs'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Market from './pages/Market'
import Screener from './pages/Screener'
import News from './pages/News'
import Calendar from './pages/Calendar'
import Bulletin from './pages/Bulletin'
import Kap from './pages/Kap'
import Fundamentals from './pages/Fundamentals'
import Dividends from './pages/Dividends'
import ProfilePage from './pages/Profile'
import MultiChart from './pages/MultiChart'
import Bots from './pages/Bots'
import Achievements from './pages/Achievements'
import Lab from './pages/Lab'
import Sectors from './pages/Sectors'
import Academy from './pages/Academy'
import Game from './pages/Game'
import TimeTravel from './pages/TimeTravel'
import Widget from './pages/Widget'
import TabBar, { openInNewTab } from './components/Tabs'
import { REFRESH_OPTIONS, setRefreshSec, useRefreshSec } from './refresh'
import QuickSearch from './components/QuickSearch'
import { NotificationBell, ShortcutHelp, Splash, TickerTape, Tour, useShortcuts } from './components/ui'
import { applyTheme, getTheme, type Theme } from './theme'
import { applyPrefs, chime, confetti, MarketClock, setPrefs, usePrefs, Welcome } from './components/fx'
import Analysis from './pages/Analysis'
import Prediction from './pages/Prediction'
import Backtest from './pages/Backtest'
import Compare from './pages/Compare'
import Portfolio from './pages/Portfolio'
import Watchlist from './pages/Watchlist'
import Settings from './pages/Settings'

const NAV = [
  { group: 'Piyasalar' },
  { to: '/', label: 'Piyasa Özeti', icon: '◧' },
  { to: '/bulten', label: 'Günün Bülteni', icon: '📝' },
  { to: '/piyasa/bist', label: 'Borsa İstanbul', icon: '🏛' },
  { to: '/piyasa/abd', label: 'ABD Borsaları', icon: '🗽' },
  { to: '/piyasa/doviz', label: 'Döviz & Emtia', icon: '💱' },
  { to: '/piyasa/kripto', label: 'Kripto Paralar', icon: '₿' },
  { to: '/temettu', label: 'Temettü', icon: '💰' },
  { to: '/kap', label: 'KAP Bildirimleri', icon: '📢' },
  { to: '/haberler', label: 'Haberler', icon: '📰' },
  { to: '/takvim', label: 'Ekonomik Takvim', icon: '📅' },
  { group: 'Analiz' },
  { to: '/analiz', label: 'Teknik Analiz', icon: '📈' },
  { to: '/coklu-grafik', label: 'Çoklu Grafik', icon: '▦' },
  { to: '/tarama', label: 'Teknik Tarama', icon: '🔍' },
  { to: '/temel', label: 'Temel Analiz', icon: '🏢' },
  { to: '/tahmin', label: 'YZ Tahmin', icon: '🤖' },
  { to: '/karsilastir', label: 'Karşılaştırma', icon: '⇄' },
  { to: '/backtest', label: 'Strateji Testi', icon: '⏱' },
  { to: '/laboratuvar', label: 'Portföy Laboratuvarı', icon: '🧪' },
  { to: '/sektor-rotasyonu', label: 'Sektör Rotasyonu', icon: '🔄' },
  { to: '/zaman-makinesi', label: 'Geçmişe Yolculuk', icon: '⏳' },
  { group: 'Öğren & Eğlen' },
  { to: '/akademi', label: 'Yatırım Akademisi', icon: '🎓' },
  { to: '/tahmin-oyunu', label: 'Tahmin Oyunu', icon: '🎯' },
  { group: 'Hesabım' },
  { to: '/portfoy', label: 'Portföy', icon: '💼' },
  { to: '/botlar', label: 'Strateji Botları', icon: '⚙️' },
  { to: '/izleme', label: 'İzleme & Alarmlar', icon: '🔔' },
  { to: '/basarilar', label: 'Başarılar & Karne', icon: '🏅' },
  { to: '/profil', label: 'Profilim', icon: '👤' },
  { to: '/ayarlar', label: 'Ayarlar', icon: '⚙' },
]

type Toast = { id: number; title: string; body?: string }

const EXTRA_TITLES: Record<string, { label: string; icon: string }> = { '/widget': { label: 'Mini', icon: '📌' } }
function titleOf(path: string) {
  const p = path.split('?')[0]
  const hit = NAV.filter(n => n.to && (n.to === p || (n.to !== '/' && p.startsWith(n.to)))).sort((a, b) => b.to!.length - a.to!.length)[0]
  return hit ? { label: hit.label!, icon: hit.icon! } : EXTRA_TITLES[p] ?? { label: 'Sayfa', icon: '📄' }
}

function Shell({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const prefs = usePrefs()
  const [welcome, setWelcome] = useState<{ equity: number | null; pnl: number | null }>({ equity: null, pnl: null })
  useEffect(() => {
    // Açılışta karşılama ekranı: toplam varlık sayarak gösterilir
    api<{ equity_try: number; total_pnl_pct: number | null }>('/account')
      .then(a => setWelcome({ equity: a.equity_try, pnl: a.total_pnl_pct }))
      .catch(() => {})
  }, [])
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [help, setHelp] = useState(false)
  const tourKey = `finanaliz_tour_${user}`
  const [tour, setTour] = useState(() => { try { return !localStorage.getItem(tourKey) } catch { return false } })
  const refreshSec = useRefreshSec()
  const location = useLocation()
  const [mobileNav, setMobileNav] = useState(false)
  useEffect(() => { setMobileNav(false) }, [location.pathname])
  const toggleTheme = useCallback(() => setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; applyTheme(n); return n }), [])
  const actions = useMemo(() => ({ toggleTheme, openHelp: () => setHelp(true) }), [toggleTheme])
  useShortcuts(actions)

  // Masaüstü uygulamasında bildirimleri Windows bildirimleri gösterir; tarayıcı bildirimi yalnızca web sürümünde kullanılır
  const [nativeNotify, setNativeNotify] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    api<{ notify?: boolean }>('/desktop/available').then(d => {
      setNativeNotify(!!d.notify)
      if (!d.notify) try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch { /* yoksay */ }
    }).catch(() => {})
    const go = (e: Event) => { const to = (e as CustomEvent<string>).detail; if (to) navigate(to) }
    window.addEventListener('finanaliz:navigate', go)
    return () => window.removeEventListener('finanaliz:navigate', go)
  }, [])

  const onNew = (items: { id: number; kind?: string; title: string; body: string }[]) => {
    if (items.some(n => n.kind === 'badge' || (n.kind === 'order' && n.title.includes('Kâr al')))) confetti()
    if (items.length) chime(items.some(n => n.title.includes('reddedildi') || n.title.includes('yapamadı')) ? 'bad' : items.some(n => n.kind === 'order' || n.kind === 'bot' || n.kind === 'badge') ? 'good' : 'info')
    for (const n of items.slice(-4)) {
      setToasts(t => [...t, { id: n.id, title: n.title, body: n.body }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== n.id)), 10000)
      try { if (!nativeNotify && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body }) } catch { /* yoksay */ }
    }
  }
  const closeTour = () => { setTour(false); try { localStorage.setItem(tourKey, '1') } catch { /* yoksay */ } }

  return (
    <>
      <div className={`layout ${prefs.sidebarCollapsed ? 'collapsed' : ''} ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="mobile-backdrop" onClick={() => setMobileNav(false)} />
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">◆</span><span className="brand-text">FinAnaliz<small>YZ Destekli Finansal Analiz</small></span>
            <button className="collapse-btn" onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })} title={prefs.sidebarCollapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}>{prefs.sidebarCollapsed ? '»' : '«'}</button>
          </div>
          <button className="btn ghost search-trigger" onClick={() => window.dispatchEvent(new Event('finanaliz:search'))}>
            <span>🔍 Hızlı ara</span><kbd>Ctrl K</kbd>
          </button>
          <nav>
            {NAV.map(n => n.group ? <div key={n.group} className="nav-group">{n.group}</div> : (
              <NavLink key={n.to} to={n.to!} end={n.to === '/'} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} title={`${n.label} (orta tıklama: yeni sekme)`}
                onClick={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); openInNewTab(n.to!) } }}
                onAuxClick={e => { if (e.button === 1) { e.preventDefault(); openInNewTab(n.to!) } }}>
                <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <label className="refresh-ctl" title="Fiyatların otomatik yenilenme aralığı">
            <span>⟳ Otomatik yenileme</span>
            <select value={refreshSec} onChange={e => setRefreshSec(+e.target.value)}>
              {REFRESH_OPTIONS.map(o => <option key={o.sec} value={o.sec}>{o.label}</option>)}
            </select>
          </label>
          <div className="side-actions">
            <button className="btn ghost small" onClick={toggleTheme} title="Tema değiştir (T)">{theme === 'dark' ? '☀ Açık tema' : '🌙 Koyu tema'}</button>
            <button className="btn ghost small" onClick={() => setHelp(true)} title="Klavye kısayolları (?)">⌨ Kısayollar</button>
          </div>
          <div className="user-box">
            <NavLink to="/profil" className="user-link"><div className="muted small">Kullanıcı</div><strong>{user}</strong></NavLink>
            <button className="btn ghost small" onClick={onLogout}>Çıkış</button>
          </div>
        </aside>
        <div className="main-col">
          <div className="topbar">
            <button className="hamburger" onClick={() => setMobileNav(!mobileNav)} title="Menü">☰</button>
            <TickerTape />
            <MarketClock />
            <button className="btn ghost small" title="Her zaman üstte duran mini fiyat penceresi" onClick={() => api('/desktop/widget', { method: 'POST' }).catch(() => window.open('/widget', 'finanaliz-mini', 'width=330,height=460'))}>📌 Mini</button>
            <NotificationBell onNew={onNew} />
          </div>
          <TabBar titleOf={titleOf} />
          <main className="content">
            <div key={location.pathname} className="page-anim">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/piyasa/bist" element={<Market key="bist" market="bist" />} />
                <Route path="/piyasa/abd" element={<Market key="us" market="us" />} />
                <Route path="/piyasa/doviz" element={<Market key="fx" market="fx" />} />
                <Route path="/piyasa/kripto" element={<Market key="crypto" market="crypto" />} />
                <Route path="/bulten" element={<Bulletin />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="/temettu" element={<Dividends />} />
                <Route path="/kap" element={<Kap />} />
                <Route path="/temel" element={<Fundamentals />} />
                <Route path="/tarama" element={<Screener />} />
                <Route path="/haberler" element={<News />} />
                <Route path="/takvim" element={<Calendar />} />
                <Route path="/analiz" element={<Analysis />} />
                <Route path="/coklu-grafik" element={<MultiChart />} />
                <Route path="/tahmin" element={<Prediction />} />
                <Route path="/asistan" element={<Navigate to="/analiz" replace />} />
                <Route path="/karsilastir" element={<Compare />} />
                <Route path="/backtest" element={<Backtest />} />
                <Route path="/laboratuvar" element={<Lab />} />
                <Route path="/kafa-kafaya" element={<Navigate to="/karsilastir" replace />} />
                <Route path="/sektor-rotasyonu" element={<Sectors />} />
                <Route path="/zaman-makinesi" element={<TimeTravel />} />
                <Route path="/akademi" element={<Academy />} />
                <Route path="/tahmin-oyunu" element={<Game />} />
                <Route path="/portfoy" element={<Portfolio />} />
                <Route path="/botlar" element={<Bots />} />
                <Route path="/basarilar" element={<Achievements />} />
                <Route path="/izleme" element={<Watchlist />} />
                <Route path="/ayarlar" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
      <QuickSearch />
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {!welcomeDone && <Welcome user={user} equity={welcome.equity} pnlPct={welcome.pnl} onDone={() => setWelcomeDone(true)} />}
      {tour && welcomeDone && <Tour onClose={closeTour} />}
      <div className="toasts">{toasts.map(t => (
        <div key={t.id} className="toast"><div className="strong">{t.title}</div>{t.body && <div className="small muted">{t.body}</div>}</div>
      ))}</div>
    </>
  )
}

export default function App() {
  const [user, setUser] = useState(session.user)
  const [ready, setReady] = useState(false)
  const [hydrated, setHydrated] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    // Kayıtlı arayüz tercihleri sunucudan yüklenmeden sayfalar açılmaz (aksi halde varsayılanlarla başlarlardı)
    let alive = true
    hydratePrefs().then(() => {
      if (!alive) return
      applyTheme(getTheme()); applyPrefs()
      setHydrated(user)
    })
    return () => { alive = false }
  }, [user])

  useEffect(() => {
    const out = () => setUser(null)
    window.addEventListener('finanaliz:logout', out)
    document.getElementById('boot-splash')?.remove()
    const id = setTimeout(() => setReady(true), 900)
    return () => { window.removeEventListener('finanaliz:logout', out); clearTimeout(id) }
  }, [])

  return (
    <>
      <Splash done={ready} />
      {window.location.pathname.startsWith('/widget') ? <Widget /> : !user ? <Login onLogin={(t, u) => { session.set(t, u); setUser(u) }} /> : hydrated !== user ? null : (
        <BrowserRouter>
          <Shell user={user} onLogout={() => { session.clear(); setUser(null) }} />
        </BrowserRouter>
      )}
    </>
  )
}
