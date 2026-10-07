import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { LoginBackdrop, Typewriter } from '../components/fx'

export default function Login({ onLogin }: { onLogin: (token: string, user: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api<{ token: string; username: string }>(`/auth/${mode}`, { body: { username, password } })
      onLogin(r.token, r.username)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const [show, setShow] = useState(false)
  return (
    <div className="login-wrap">
      <LoginBackdrop />
      <div className="login-hero">
        <div className="hero-logo">◆</div>
        <h1 className="hero-title">FinAnaliz</h1>
        <div className="hero-sub"><Typewriter texts={[
          'Borsa İstanbul, ABD borsaları, döviz ve kripto tek ekranda.',
          'Yapay zekâ ile fiyat tahmini ve grafik yorumu.',
          '100.000 TL sanal bakiye ile risksiz al-sat pratiği.',
          'Alarmlar, emirler ve strateji botları sizin için çalışır.',
        ]} /></div>
        <div className="hero-stats">
          <div><b>1.100+</b><span>hisse</span></div><div><b>5</b><span>YZ modeli</span></div><div><b>14</b><span>alarm türü</span></div>
        </div>
      </div>
      <form className="login-card glass" onSubmit={submit}>
        <div className="brand big"><span className="logo">◆</span> {mode === 'login' ? 'Tekrar hoş geldiniz' : 'Hesap oluşturun'}</div>
        <p className="muted small">Borsa, Döviz ve Kripto Piyasaları için Yapay Zekâ Destekli Finansal Analiz Platformu</p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Giriş Yap</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Kayıt Ol</button>
        </div>
        <label>Kullanıcı adı<input value={username} onChange={e => setUsername(e.target.value)} autoFocus required minLength={3} /></label>
        <label>Şifre
          <div className="pw-field">
            <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            <button type="button" className="pw-eye" onClick={() => setShow(!show)} title={show ? 'Gizle' : 'Göster'}>{show ? '🙈' : '👁'}</button>
          </div>
        </label>
        {error && <div className="error-box shake">{error}</div>}
        <button className="btn primary full glow" disabled={busy}>{busy ? <span className="spinner" /> : mode === 'login' ? 'Giriş Yap →' : 'Hesap Oluştur →'}</button>
        <p className="muted small center">🔒 Tüm veriler bu bilgisayarda yerel olarak saklanır.</p>
      </form>
    </div>
  )
}
