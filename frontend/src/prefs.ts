import { api } from './api'

// Arayüz tercihleri (karşılaştırma listesi, sekmeler, tarama ayarları, tema…) tarayıcı deposunda tutulur.
// Tarayıcı deposu uygulamanın adresine bağlı olduğundan, aynı anahtarlar kullanıcı bazında sunucuya da
// yazılır ve açılışta geri yüklenir; böylece uygulama farklı bir portta açılsa bile hiçbir şey sıfırlanmaz.
const EXCLUDED = new Set(['finanaliz_token', 'finanaliz_user'])
const synced = (k: string) => k.startsWith('finanaliz_') && !EXCLUDED.has(k)

const origSet = Storage.prototype.setItem
const origRemove = Storage.prototype.removeItem
let pending: Record<string, string | null> = {}
let timer: number | undefined
let active = false

function flush() {
  const body = pending
  pending = {}
  if (Object.keys(body).length) api('/prefs', { method: 'PUT', body }).catch(() => { pending = { ...body, ...pending } })
}
function queue(k: string, v: string | null) {
  if (!active || !synced(k)) return
  pending[k] = v
  clearTimeout(timer)
  timer = window.setTimeout(flush, 800)
}

Storage.prototype.setItem = function (k: string, v: string) {
  origSet.call(this, k, v)
  if (this === window.localStorage) queue(k, v)
}
Storage.prototype.removeItem = function (k: string) {
  origRemove.call(this, k)
  if (this === window.localStorage) queue(k, null)
}
window.addEventListener('beforeunload', flush)

/** Giriş sonrası çağrılır: sunucudaki tercihleri yerel depoya yazar, sunucuda olmayan yerel tercihleri gönderir. */
export async function hydratePrefs(): Promise<void> {
  active = false
  try {
    const server = await api<Record<string, string>>('/prefs')
    for (const [k, v] of Object.entries(server)) if (synced(k)) origSet.call(localStorage, k, v)
    const missing: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (synced(k) && !(k in server)) missing[k] = localStorage.getItem(k)!
    }
    if (Object.keys(missing).length) await api('/prefs', { method: 'PUT', body: missing }).catch(() => {})
  } catch { /* çevrimdışı vb.: yerel tercihlerle devam */ }
  active = true
}
