import { useEffect, useRef, useState } from 'react'

// Otomatik veri yenileme aralığı (saniye; 0 = kapalı). Kullanıcı tercihi tarayıcı deposunda saklanır.
const KEY = 'finanaliz_refresh_sec'
export const REFRESH_OPTIONS = [
  { sec: 0, label: 'Kapalı' }, { sec: 30, label: '30 sn' }, { sec: 60, label: '1 dk' },
  { sec: 120, label: '2 dk' }, { sec: 300, label: '5 dk' }, { sec: 600, label: '10 dk' },
]

export function getRefreshSec(): number {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? 60 : Number(v)
  } catch { return 60 }
}

export function setRefreshSec(sec: number) {
  try { localStorage.setItem(KEY, String(sec)) } catch { /* yoksay */ }
  window.dispatchEvent(new Event('finanaliz:refresh-setting'))
}

export function useRefreshSec() {
  const [sec, setSec] = useState(getRefreshSec())
  useEffect(() => {
    const h = () => setSec(getRefreshSec())
    window.addEventListener('finanaliz:refresh-setting', h)
    return () => window.removeEventListener('finanaliz:refresh-setting', h)
  }, [])
  return sec
}

/** Seçilen aralıkta `fn`'yi çağırır; pencere gizliyken (tepside/simge durumunda) yenileme yapılmaz. */
export function useAutoRefresh(fn: () => void, enabled = true) {
  const sec = useRefreshSec()
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    // "R" kısayolu veya manuel yenileme olayı: hemen yenile
    const now = () => ref.current()
    window.addEventListener('finanaliz:refresh-now', now)
    if (!enabled || !sec) return () => window.removeEventListener('finanaliz:refresh-now', now)
    const id = setInterval(() => { if (!document.hidden) ref.current() }, sec * 1000)
    return () => { clearInterval(id); window.removeEventListener('finanaliz:refresh-now', now) }
  }, [sec, enabled])
  return sec
}
