import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtPct, session, tone } from '../api'
import { ErrorBox, Loading } from '../components/common'
import { ExportButton } from '../components/extras'

type Profile = {
  id: number; username: string; created_at: string; full_name: string | null; email: string | null; phone: string | null
  city: string | null; risk_profile: string | null; experience: string | null; bio: string | null
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
  const [pw, setPw] = useState({ current: '', new: '', again: '' })
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
  const changePw = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null)
    if (pw.new !== pw.again) { setError('Yeni şifreler birbiriyle aynı değil.'); return }
    try { await api('/profile/password', { body: { current: pw.current, new: pw.new } }); setPw({ current: '', new: '', again: '' }); setMsg('Şifreniz değiştirildi.') }
    catch (err: any) { setError(err.message) }
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
          <form className="card" onSubmit={changePw}>
            <h3>Şifre Değiştir</h3>
            <div className="form-grid">
              <label>Mevcut şifre<input type="password" required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></label>
              <label>Yeni şifre<input type="password" required minLength={6} value={pw.new} onChange={e => setPw({ ...pw, new: e.target.value })} /></label>
              <label>Yeni şifre (tekrar)<input type="password" required minLength={6} value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} /></label>
            </div>
            <button className="btn primary mt">Şifreyi değiştir</button>
          </form>
        </div>
      </div>
    </div>
  )
}
