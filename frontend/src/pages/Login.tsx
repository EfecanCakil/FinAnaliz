import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { LoginBackdrop, Typewriter } from '../components/fx'
import { PasswordInput, PasswordStrength, RecoveryCode, passwordOk, type AuthRes } from '../components/auth'
import { LogoMark, Wordmark } from '../components/Logo'

type View = 'login' | 'register' | 'forgot'

export default function Login({ onLogin: enter }: { onLogin: (r: AuthRes, remember: boolean) => void }) {
  // Başarılı girişte kart küçülerek menüye doğru uçar, ekran solar; ardından uygulama açılır
  const [leaving, setLeaving] = useState(false)
  const onLogin = (r: AuthRes, remember: boolean) => {
    if (document.documentElement.dataset.anim === 'off') { enter(r, remember); return }
    setLeaving(true)
    setTimeout(() => enter(r, remember), 650)
  }
  const [view, setView] = useState<View>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ res: AuthRes; remember: boolean } | null>(null)  // kurtarma kodu gösterilirken

  // giriş
  const [ident, setIdent] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  // kayıt
  const [reg, setReg] = useState({ full_name: '', username: '', email: '', password: '', again: '', terms: false })
  const [avail, setAvail] = useState<{ available: boolean; reason: string | null } | null>(null)
  // şifremi unuttum
  const [fg, setFg] = useState({ username: '', code: '', password: '', again: '' })

  const go = (v: View) => { setView(v); setError(null) }

  useEffect(() => {
    setAvail(null)
    if (view !== 'register' || reg.username.trim().length < 3) return
    const id = setTimeout(() => {
      api<{ available: boolean; reason: string | null }>(`/auth/check-username?u=${encodeURIComponent(reg.username.trim())}`).then(setAvail).catch(() => {})
    }, 350)
    return () => clearTimeout(id)
  }, [reg.username, view])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const finish = (res: AuthRes, rem: boolean) => res.recovery_code ? setPending({ res, remember: rem }) : onLogin(res, rem)

  const submitLogin = (e: FormEvent) => {
    e.preventDefault()
    run(async () => finish(await api<AuthRes>('/auth/login', { body: { username: ident, password, remember } }), remember))
  }
  const submitRegister = (e: FormEvent) => {
    e.preventDefault()
    if (reg.password !== reg.again) { setError('Şifreler birbiriyle aynı değil.'); return }
    if (!passwordOk(reg.password, reg.username)) { setError('Şifre kurallarını sağlamıyor.'); return }
    if (!reg.terms) { setError('Devam etmek için bilgilendirme metnini onaylayın.'); return }
    run(async () => finish(await api<AuthRes>('/auth/register', { body: { username: reg.username, password: reg.password, full_name: reg.full_name || null, email: reg.email || null } }), true))
  }
  const submitForgot = (e: FormEvent) => {
    e.preventDefault()
    if (fg.password !== fg.again) { setError('Şifreler birbiriyle aynı değil.'); return }
    run(async () => finish(await api<AuthRes>('/auth/reset', { body: { username: fg.username, code: fg.code, new_password: fg.password } }), true))
  }
  const guest = () => run(async () => onLogin(await api<AuthRes>('/auth/guest', { body: {} }), true))

  const title = pending ? (view === 'forgot' ? 'Şifreniz yenilendi' : 'Hesabınız hazır 🎉') : view === 'login' ? 'Tekrar hoş geldiniz' : view === 'register' ? 'Hesap oluşturun' : 'Şifremi unuttum'

  return (
    <div className={`login-wrap ${leaving ? 'leaving' : ''}`}>
      <LoginBackdrop />
      <div className="login-hero">
        <LogoMark size={84} className="hero-logo" />
        <h1 className="hero-title"><Wordmark /></h1>
        <div className="hero-sub"><Typewriter texts={[
          'Borsa İstanbul, ABD borsaları, döviz ve kripto tek ekranda.',
          'Yapay zekâ ile fiyat tahmini ve grafik yorumu.',
          '100.000 TL sanal bakiye ile risksiz al-sat pratiği.',
          'Alarmlar, emirler ve strateji botları sizin için çalışır.',
        ]} /></div>
        <div className="hero-stats">
          <div><b>1.100+</b><span>hisse</span></div><div><b>5</b><span>YZ modeli</span></div><div><b>14</b><span>alarm türü</span></div>
        </div>
        <ul className="hero-points">
          <li>🔒 Verileriniz yalnızca bu bilgisayarda saklanır</li>
          <li>💸 Gerçek para yok; sanal bakiyeyle güvenle deneyin</li>
          <li>👤 Kayıt olmadan misafir olarak hemen başlayın</li>
        </ul>
      </div>

      <div className="login-card glass">
        <div className="brand big"><LogoMark size={30} className="logo" /> {title}</div>

        {pending ? (
          <RecoveryCode code={pending.res.recovery_code!} username={pending.res.username}
            onDone={() => onLogin(pending.res, pending.remember)} doneLabel="Uygulamaya geç →" />
        ) : view === 'forgot' ? (
          <form className="auth-form" onSubmit={submitForgot}>
            <p className="muted small">Kayıt olurken size verilen <b>kurtarma kodu</b> ile yeni şifre belirleyin. Kod, kayıt sırasında indirdiğiniz "TradeMetrix-kurtarma-kodu" dosyasında yazar.</p>
            <label>Kullanıcı adı veya e-posta<input value={fg.username} onChange={e => setFg({ ...fg, username: e.target.value })} required autoFocus autoComplete="username" /></label>
            <label>Kurtarma kodu<input className="mono" value={fg.code} onChange={e => setFg({ ...fg, code: e.target.value.toUpperCase() })} placeholder="XXXX-XXXX-XXXX-XXXX" required /></label>
            <label>Yeni şifre<PasswordInput value={fg.password} onChange={v => setFg({ ...fg, password: v })} autoComplete="new-password" /></label>
            <PasswordStrength password={fg.password} username={fg.username} />
            <label>Yeni şifre (tekrar)<PasswordInput value={fg.again} onChange={v => setFg({ ...fg, again: v })} autoComplete="new-password" /></label>
            {error && <div className="error-box shake">{error}</div>}
            <button className="btn primary full glow" disabled={busy}>{busy ? <span className="spinner" /> : 'Şifreyi yenile →'}</button>
            <button type="button" className="link-btn" onClick={() => go('login')}>← Girişe dön</button>
          </form>
        ) : (
          <>
            <div className="tabs">
              <button type="button" className={view === 'login' ? 'active' : ''} onClick={() => go('login')}>Giriş Yap</button>
              <button type="button" className={view === 'register' ? 'active' : ''} onClick={() => go('register')}>Kayıt Ol</button>
            </div>
            {view === 'login' ? (
              <form className="auth-form" onSubmit={submitLogin}>
                <label>Kullanıcı adı veya e-posta<input value={ident} onChange={e => setIdent(e.target.value)} autoFocus required autoComplete="username" /></label>
                <label>Şifre<PasswordInput value={password} onChange={setPassword} /></label>
                <div className="row between small">
                  <label className="toggle-row"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Beni hatırla</label>
                  <button type="button" className="link-btn" onClick={() => go('forgot')}>Şifremi unuttum</button>
                </div>
                {error && <div className="error-box shake">{error}</div>}
                <button className="btn primary full glow" disabled={busy}>{busy ? <span className="spinner" /> : 'Giriş Yap →'}</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={submitRegister}>
                <label><span>Ad Soyad <span className="muted">(isteğe bağlı)</span></span><input value={reg.full_name} onChange={e => setReg({ ...reg, full_name: e.target.value })} autoComplete="name" /></label>
                <label>Kullanıcı adı
                  <input value={reg.username} onChange={e => setReg({ ...reg, username: e.target.value.replace(/\s/g, '') })} required autoFocus autoComplete="username" maxLength={24} />
                  {avail && <span className={`field-hint ${avail.available ? 'up' : 'down'}`}>{avail.available ? '✓ Kullanılabilir' : `✗ ${avail.reason}`}</span>}
                </label>
                <label><span>E-posta <span className="muted">(isteğe bağlı, e-postayla da giriş yapabilirsiniz)</span></span><input type="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} autoComplete="email" /></label>
                <label>Şifre<PasswordInput value={reg.password} onChange={v => setReg({ ...reg, password: v })} autoComplete="new-password" /></label>
                <PasswordStrength password={reg.password} username={reg.username} />
                <label>Şifre (tekrar)<PasswordInput value={reg.again} onChange={v => setReg({ ...reg, again: v })} autoComplete="new-password" /></label>
                {reg.again && reg.again !== reg.password && <span className="field-hint down">✗ Şifreler aynı değil</span>}
                <label className="toggle-row small terms">
                  <input type="checkbox" checked={reg.terms} onChange={e => setReg({ ...reg, terms: e.target.checked })} />
                  <span>TradeMetrix'in eğitim amaçlı olduğunu, gösterilen analizlerin <b>yatırım tavsiyesi olmadığını</b> ve işlemlerin sanal bakiyeyle yapıldığını anladım.</span>
                </label>
                {error && <div className="error-box shake">{error}</div>}
                <button className="btn primary full glow" disabled={busy || (avail !== null && !avail.available)}>{busy ? <span className="spinner" /> : 'Hesap Oluştur →'}</button>
              </form>
            )}
            <div className="or-divider"><span>veya</span></div>
            <button type="button" className="btn ghost full guest-btn" onClick={guest} disabled={busy}>👤 Misafir olarak devam et</button>
            <p className="muted small center">Misafir hesabıyla her şeyi deneyebilirsiniz; verileriniz 7 gün saklanır. Beğenirseniz tek tıkla kalıcı hesaba geçersiniz.</p>
          </>
        )}
        <p className="muted small center">🔒 Tüm veriler bu bilgisayarda yerel olarak saklanır.</p>
      </div>
    </div>
  )
}
