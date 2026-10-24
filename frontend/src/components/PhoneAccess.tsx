// Ayarlar: telefondan erişim. Aynı Wi-Fi'daki telefon QR kodu okutarak uygulamayı tarayıcıda açar.
import { useEffect, useState } from 'react'
import { api } from '../api'

type Lan = { enabled: boolean; ip: string | null; port: number; url: string | null; qr?: string; error: string | null; local: boolean }

export default function PhoneAccessCard() {
  const [s, setS] = useState<Lan | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Lan>('/lan').then(setS).catch(() => setS(null)) }, [])
  if (!s) return null
  if (!s.local) return (
    <div className="card narrow"><h3>📱 Telefondan erişim</h3><p className="muted small">Bu cihaz, bilgisayardaki TradeMetrix'e yerel ağ üzerinden bağlı. Erişimi bilgisayardan kapatabilirsiniz.</p></div>
  )
  const toggle = async () => {
    setBusy(true); setErr(null)
    try { setS(await api<Lan>('/lan', { body: { enabled: !s.enabled } })) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card narrow">
      <h3>📱 Telefondan erişim</h3>
      <p className="muted small">Aynı Wi-Fi ağındaki telefonunuzdan TradeMetrix'i tarayıcıda açın. Yalnızca bu QR kodu okutan cihazlar bağlanabilir; telefonda yine kullanıcı adı ve şifrenizle giriş yaparsınız.</p>
      <div className="row gap">
        <button className={`btn ${s.enabled ? 'ghost danger' : 'primary'}`} onClick={toggle} disabled={busy}>
          {busy ? 'Bekleyin…' : s.enabled ? 'Erişimi kapat' : 'Telefondan erişimi aç'}
        </button>
        <span className={`pill ${s.enabled ? 'up' : ''}`}>{s.enabled ? 'Açık' : 'Kapalı'}</span>
      </div>
      {(err || s.error) && <div className="error-box small mt">{err || s.error}</div>}
      {s.enabled && s.qr && (
        <div className="lan-qr mt">
          <div className="lan-qr-img" dangerouslySetInnerHTML={{ __html: s.qr }} />
          <ol className="small">
            <li>Telefonun bilgisayarla <b>aynı Wi-Fi</b> ağına bağlı olduğundan emin olun.</li>
            <li>Telefon kamerasıyla QR kodu okutun ve açılan bağlantıya dokunun.</li>
            <li>Windows bir güvenlik duvarı izni sorarsa <b>Özel ağlar</b> için izin verin.</li>
            <li>Telefonda giriş yapın. İsterseniz tarayıcı menüsünden “Ana ekrana ekle” ile uygulama gibi kullanabilirsiniz.</li>
          </ol>
          <p className="muted small">Adres: {s.ip}:{s.port}. Erişimi kapattığınızda eşleşmiş tüm cihazların bağlantısı kesilir; tekrar açınca yeni QR kod oluşur. Uygulama her açılışta erişim kapalı başlar.</p>
        </div>
      )}
    </div>
  )
}
