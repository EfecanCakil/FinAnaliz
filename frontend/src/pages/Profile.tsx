import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtPct, session, tone } from '../api'
import { ErrorBox, Loading } from '../components/common'
import { ExportButton } from '../components/extras'
import { PasswordInput, PasswordStrength, RecoveryCode, passwordOk, type AuthRes } from '../components/auth'
import { Modal } from '../components/ui'

type Profile = {
  id: number; username: string; created_at: string; full_name: string | null; email: string | null; phone: string | null
  city: string | null; risk_profile: string | null; experience: string | null; bio: string | null; is_guest: boolean; last_login: string | null; prev_login: string | null; has_recovery: boolean
  stats: { transactions: number; alerts: number; favorites: number }
}
type Account = {
  t0: number; t1: number; t2: number; buying_power: number; total_cash: number; net_deposits: number
  holdings_value_try: number; equity_try: number; total_pnl_try: number; total_pnl_pct: number | null; holdings_count: number
}

const FIELDS: { key: keyof Profile; label: string; type?: string; options?: string[] }[] = [
  { key: 'full_name', label: 'Ad soyad' },
  { key: 'email', label: 'E-posta', type: 'email' },
  { key: 'phone', label: 'Telefon', type: 'tel' },
  { key: 'city', label: 'Şehir' },
  { key: 'risk_profile', label: 'Risk profili', options: ['', 'Düşük (korumacı)', 'Orta (dengeli)', 'Yüksek (atak)'] },
  { key: 'experience', label: 'Yatırım deneyimi', options: ['', '1 yıldan az', '1–3 yıl', '3–5 yıl', '5 yıldan fazla'] },
]

export default function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null)
  const [acc, setAcc] = useState<Account | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cash, setCash] = useState('')

  const load = () => {
    api<Profile>('/profile').then(d => {
      setP(d)
      setForm({ ...Object.fromEntries(FIELDS.map(f => [f.key, (d[f.key] as string | null) ?? ''])), bio: d.bio ?? '' })
    }).catch(e => setError(e.message))
    api<Account>('/account').then(setAcc).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null)
    try { setP(await api<Profile>('/profile', { method: 'PUT', body: form })); setMsg('Profil bilgileriniz kaydedildi.') } catch (err: any) { setError(err.message) }
  }
  const money = async (kind: 'deposit' | 'withdraw' | 'reset') => {
    setError(null); setMsg(null)
    const amount = kind === 'reset' ? (+cash || 100000) : +cash
    if (!amount) { setError('Bir tutar girin.'); return }
    if (kind === 'reset' && !confirm(`Tüm alım-satım işlemleriniz silinecek ve hesabınız ${amount.toLocaleString('tr-TR')} TL bakiyeyle yeniden başlatılacak. Emin misiniz?`)) return
    try {
      await api(`/account/${kind}`, { body: { amount } })
      setCash(''); setMsg(kind === 'deposit' ? 'Sanal para yatırıldı.' : kind === 'withdraw' ? 'Sanal para çekildi.' : 'Hesap sıfırlandı.')
      load()
    } catch (err: any) { setError(err.message) }
  }

  if (!p) return <div className="page"><ErrorBox error={error} />{!error && <Loading />}</div>
  const initials = (p.full_name || p.username).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="page">
      <header className="page-head">
        <div className="row gap">
          <div className="avatar">{initials}</div>
          <div><h1>{p.full_name || p.username}</h1><p className="muted">@{p.username} · Üyelik: {new Date(p.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('tr-TR')}</p></div>
        </div>
        <button className="btn ghost" onClick={() => { session.clear(); window.dispatchEvent(new Event('finanaliz:logout')) }}>Çıkış yap</button>
      </header>
      <ErrorBox error={error} />
      {msg && <div className="info-box" onClick={() => setMsg(null)}>{msg}</div>}

      {acc && (
        <div className="grid4">
          <div className="card kpi"><div className="muted small">Toplam varlık</div><div className="kpi-value">{fmtMoney(acc.equity_try, 'TRY')}</div>
            <div className={`small ${tone(acc.total_pnl_try)}`}>{fmtMoney(acc.total_pnl_try, 'TRY')} ({fmtPct(acc.total_pnl_pct)})</div></div>
          <div className="card kpi"><div className="muted small">Nakit (alım gücü)</div><div className="kpi-value">{fmtMoney(acc.buying_power, 'TRY')}</div>
            <div className="muted small">T0 {fmtMoney(acc.t0, 'TRY')}</div></div>
          <div className="card kpi"><div className="muted small">Hisse / varlık değeri</div><div className="kpi-value">{fmtMoney(acc.holdings_value_try, 'TRY')}</div>
            <div className="muted small">{acc.holdings_count} farklı varlık</div></div>
          <div className="card kpi"><div className="muted small">Aktivite</div>
            <div className="small">{p.stats.transactions} işlem · {p.stats.alerts} alarm · {p.stats.favorites} favori</div>
            <Link to="/portfoy" className="small">Portföye git →</Link></div>
        </div>
      )}

      <div className="grid2">
        <form className="card" onSubmit={save}>
          <h3>Kişisel Bilgiler</h3>
          <div className="form-grid">
            {FIELDS.map(f => (
              <label key={f.key}>{f.label}
                {f.options
                  ? <select value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>{f.options.map(o => <option key={o} value={o}>{o || 'Seçiniz'}</option>)}</select>
                  : <input type={f.type ?? 'text'} value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}
              </label>
            ))}
          </div>
          <label className="mt">Hakkımda / yatırım hedeflerim<textarea rows={3} value={form.bio ?? ''} onChange={e => setForm({ ...form, bio: e.target.value })} /></label>
          <button className="btn primary mt">Kaydet</button>
          <p className="muted small mt">Bilgileriniz yalnızca bu bilgisayarda saklanır.</p>
        </form>

        <div className="col gap">
          <div className="card">
            <h3>Sanal Yatırım Hesabı</h3>
            <p className="muted small">Uygulamadaki alım-satımlar sanal bir TL hesabından yapılır. Varsayılan başlangıç bakiyesi 100.000 TL'dir.</p>
            <div className="row gap wrap">
              <input type="number" min="0" step="any" placeholder="Tutar (TL)" value={cash} onChange={e => setCash(e.target.value)} style={{ width: 160 }} />
              <button type="button" className="btn ghost" onClick={() => money('deposit')}>+ Para yatır</button>
              <button type="button" className="btn ghost" onClick={() => money('withdraw')}>− Para çek</button>
              <button type="button" className="btn ghost" onClick={() => money('reset')}>↺ Hesabı sıfırla</button>
            </div>
            <p className="muted small mt">"Hesabı sıfırla" tüm işlemleri siler ve girdiğiniz tutarla (boşsa 100.000 TL) yeniden başlatır. Çekim yalnızca takası tamamlanmış (T0) bakiyeden yapılabilir.</p>
          </div>
          <div className="card">
            <h3>Yedekleme ve Geri Yükleme</h3>
            <p className="muted small">Portföy, işlemler, alarmlar, emirler, botlar, rozetler ve profil bilgileriniz tek bir dosyaya yedeklenir.
              Bu dosyayla verilerinizi başka bir bilgisayara taşıyabilirsiniz.</p>
            <div className="row gap wrap">
              <ExportButton label="Yedek al" endpoint="/backup" icon="💾" />
              <label className="btn ghost file-btn">📂 Yedekten geri yükle
                <input type="file" accept=".json,application/json" onChange={async e => {
                  const f = e.target.files?.[0]; e.target.value = ''
                  if (!f) return
                  if (!confirm('Mevcut verileriniz silinip yedekteki verilerle değiştirilecek. Devam edilsin mi?')) return
                  try { const payload = JSON.parse(await f.text()); await api('/backup/restore', { body: payload }); setMsg('Yedek geri yüklendi.'); load() }
                  catch (err: any) { setError(err.message || 'Dosya okunamadı.') }
                }} />
              </label>
            </div>
          </div>
          {p && <SecurityCard p={p} />}
        </div>
      </div>
    </div>
  )
}

// Hesap güvenliği: şifre değiştirme, kurtarma kodu, oturumlar ve hesabı silme
function SecurityCard({ p }: { p: Profile }) {
  const [pw, setPw] = useState({ current: '', new: '', again: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [generated, setGenerated] = useState(false)
  const [ask, setAsk] = useState<null | 'code' | 'delete'>(null)
  const [confirmPw, setConfirmPw] = useState('')

  if (p.is_guest) return (
    <div className="card">
      <h3>🔐 Hesap Güvenliği</h3>
      <p className="muted">Misafir hesabı kullanıyorsunuz; şifreniz yok ve verileriniz 7 gün kullanılmazsa silinir.</p>
      <button className="btn primary" onClick={() => window.dispatchEvent(new Event('finanaliz:upgrade'))}>Ücretsiz hesap oluştur ve verileri sakla</button>
    </div>
  )

  const run = async (fn: () => Promise<void>) => { setErr(null); setMsg(null); try { await fn() } catch (e) { setErr((e as Error).message) } }
  const changePw = (e: FormEvent) => {
    e.preventDefault()
    if (pw.new !== pw.again) { setErr('Yeni şifreler birbiriyle aynı değil.'); return }
    if (!passwordOk(pw.new, p.username)) { setErr('Yeni şifre kuralları sağlamıyor.'); return }
    run(async () => {
      const r = await api<AuthRes>('/profile/password', { body: { current: pw.current, new: pw.new } })
      session.update(r.token, r.username)
      setPw({ current: '', new: '', again: '' }); setMsg('Şifreniz değiştirildi. Diğer cihaz ve pencerelerdeki oturumlar kapatıldı.')
    })
  }
  const logoutAll = () => run(async () => {
    const r = await api<AuthRes>('/auth/logout-all', { body: {} })
    session.update(r.token, r.username); setMsg('Diğer tüm oturumlar kapatıldı. Bu pencerede oturumunuz açık kalmaya devam ediyor.')
  })
  const confirmAction = () => run(async () => {
    if (ask === 'code') {
      setCode((await api<{ recovery_code: string }>('/auth/recovery-code', { body: { password: confirmPw } })).recovery_code); setAsk(null); setGenerated(true)
      window.dispatchEvent(new Event('finanaliz:me-changed'))
    }
    else if (ask === 'delete') { await api('/auth/delete-account', { body: { password: confirmPw } }); session.clear(); window.location.href = '/' }
    setConfirmPw('')
  })

  return (
    <div className="card">
      <h3>🔐 Hesap Güvenliği</h3>
      <p className="muted small">{p.prev_login ? `Bir önceki girişiniz: ${new Date(p.prev_login.replace(' ', 'T') + 'Z').toLocaleString('tr-TR')} — siz değilseniz şifrenizi değiştirin.` : 'Bu hesaba ilk kez giriş yapıldı.'}</p>
      {msg && <div className="info-box">{msg}</div>}
      {err && !ask && <div className="error-box">{err}</div>}
      {!p.has_recovery && !generated && <div className="info-box">🔑 Hesabınız için henüz kurtarma kodu oluşturulmadı. Şifrenizi unutursanız hesabınıza yalnızca bu kodla girebilirsiniz; aşağıdan hemen oluşturun.</div>}
      <form onSubmit={changePw}>
        <h4>Şifre değiştir</h4>
        <div className="form-grid">
          <label>Mevcut şifre<PasswordInput value={pw.current} onChange={v => setPw({ ...pw, current: v })} /></label>
          <label>Yeni şifre<PasswordInput value={pw.new} onChange={v => setPw({ ...pw, new: v })} autoComplete="new-password" /></label>
          <label>Yeni şifre (tekrar)<PasswordInput value={pw.again} onChange={v => setPw({ ...pw, again: v })} autoComplete="new-password" /></label>
        </div>
        <PasswordStrength password={pw.new} username={p.username} />
        <button className="btn primary mt">Şifreyi değiştir</button>
      </form>
      <div className="security-actions">
        <div><b>🔑 Kurtarma kodu</b><span className="muted small">Şifrenizi unutursanız bu kodla yeni şifre belirlersiniz. Yeni kod oluşturunca eskisi geçersiz olur.</span>
          <button className="btn ghost small" onClick={() => { setAsk('code'); setErr(null) }}>Yeni kod oluştur</button></div>
        <div><b>💻 Oturumlar</b><span className="muted small">Başka bir pencerede veya bilgisayarda açık kalmış oturumları kapatır.</span>
          <button className="btn ghost small" onClick={logoutAll}>Diğer oturumları kapat</button></div>
        <div><b>🗑 Hesabı sil</b><span className="muted small">Hesabınız ve tüm verileriniz (portföy, işlemler, alarmlar) kalıcı olarak silinir. Geri alınamaz.</span>
          <button className="btn ghost small danger" onClick={() => { setAsk('delete'); setErr(null) }}>Hesabımı sil</button></div>
      </div>
      {ask && (
        <Modal title={ask === 'code' ? 'Yeni kurtarma kodu' : 'Hesabı kalıcı olarak sil'} onClose={() => { setAsk(null); setConfirmPw('') }}>
          <p className="muted">{ask === 'code' ? 'Devam etmek için şifrenizi girin.' : 'Bu işlem geri alınamaz. Onaylamak için şifrenizi girin.'}</p>
          <PasswordInput value={confirmPw} onChange={setConfirmPw} autoFocus />
          {err && <div className="error-box mt">{err}</div>}
          <div className="row gap mt">
            <button className={`btn ${ask === 'delete' ? 'danger-solid' : 'primary'}`} disabled={!confirmPw} onClick={confirmAction}>{ask === 'code' ? 'Kod oluştur' : 'Hesabımı kalıcı olarak sil'}</button>
            <button className="btn ghost" onClick={() => { setAsk(null); setConfirmPw('') }}>Vazgeç</button>
          </div>
        </Modal>
      )}
      {code && <Modal title="Yeni kurtarma kodunuz" onClose={() => setCode(null)}><RecoveryCode code={code} username={p.username} onDone={() => setCode(null)} doneLabel="Tamam" /></Modal>}
    </div>
  )
}
