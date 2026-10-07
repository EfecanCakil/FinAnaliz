// Yerel REST API ile iletişim ve ortak biçimlendirme yardımcıları.

export type Point = { time: number; value: number }
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Quote = {
  symbol: string; name: string; market: string; currency: string; sector?: string | null; is_index?: boolean
  price: number | null; change: number | null; change_pct: number | null
  change_1w?: number | null; change_1m?: number | null; change_ytd?: number | null; change_1y?: number | null
  high_52w?: number | null; low_52w?: number | null; volume?: number | null; volume_avg?: number | null
  spark: number[]
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

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  get user() { try { return localStorage.getItem(USER_KEY) } catch { return null } },
  set(token: string, user: string) {
    try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, user) } catch { /* yoksay */ }
  },
  clear() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) } catch { /* yoksay */ } },
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (session.token) headers.Authorization = `Bearer ${session.token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
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
    throw new ApiError(res.status, msg)
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
