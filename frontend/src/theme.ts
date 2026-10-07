// Açık / koyu tema tercihi (tarayıcı deposunda saklanır)
export type Theme = 'dark' | 'light'
const KEY = 'finanaliz_theme'

export function getTheme(): Theme {
  try { return (localStorage.getItem(KEY) as Theme) || 'dark' } catch { return 'dark' }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* yoksay */ }
  window.dispatchEvent(new Event('finanaliz:theme'))
}
