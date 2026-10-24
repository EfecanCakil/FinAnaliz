import { useState } from 'react'

// Giriş/kayıt ekranları, profil ve misafir dönüşümünde ortak kullanılan parçalar.
export type AuthRes = { token: string; username: string; guest: boolean; display_name: string; recovery_code?: string }

const RULES: { label: string; test: (p: string, u: string) => boolean }[] = [
  { label: 'En az 8 karakter', test: p => p.length >= 8 },
  { label: 'Harf ve rakam içeriyor', test: p => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(p) && /\d/.test(p) },
  { label: 'Kullanıcı adını içermiyor', test: (p, u) => !u || !p.toLowerCase().includes(u.toLowerCase()) },
]

export function passwordScore(p: string): number {
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[a-zçğıöşü]/.test(p) && /[A-ZÇĞİÖŞÜ]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]/.test(p)) s++
  return Math.min(4, s)
}

export const passwordOk = (p: string, u = '') => RULES.every(r => r.test(p, u))

export function PasswordInput({ value, onChange, placeholder, autoFocus, autoComplete = 'current-password' }:
  { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; autoComplete?: string }) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  return (
    <>
      <div className="pw-field">
        <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          autoFocus={autoFocus} autoComplete={autoComplete} required
          onKeyUp={e => setCaps(e.getModifierState?.('CapsLock') ?? false)} onKeyDown={e => setCaps(e.getModifierState?.('CapsLock') ?? false)} />
        <button type="button" className="pw-eye" onClick={() => setShow(!show)} title={show ? 'Şifreyi gizle' : 'Şifreyi göster'} tabIndex={-1}>{show ? '🙈' : '👁'}</button>
      </div>
      {caps && <div className="caps-warn">⇪ Büyük harf kilidi (Caps Lock) açık</div>}
    </>
  )
}

export function PasswordStrength({ password, username = '' }: { password: string; username?: string }) {
  if (!password) return null
  const score = passwordScore(password)
  const ok = passwordOk(password, username)
  const label = !ok ? 'Yetersiz' : ['Zayıf', 'Zayıf', 'Orta', 'Güçlü', 'Çok güçlü'][score]
  const level = !ok ? 0 : score
  return (
    <div className="pw-strength">
      <div className="pw-bars">{[0, 1, 2, 3].map(i => <span key={i} className={i < Math.max(1, level) ? `on l${level}` : ''} />)}</div>
      <div className="row between small"><span className="muted">Şifre gücü</span><b className={`l${level}`}>{label}</b></div>
      <ul className="pw-rules">
        {RULES.map(r => <li key={r.label} className={r.test(password, username) ? 'ok' : ''}>{r.test(password, username) ? '✓' : '•'} {r.label}</li>)}
      </ul>
    </div>
  )
}

/** Kurtarma kodu yalnızca bir kez gösterilir: kopyala / dosyaya kaydet, kaydettim onayıyla devam. */
export function RecoveryCode({ code, username, onDone, doneLabel = 'Devam et →' }: { code: string; username: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* yoksay */ }
  }
  const download = () => {
    const text = `TradeMetrix hesap kurtarma kodu\n\nKullanıcı adı: ${username}\nKurtarma kodu: ${code}\nOluşturulma: ${new Date().toLocaleString('tr-TR')}\n\n` +
      'Şifrenizi unutursanız giriş ekranında "Şifremi unuttum" bağlantısıyla bu kodu kullanarak yeni şifre belirleyebilirsiniz.\n' +
      'Kod bir kez kullanılınca yenisi verilir. Bu dosyayı kimseyle paylaşmayın.\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    a.download = `TradeMetrix-kurtarma-kodu-${username}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="recovery">
      <div className="recovery-icon">🔑</div>
      <h3>Kurtarma kodunuz</h3>
      <p className="muted small">Şifrenizi unutursanız hesabınıza bu kodla tekrar girebilirsiniz. Uygulama e-posta göndermediği için <b>başka bir kurtarma yolu yoktur</b>. Kod yalnızca şimdi gösteriliyor.</p>
      <div className="recovery-code mono">{code}</div>
      <div className="row gap center">
        <button type="button" className="btn ghost small" onClick={copy}>{copied ? '✓ Kopyalandı' : '📋 Kopyala'}</button>
        <button type="button" className="btn ghost small" onClick={download}>⬇ Dosya olarak kaydet</button>
      </div>
      <label className="toggle-row small"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />Kodu güvenli bir yere kaydettim</label>
      <button type="button" className="btn primary full" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  )
}
