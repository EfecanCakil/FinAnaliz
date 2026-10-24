import { useEffect, useState, type FormEvent } from 'react'
import { api, session } from '../api'
import { Modal } from './ui'
import { PasswordInput, PasswordStrength, RecoveryCode, passwordOk, type AuthRes } from './auth'

/** Misafir hesabını kalıcı hesaba çevirir; portföy, favoriler ve alarmlar korunur. */
export default function GuestUpgrade({ onClose, onDone }: { onClose: () => void; onDone: (username: string) => void }) {
  const [f, setF] = useState({ full_name: '', username: '', email: '', password: '', again: '' })
  const [avail, setAvail] = useState<{ available: boolean; reason: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AuthRes | null>(null)

  useEffect(() => {
    setAvail(null)
    if (f.username.trim().length < 3) return
    const id = setTimeout(() => api<{ available: boolean; reason: string | null }>(`/auth/check-username?u=${encodeURIComponent(f.username.trim())}`).then(setAvail).catch(() => {}), 350)
    return () => clearTimeout(id)
  }, [f.username])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (f.password !== f.again) { setError('Şifreler birbiriyle aynı değil.'); return }
    if (!passwordOk(f.password, f.username)) { setError('Şifre kurallarını sağlamıyor.'); return }
    setBusy(true); setError(null)
    try {
      const r = await api<AuthRes>('/auth/upgrade', { body: { username: f.username, password: f.password, full_name: f.full_name || null, email: f.email || null } })
      session.set(r.token, r.username, true)
      setRes(r)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={res ? 'Hesabınız oluşturuldu 🎉' : 'Ücretsiz hesap oluşturun'} onClose={res ? () => onDone(res.username) : onClose}>
      {res ? (
        <RecoveryCode code={res.recovery_code!} username={res.username} onDone={() => onDone(res.username)} />
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <p className="muted small">Misafir olarak yaptığınız her şey (portföy, favoriler, alarmlar, işlemler) yeni hesabınıza aktarılır ve artık silinmez.</p>
          <label><span>Ad Soyad <span className="muted">(isteğe bağlı)</span></span><input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></label>
          <label>Kullanıcı adı
            <input value={f.username} onChange={e => setF({ ...f, username: e.target.value.replace(/\s/g, '') })} required autoFocus maxLength={24} />
            {avail && <span className={`field-hint ${avail.available ? 'up' : 'down'}`}>{avail.available ? '✓ Kullanılabilir' : `✗ ${avail.reason}`}</span>}
          </label>
          <label><span>E-posta <span className="muted">(isteğe bağlı)</span></span><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <label>Şifre<PasswordInput value={f.password} onChange={v => setF({ ...f, password: v })} autoComplete="new-password" /></label>
          <PasswordStrength password={f.password} username={f.username} />
          <label>Şifre (tekrar)<PasswordInput value={f.again} onChange={v => setF({ ...f, again: v })} autoComplete="new-password" /></label>
          {error && <div className="error-box shake">{error}</div>}
          <button className="btn primary full" disabled={busy || (avail !== null && !avail.available)}>{busy ? <span className="spinner" /> : 'Hesabı oluştur →'}</button>
        </form>
      )}
    </Modal>
  )
}
