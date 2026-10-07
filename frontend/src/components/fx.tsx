// Görsel efektler: sayarak artan sayılar, konfeti, bildirim sesi, piyasa saati, karşılama ekranı ve giriş arka planı
import { useEffect, useRef, useState } from 'react'
import { fmtMoney } from '../api'

/* ------------------------------------------------------------------ Tercihler */
const PREF = 'finanaliz_prefs'
export type Prefs = { accent: string; sound: boolean; confetti: boolean; animations: boolean; sidebarCollapsed: boolean }
const DEFAULT_PREFS: Prefs = { accent: 'blue', sound: false, confetti: true, animations: true, sidebarCollapsed: false }

export function getPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF) || '{}') } } catch { return DEFAULT_PREFS }
}
export function setPrefs(p: Partial<Prefs>) {
  const next = { ...getPrefs(), ...p }
  try { localStorage.setItem(PREF, JSON.stringify(next)) } catch { /* yoksay */ }
  applyPrefs(next)
  window.dispatchEvent(new Event('finanaliz:prefs'))
}
export function usePrefs(): Prefs {
  const [p, setP] = useState(getPrefs())
  useEffect(() => {
    const h = () => setP(getPrefs())
    window.addEventListener('finanaliz:prefs', h)
    return () => window.removeEventListener('finanaliz:prefs', h)
  }, [])
  return p
}

export const ACCENTS: Record<string, { name: string; color: string; dark: string }> = {
  blue: { name: 'Mavi', color: '#4c8dff', dark: '#3a74db' },
  purple: { name: 'Mor', color: '#8b5cf6', dark: '#7046e0' },
  green: { name: 'Yeşil', color: '#10b981', dark: '#0d9668' },
  orange: { name: 'Turuncu', color: '#f59e0b', dark: '#d48606' },
  pink: { name: 'Pembe', color: '#ec4899', dark: '#cc2f7d' },
  teal: { name: 'Turkuaz', color: '#14b8c4', dark: '#0f97a1' },
}

export function applyPrefs(p: Prefs = getPrefs()) {
  const a = ACCENTS[p.accent] ?? ACCENTS.blue
  const root = document.documentElement
  root.style.setProperty('--accent', a.color)
  root.style.setProperty('--accent-2', a.dark)
  root.dataset.anim = p.animations ? 'on' : 'off'
}

/* ------------------------------------------------------------------ Sayarak artan sayı */
export function useCountUp(target: number | null | undefined, duration = 900) {
  const [v, setV] = useState(target ?? 0)
  const from = useRef(target ?? 0)
  useEffect(() => {
    if (target == null) return
    // Animasyon kapalıysa veya pencere görünmüyorsa (animasyon kareleri çalışmaz) doğrudan son değeri göster
    if (document.documentElement.dataset.anim === 'off' || document.hidden) { setV(target); from.current = target; return }
    const start = performance.now(), a = from.current, b = target
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration)
      const e = 1 - Math.pow(1 - k, 3)
      setV(a + (b - a) * e)
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b
    }
    raf = requestAnimationFrame(step)
    const guard = setTimeout(() => { setV(b); from.current = b }, duration + 300) // kareler duraklarsa yine de son değere ulaş
    return () => { cancelAnimationFrame(raf); clearTimeout(guard) }
  }, [target, duration])
  return v
}

export function CountMoney({ value, currency = 'TRY' }: { value: number | null | undefined; currency?: string }) {
  const v = useCountUp(value)
  return <>{value == null ? '—' : fmtMoney(v, currency)}</>
}

/* ------------------------------------------------------------------ Konfeti */
export function confetti(count = 140) {
  if (!getPrefs().confetti || document.documentElement.dataset.anim === 'off') return
  const canvas = document.createElement('canvas')
  canvas.className = 'confetti-canvas'
  canvas.width = window.innerWidth; canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  const colors = ['#4c8dff', '#26a69a', '#f5c542', '#ef5350', '#a66cff', '#ff9f43', '#ec4899']
  const parts = Array.from({ length: count }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200, y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, s: 4 + Math.random() * 6,
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
  }))
  const t0 = performance.now()
  const frame = (t: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c
      ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 3200); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore()
    }
    if (t - t0 < 3200) requestAnimationFrame(frame); else canvas.remove()
  }
  requestAnimationFrame(frame)
}

/* ------------------------------------------------------------------ Bildirim sesi */
let audioCtx: AudioContext | null = null
export function chime(kind: 'good' | 'bad' | 'info' = 'info') {
  if (!getPrefs().sound) return
  try {
    audioCtx ??= new AudioContext()
    const notes = kind === 'good' ? [660, 880] : kind === 'bad' ? [520, 390] : [740]
    notes.forEach((f, i) => {
      const o = audioCtx!.createOscillator(), g = audioCtx!.createGain()
      o.type = 'sine'; o.frequency.value = f
      const t = audioCtx!.currentTime + i * 0.13
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.connect(g).connect(audioCtx!.destination); o.start(t); o.stop(t + 0.4)
    })
  } catch { /* yoksay */ }
}

/* ------------------------------------------------------------------ Piyasa saati */
function zoned(tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '0'
  return { day: g('weekday'), sec: +g('hour') * 3600 + +g('minute') * 60 + +g('second') }
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function session(tz: string, open: number, close: number) {
  const { day, sec } = zoned(tz)
  const d = DAYS.indexOf(day)
  const weekday = d >= 1 && d <= 5
  if (weekday && sec >= open && sec < close) return { open: true, left: close - sec }
  // bir sonraki açılışa kalan süre
  let add = 0, dd = d
  if (weekday && sec < open) return { open: false, left: open - sec }
  add = 86400 - sec; dd = (d + 1) % 7
  while (dd === 0 || dd === 6) { add += 86400; dd = (dd + 1) % 7 }
  return { open: false, left: add + open }
}
const fmtLeft = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h >= 24 ? `${Math.floor(h / 24)}g ${h % 24}sa` : h ? `${h}sa ${m}dk` : `${m}dk` }

export function MarketClock() {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(id) }, [])
  const items = [
    { name: 'BIST', ...session('Europe/Istanbul', 10 * 3600, 18 * 3600 + 600) },
    { name: 'NYSE', ...session('America/New_York', 9 * 3600 + 1800, 16 * 3600) },
  ]
  const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mclock" title="Seans durumları (resmî tatiller hariç)">
      <span className="mono strong">{now}</span>
      {items.map(i => (
        <span key={i.name} className={`mclock-item ${i.open ? 'on' : ''}`}>
          <span className="status-dot" />{i.name} {i.open ? `kapanışa ${fmtLeft(i.left)}` : `açılışa ${fmtLeft(i.left)}`}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Giriş arka planı (akan mum grafiği + parçacık ağı) */
export function LoginBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    let w = 0, h = 0, raf = 0
    const resize = () => { w = c.width = window.innerWidth; h = c.height = window.innerHeight }
    resize(); window.addEventListener('resize', resize)
    const pts = Array.from({ length: 60 }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35 }))
    // rastgele yürüyüşle sonsuz mum grafiği
    const candles: { o: number; c: number; hi: number; lo: number }[] = []
    let price = 100
    const addCandle = () => {
      const o = price, ch = (Math.random() - 0.47) * 4
      price = Math.max(60, Math.min(140, o + ch))
      candles.push({ o, c: price, hi: Math.max(o, price) + Math.random() * 1.6, lo: Math.min(o, price) - Math.random() * 1.6 })
      if (candles.length > 140) candles.shift()
    }
    for (let i = 0; i < 120; i++) addCandle()
    let offset = 0, last = performance.now()
    const draw = (t: number) => {
      const dt = t - last; last = t
      ctx.clearRect(0, 0, w, h)
      // parçacık ağı
      for (const p of pts) { p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1 }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy)
        if (d < 150) { ctx.strokeStyle = `rgba(76,141,255,${0.12 * (1 - d / 150)})`; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke() }
      }
      for (const p of pts) { ctx.fillStyle = 'rgba(76,141,255,0.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill() }
      // mum grafiği (alt bölümde, sağdan sola akar)
      offset += dt * 0.025
      if (offset >= 12) { offset -= 12; addCandle() }
      // Görünen mumların en düşük/en yüksek değerine göre ekranın alt %30'luk bandına ölçekle
      const lo = Math.min(...candles.map(k => k.lo)), hi = Math.max(...candles.map(k => k.hi))
      const top = h * 0.6, bottom = h * 0.95, Y = (v: number) => bottom - (v - lo) / (hi - lo || 1) * (bottom - top)
      candles.forEach((k, i) => {
        const x = w - (candles.length - i) * 12 - offset + 12
        if (x < -12) return
        const up = k.c >= k.o
        ctx.strokeStyle = ctx.fillStyle = up ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)'
        ctx.beginPath(); ctx.moveTo(x + 4, Y(k.hi)); ctx.lineTo(x + 4, Y(k.lo)); ctx.stroke()
        const y1 = Y(Math.max(k.o, k.c)), hh = Math.max(Y(Math.min(k.o, k.c)) - y1, 1.5)
        ctx.fillRect(x, y1, 8, hh)
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="login-canvas" />
}

/** Yazılarak beliren metin. */
export function Typewriter({ texts, speed = 45 }: { texts: string[]; speed?: number }) {
  const [i, setI] = useState(0)
  const [n, setN] = useState(0)
  useEffect(() => {
    const full = texts[i]
    if (n < full.length) { const id = setTimeout(() => setN(n + 1), speed); return () => clearTimeout(id) }
    const id = setTimeout(() => { setI((i + 1) % texts.length); setN(0) }, 2200)
    return () => clearTimeout(id)
  }, [n, i, texts, speed])
  return <span className="typewriter">{texts[i].slice(0, n)}<span className="caret">|</span></span>
}

/* ------------------------------------------------------------------ Karşılama ekranı */
export function Welcome({ user, equity, pnlPct, onDone }: { user: string; equity: number | null | undefined; pnlPct: number | null | undefined; onDone: () => void }) {
  const v = useCountUp(equity ?? 0, 1400)
  const [closing, setClosing] = useState(false)
  const close = () => { setClosing(true); setTimeout(onDone, 450) }
  // Veri gelince 2,2 sn gösterilir; veri gecikirse en fazla 6 sn beklenir
  useEffect(() => { const id = setTimeout(close, equity != null ? 2200 : 6000); return () => clearTimeout(id) }, [equity != null])
  const hour = new Date().getHours()
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'
  return (
    <div className={`welcome ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="welcome-inner">
        <div className="welcome-logo">◆</div>
        <h1>{greet}, {user}!</h1>
        <div className="muted">Toplam varlığınız</div>
        {equity != null ? <div className="welcome-value">{fmtMoney(v, 'TRY')}</div> : <div className="sk-line welcome-sk" />}
        {pnlPct != null && <div className={pnlPct >= 0 ? 'up' : 'down'}>{pnlPct >= 0 ? '▲' : '▼'} %{Math.abs(pnlPct).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} toplam getiri</div>}
        <div className="muted small mt">Devam etmek için tıklayın</div>
      </div>
    </div>
  )
}
