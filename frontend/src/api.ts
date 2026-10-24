// Yerel REST API ile iletişim ve ortak biçimlendirme yardımcıları.
import { friendlyMessage } from './errors'

export type Point = { time: number; value: number }
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Quote = {
  symbol: string; name: string; market: string; currency: string; sector?: string | null; is_index?: boolean
  price: number | null; change: number | null; change_pct: number | null
  change_1w?: number | null; change_1m?: number | null; change_ytd?: number | null; change_1y?: number | null
  high_52w?: number | null; low_52w?: number | null; volume?: number | null; volume_avg?: number | null
  spark: number[]
}

/** Büyük tutarları kısaltır: 1,2 Mr, 350 Mn … */
export function fmtBig(v: number | null | undefined, ccy = '') {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  const f = (x: number, s: string) => `${x.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${s}${ccy ? ' ' + ccy : ''}`
  return a >= 1e12 ? f(v / 1e12, 'Tr') : a >= 1e9 ? f(v / 1e9, 'Mr') : a >= 1e6 ? f(v / 1e6, 'Mn') : f(v, '')
}

export function fmtVolume(v: number | null | undefined) {
  if (!v) return '—'
  const a = Math.abs(v)
  const f = (x: number, s: string) => `${x.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${s}`
  return a >= 1e9 ? f(v / 1e9, 'Mr') : a >= 1e6 ? f(v / 1e6, 'Mn') : a >= 1e3 ? f(v / 1e3, 'B') : v.toLocaleString('tr-TR')
}

/** Piyasanın şu an açık olup olmadığını (resmî tatiller hariç) yerel saat dilimine göre hesaplar. */
export function marketStatus(market: string): { open: boolean; label: string } {
  const parts = (tz: string) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())
    const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
    return { day: get('weekday'), min: +get('hour') * 60 + +get('minute') }
  }
  const weekday = (d: string) => !['Sat', 'Sun'].includes(d)
  if (market === 'crypto') return { open: true, label: '7/24 açık' }
  if (market === 'bist') {
    const { day, min } = parts('Europe/Istanbul')
    const open = weekday(day) && min >= 600 && min < 1090
    return { open, label: open ? 'Seans açık · 10:00–18:10' : 'Seans kapalı · 10:00–18:10' }
  }
  if (market === 'us') {
    const { day, min } = parts('America/New_York')
    const open = weekday(day) && min >= 570 && min < 960
    return { open, label: open ? 'Seans açık · NY 09:30–16:00' : 'Seans kapalı · NY 09:30–16:00' }
  }
  const { day, min } = parts('America/New_York')
  const open = !(day === 'Sat' || (day === 'Sun' && min < 1020) || (day === 'Fri' && min >= 1020))
  return { open, label: open ? 'Döviz piyasası açık (5/24)' : 'Döviz piyasası hafta sonu kapalı' }
}

const TOKEN_KEY = 'finanaliz_token'
const USER_KEY = 'finanaliz_user'

// "Beni hatırla" seçiliyse oturum kalıcı depoda, değilse yalnızca bu pencere açıkken (sessionStorage) tutulur.
const read = (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k) } catch { return null } }
export const session = {
  get token() { return read(TOKEN_KEY) },
  get user() { return read(USER_KEY) },
  get remembered() { try { return localStorage.getItem(TOKEN_KEY) !== null } catch { return true } },
  set(token: string, user: string, remember = true) {
    try {
      const [keep, drop] = remember ? [localStorage, sessionStorage] : [sessionStorage, localStorage]
      keep.setItem(TOKEN_KEY, token); keep.setItem(USER_KEY, user)
      drop.removeItem(TOKEN_KEY); drop.removeItem(USER_KEY)
    } catch { /* yoksay */ }
  },
  /** Şifre değişimi vb. sonrası yenilenen anahtarı aynı depoda günceller. */
  update(token: string, user: string) { this.set(token, user, this.remembered) },
  clear() {
    try { for (const st of [localStorage, sessionStorage]) { st.removeItem(TOKEN_KEY); st.removeItem(USER_KEY) } localStorage.removeItem('finanaliz_portfolio') } catch { /* yoksay */ }
  },
}

/** Seçili (etkin) portföy. Boşsa ana portföy kullanılır; sunucu kişiye ait olmayan kimlikleri yok sayar. */
const PF_KEY = 'finanaliz_portfolio'
export const activePortfolio = {
  get(): number | null { try { const v = localStorage.getItem(PF_KEY); return v ? Number(v) : null } catch { return null } },
  set(id: number | null) {
    try { if (id) localStorage.setItem(PF_KEY, String(id)); else localStorage.removeItem(PF_KEY) } catch { /* yoksay */ }
    window.dispatchEvent(new Event('finanaliz:portfolio'))
  },
  /** Portföy değiştirip sayfayı yeniler; karşılama ekranı bu yenilemede gösterilmez. */
  switchTo(id: number | null, path = '/portfoy') {
    this.set(id)
    try { sessionStorage.setItem('tm_skip_welcome', '1') } catch { /* yoksay */ }
    location.href = path
  },
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (session.token) headers.Authorization = `Bearer ${session.token}`
  const pf = activePortfolio.get()
  if (pf) headers['X-Portfolio'] = String(pf)
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, friendlyMessage(0, ''))
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    session.clear()
    window.dispatchEvent(new Event('finanaliz:logout'))
  }
  if (!res.ok) {
    let msg = `İstek başarısız (${res.status})`
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') msg = j.detail
      else if (Array.isArray(j.detail)) msg = 'Girilen değerleri kontrol edin.'
    } catch { /* yoksay */ }
    throw new ApiError(res.status, friendlyMessage(res.status, msg))
  }
  return res.json()
}

const nf = (min: number, max: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max })

export function fmtPrice(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  return (a >= 1000 ? nf(2, 2) : a >= 1 ? nf(2, 4) : nf(4, 6)).format(v)
}

export function fmtPct(v: number | null | undefined, sign = true) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${sign && v > 0 ? '+' : ''}${nf(2, 2).format(v)}%`
}

export function fmtMoney(v: number | null | undefined, currency = 'USD') {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

export const fmtDate = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'up' : 'down')

export const MARKET_LABELS: Record<string, string> = {
  bist: 'Borsa İstanbul', us: 'ABD Borsaları', fx: 'Döviz & Emtia', crypto: 'Kripto Paralar',
}
