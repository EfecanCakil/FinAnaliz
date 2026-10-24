import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, session } from './api'
import { hydratePrefs } from './prefs'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Widget from './pages/Widget'
import TabBar, { openInNewTab } from './components/Tabs'
import { sectionOf, visiblePages, visibleSections, type Section } from './nav'
import StockCard from './components/StockCard'
import GuestUpgrade from './components/GuestUpgrade'
import { Modal } from './components/ui'
import { REFRESH_OPTIONS, setRefreshSec, useRefreshSec } from './refresh'
import QuickSearch from './components/QuickSearch'
import { DataStatusBanner, NotificationBell, ShortcutHelp, Splash, TickerTape, Tour, useShortcuts } from './components/ui'
import { applyTheme, getTheme, type Theme } from './theme'
import { applyPrefs, chime, confetti, MarketClock, setPrefs, useMicroFx, usePrefs, Welcome } from './components/fx'
import { LogoMark, Wordmark } from './components/Logo'
import { Loading } from './components/common'

// Sayfalar ihtiyaç anında yüklenir (uygulama açılışı hızlanır)
const Market = lazy(() => import('./pages/Market'))
const Screener = lazy(() => import('./pages/Screener'))
const News = lazy(() => import('./pages/News'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Bulletin = lazy(() => import('./pages/Bulletin'))
const Kap = lazy(() => import('./pages/Kap'))
const Fundamentals = lazy(() => import('./pages/Fundamentals'))
const Dividends = lazy(() => import('./pages/Dividends'))
const ProfilePage = lazy(() => import('./pages/Profile'))
const MultiChart = lazy(() => import('./pages/MultiChart'))
const Bots = lazy(() => import('./pages/Bots'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Lab = lazy(() => import('./pages/Lab'))
const Goals = lazy(() => import('./pages/Goals'))
const Portfolios = lazy(() => import('./pages/Portfolios'))
const Sectors = lazy(() => import('./pages/Sectors'))
const Academy = lazy(() => import('./pages/Academy'))
const Game = lazy(() => import('./pages/Game'))
const TimeTravel = lazy(() => import('./pages/TimeTravel'))
const Heatmap = lazy(() => import('./pages/Heatmap'))
const IpoPage = lazy(() => import('./pages/Ipo'))
const Analysis = lazy(() => import('./pages/Analysis'))
const Prediction = lazy(() => import('./pages/Prediction'))
const Backtest = lazy(() => import('./pages/Backtest'))
const Compare = lazy(() => import('./pages/Compare'))
const Portfolio = lazy(() => import('./pages/Portfolio'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Settings = lazy(() => import('./pages/Settings'))


type Toast = { id: number; title: string; body?: string }

const EXTRA_TITLES: Record<string, { label: string; icon: string }> = { '/widget': { label: 'Mini', icon: '📌' } }
function titleOf(path: string) {
  const p = path.split('?')[0]
  const hit = sectionOf(p)
  return hit ? { label: hit.page.label, icon: hit.page.icon } : EXTRA_TITLES[p] ?? { label: 'Sayfa', icon: '📄' }
}

// Bölüm içi sekmeler + "bu sayfa ne işe yarar?" ipucu
function SectionHeader({ advanced, tips }: { advanced: boolean; tips: boolean }) {
  const location = useLocation()
  const cur = sectionOf(location.pathname)
  // Etkin sekmenin altındaki çizgi, sekme değişince yeni sekmeye kayarak geçer
  const tabsRef = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('.section-tab.active')
    setInk(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
  }, [location.pathname, cur?.section.id, advanced])
  if (!cur) return null
  const pages = cur.section.pages.filter(p => advanced || !p.advanced || p.to === cur.page.to)
  return (
    <div className="section-head">
      {pages.length > 1 && (
        <div className="section-tabs" ref={tabsRef}>
          {ink && <span className="tab-ink" style={{ transform: `translateX(${ink.left}px)`, width: ink.width }} />}
          {pages.map(p => (
            <NavLink key={p.to} to={p.to} end className={({ isActive }) => 'section-tab' + (isActive ? ' active' : '')}>
              <span>{p.icon}</span>{p.label}
            </NavLink>
          ))}
        </div>
      )}
      {tips && (
        <div className="page-tip">
          <span>💡 {cur.page.desc}</span>
          <button className="tab-x" title="İpuçlarını gizle (Ayarlar'dan yeniden açılabilir)" onClick={() => setPrefs({ tips: false })}>×</button>
        </div>
      )}
    </div>
  )
}

type Me = { username: string; display_name: string; is_guest: boolean; has_recovery: boolean }

function Shell({ user, onLogout, onRenamed }: { user: string; onLogout: () => void; onRenamed: (u: string) => void }) {
  const [me, setMe] = useState<Me | null>(null)
  const [upgrade, setUpgrade] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  useEffect(() => {
    const load = () => api<Me>('/auth/me').then(setMe).catch(() => {})
    load()
    const open = () => setUpgrade(true)
    window.addEventListener('finanaliz:me-changed', load)
    window.addEventListener('finanaliz:upgrade', open)
    return () => { window.removeEventListener('finanaliz:me-changed', load); window.removeEventListener('finanaliz:upgrade', open) }
  }, [user])
  const logout = () => { if (me?.is_guest) setConfirmOut(true); else onLogout() }
  const guestLeave = async () => {
    try { await api('/auth/delete-account', { body: {} }) } catch { /* yoksay */ }
    setConfirmOut(false); onLogout()
  }
  const [toasts, setToasts] = useState<Toast[]>([])
  const prefs = usePrefs()
  const [welcome, setWelcome] = useState<{ equity: number | null; pnl: number | null }>({ equity: null, pnl: null })
  useEffect(() => {
    // Açılışta karşılama ekranı: toplam varlık sayarak gösterilir
    api<{ equity_try: number; total_pnl_pct: number | null }>('/account')
      .then(a => setWelcome({ equity: a.equity_try, pnl: a.total_pnl_pct }))
      .catch(() => {})
  }, [])
  const [welcomeDone, setWelcomeDone] = useState(() => {  // portföy değiştirirken yapılan yenilemede karşılama atlanır
    try { const skip = sessionStorage.getItem('tm_skip_welcome') === '1'; sessionStorage.removeItem('tm_skip_welcome'); return skip } catch { return false }
  })
  // Karşılama kapanınca menü, üst bant ve içerik sırayla kayarak belirir (yalnızca ilk açılışta)
  const [entered, setEntered] = useState(false)
  useEffect(() => { if (welcomeDone) { const id = setTimeout(() => setEntered(true), 1400); return () => clearTimeout(id) } }, [welcomeDone])
  useMicroFx()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [help, setHelp] = useState(false)
  const tourKey = `finanaliz_tour_${user}`
  const [tour, setTour] = useState(() => { try { return !localStorage.getItem(tourKey) } catch { return false } })
  const refreshSec = useRefreshSec()
  const location = useLocation()
  const [mobileNav, setMobileNav] = useState(false)
  useEffect(() => { setMobileNav(false) }, [location.pathname])
  // Her bölümde en son açılan sekme hatırlanır; menüden bölüme dönünce oraya gidilir
  const current = sectionOf(location.pathname)
  const [lastIn, setLastIn] = useState<Record<string, string>>({})
  useEffect(() => { if (current) setLastIn(l => ({ ...l, [current.section.id]: location.pathname + location.search })) }, [location.pathname, location.search])
  const sectionLink = (sec: Section) => {
    const pages = visiblePages(sec, prefs.advanced)
    const last = lastIn[sec.id]
    return last && pages.some(p => last.split('?')[0] === p.to) ? last : pages[0].to
  }
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
      <div className={`layout ${prefs.sidebarCollapsed ? 'collapsed' : ''} ${mobileNav ? 'mobile-open' : ''} ${!welcomeDone ? 'pre-enter' : entered ? '' : 'app-enter'}`}>
        <div className="mobile-backdrop" onClick={() => setMobileNav(false)} />
        <aside className="sidebar">
          <div className="brand">
            <LogoMark size={34} className="logo" /><span className="brand-text"><Wordmark /><small>YZ destekli piyasa analizi</small></span>
            <button className="collapse-btn" onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })} title={prefs.sidebarCollapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}>{prefs.sidebarCollapsed ? '»' : '«'}</button>
          </div>
          <button className="btn ghost search-trigger" onClick={() => window.dispatchEvent(new Event('finanaliz:search'))}>
            <span>🔍 Hızlı ara</span><kbd>Ctrl K</kbd>
          </button>
          <nav>
            {visibleSections(prefs.advanced).filter(s => !s.bottom).map(sec => {
              const to = sectionLink(sec)
              return (
                <Link key={sec.id} to={to} className={'nav-item' + (current?.section.id === sec.id ? ' active' : '')}
                  title={`${sec.label}: ${visiblePages(sec, prefs.advanced).map(p => p.label).join(', ')} (orta tıklama: yeni sekme)`}
                  onClick={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); openInNewTab(to) } }}
                  onAuxClick={e => { if (e.button === 1) { e.preventDefault(); openInNewTab(to) } }}>
                  <span className="nav-icon">{sec.icon}</span><span className="nav-label">{sec.label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="mode-switch" title="Basit mod yalnızca temel sayfaları gösterir; Gelişmiş mod botlar, strateji testi ve laboratuvar gibi araçları da ekler.">
            <button className={!prefs.advanced ? 'active' : ''} onClick={() => setPrefs({ advanced: false })}>Basit</button>
            <button className={prefs.advanced ? 'active' : ''} onClick={() => setPrefs({ advanced: true })}>Gelişmiş</button>
          </div>
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
            <NavLink to="/profil" className="user-link"><div className="muted small">{me?.is_guest ? 'Misafir' : 'Kullanıcı'}</div><strong>{me?.display_name ?? user}</strong></NavLink>
            <button className="btn ghost small" onClick={logout}>Çıkış</button>
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
          <DataStatusBanner />
          {me?.is_guest && (
            <div className="guest-banner">
              <span>👤 <b>Misafir olarak kullanıyorsunuz.</b> Verileriniz 7 gün kullanılmazsa silinir; kalıcı olması için hesap oluşturun.</span>
              <button className="btn primary small" onClick={() => setUpgrade(true)}>Ücretsiz hesap oluştur</button>
            </div>
          )}
          {me && !me.is_guest && !me.has_recovery && !location.pathname.startsWith('/profil') && (
            <div className="guest-banner">
              <span>🔑 <b>Hesabınız için henüz kurtarma kodu yok.</b> Şifrenizi unutursanız hesabınıza tekrar girebilmek için bir kod oluşturun.</span>
              <Link className="btn primary small" to="/profil">Kurtarma kodu oluştur</Link>
            </div>
          )}
          <TabBar titleOf={titleOf} />
          <main className="content">
            <SectionHeader advanced={prefs.advanced} tips={prefs.tips} />
            <div key={location.pathname} className="page-anim">
              <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<div className="page"><Loading text="Sayfa yükleniyor…" /></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/piyasa/bist" element={<Market key="bist" market="bist" />} />
                <Route path="/piyasa/abd" element={<Market key="us" market="us" />} />
                <Route path="/piyasa/doviz" element={<Market key="fx" market="fx" />} />
                <Route path="/piyasa/kripto" element={<Market key="crypto" market="crypto" />} />
                <Route path="/piyasa/harita" element={<Heatmap />} />
                <Route path="/bulten" element={<Bulletin />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="/temettu" element={<Dividends />} />
                <Route path="/halka-arz" element={<IpoPage />} />
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
                <Route path="/hedefler" element={<Goals />} />
                <Route path="/portfoyler" element={<Portfolios />} />
                <Route path="/botlar" element={<Bots />} />
                <Route path="/basarilar" element={<Achievements />} />
                <Route path="/izleme" element={<Watchlist />} />
                <Route path="/ayarlar" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      {upgrade && <GuestUpgrade onClose={() => setUpgrade(false)} onDone={u => { setUpgrade(false); onRenamed(u); window.dispatchEvent(new Event('finanaliz:me-changed')) }} />}
      {confirmOut && (
        <Modal title="Misafir oturumundan çık" onClose={() => setConfirmOut(false)}>
          <p>Misafir hesabından çıkarsanız bu oturumdaki <b>portföyünüz, favorileriniz ve alarmlarınız silinir</b>. Saklamak için önce ücretsiz hesap oluşturabilirsiniz.</p>
          <div className="row gap wrap mt">
            <button className="btn primary" onClick={() => { setConfirmOut(false); setUpgrade(true) }}>Hesap oluştur ve verileri sakla</button>
            <button className="btn ghost danger" onClick={guestLeave}>Verileri sil ve çık</button>
            <button className="btn ghost" onClick={() => setConfirmOut(false)}>Vazgeç</button>
          </div>
        </Modal>
      )}
      <QuickSearch />
      <StockCard />
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {!welcomeDone && <Welcome user={(me?.display_name ?? user).split(' ')[0]} guest={!!me?.is_guest} equity={welcome.equity} pnlPct={welcome.pnl} onDone={() => setWelcomeDone(true)} />}
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
    const id = setTimeout(() => setReady(true), document.documentElement.dataset.anim === 'off' ? 200 : 1700)  // açılış animasyonu tamamlansın
    return () => { window.removeEventListener('finanaliz:logout', out); clearTimeout(id) }
  }, [])

  return (
    <>
      <Splash done={ready} />
      {window.location.pathname.startsWith('/widget') ? <Widget /> : !user ? <Login onLogin={(r, remember) => { session.set(r.token, r.username, remember); setUser(r.username) }} /> : hydrated !== user ? null : (
        <BrowserRouter>
          <Shell user={user} onLogout={() => { session.clear(); setUser(null) }} onRenamed={u => { setHydrated(u); setUser(u) }} />
        </BrowserRouter>
      )}
    </>
  )
}
