// Arayüz hatalarını yakalar: bir sayfa çökerse tüm uygulama boş ekrana dönmez, hata da hata kaydına yazılır.
import { Component, type ReactNode } from 'react'

let sent = 0
export function reportError(message: string, extra: { source?: string; stack?: string } = {}) {
  if (++sent > 30) return  // bir oturumda en fazla 30 rapor
  try {
    fetch('/api/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(message).slice(0, 1900), source: extra.source?.slice(0, 480), stack: extra.stack?.slice(0, 7900), path: location.pathname }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* yoksay */ }
}

export function installErrorReporting() {
  window.addEventListener('error', e => {
    if (!e.message || e.message.startsWith('ResizeObserver')) return  // tarayıcının zararsız uyarısı
    reportError(e.message, { source: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error?.stack })
  })
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason
    if (r?.name === 'ApiError' || typeof r?.status === 'number') return  // sunucu hataları zaten sunucuda kaydediliyor
    reportError(r?.message ?? String(r), { stack: r?.stack })
  })
}

type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError(error.message, { source: 'React', stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` })
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })  // başka sayfaya geçince sıfırla
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="card">
          <h3>😕 Bu sayfada beklenmedik bir sorun oluştu</h3>
          <p className="muted">Hata kaydedildi. Sayfayı yeniden deneyebilir ya da menüden başka bir sayfaya geçebilirsiniz; verileriniz etkilenmez.</p>
          <div className="row gap">
            <button className="btn primary" onClick={() => this.setState({ error: null })}>↻ Yeniden dene</button>
            <button className="btn ghost" onClick={() => location.reload()}>Uygulamayı yenile</button>
          </div>
          <details className="mt"><summary className="small muted">Teknik ayrıntı</summary><pre className="small">{this.state.error.message}</pre></details>
        </div>
      </div>
    )
  }
}
