import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { REFRESH_OPTIONS, setRefreshSec, useRefreshSec } from '../refresh'
import { ACCENTS, chime, confetti, setPrefs, usePrefs } from '../components/fx'

type Status = { llm_enabled: boolean; model: string; key_hint: string | null; tray_on_close: boolean; telegram_configured: boolean; telegram_chat_id: string | null }

export default function Settings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { api<Status>('/settings').then(s => { setStatus(s); setModel(s.model) }).catch(() => {}) }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const s = await api<Status>('/settings', { method: 'PUT', body: { anthropic_api_key: key || null, model: model || null } })
    setStatus(s); setKey(''); setMsg('Ayarlar kaydedildi.')
  }
  const refreshSec = useRefreshSec()
  const prefs = usePrefs()
  const [tg, setTg] = useState({ token: '', chat: '' })
  const [tgMsg, setTgMsg] = useState<string | null>(null)
  const saveTelegram = async () => {
    const s = await api<Status>('/settings', { method: 'PUT', body: { telegram_bot_token: tg.token || null, telegram_chat_id: tg.chat || null } })
    setStatus(s); setTg({ token: '', chat: '' }); setTgMsg('Telegram ayarları kaydedildi.')
  }
  const removeTelegram = async () => {
    const s = await api<Status>('/settings', { method: 'PUT', body: { telegram_bot_token: '', telegram_chat_id: '' } })
    setStatus(s); setTgMsg('Telegram bağlantısı kaldırıldı.')
  }
  const testTelegram = async () => {
    setTgMsg(null)
    try { const r = await api<{ message: string }>('/telegram/test', { body: { token: tg.token || null, chat_id: tg.chat || null } }); setTgMsg('Test mesajı gönderildi: ' + r.message) }
    catch (e: any) { setTgMsg(e.message) }
  }
  const setTray = async (v: boolean) => {
    const s = await api<Status>('/settings', { method: 'PUT', body: { tray_on_close: v } })
    setStatus(s); setMsg(v ? 'Pencere kapatıldığında uygulama sistem tepsisine küçülecek.' : 'Pencere kapatıldığında uygulama tamamen kapanacak.')
  }
  const removeKey = async () => {
    const s = await api<Status>('/settings', { method: 'PUT', body: { anthropic_api_key: '' } })
    setStatus(s); setMsg('API anahtarı silindi.')
  }

  return (
    <div className="page">
      <header className="page-head"><div><h1>Ayarlar</h1><p className="muted">Yapay zekâ asistanı ve uygulama ayarları</p></div></header>
      <form className="card narrow" onSubmit={save}>
        <h3>Büyük Dil Modeli (LLM) Bağlantısı</h3>
        <p className="muted">
          Durum: {status ? (status.llm_enabled ? <span className="up">Etkin (anahtar {status.key_hint})</span> : <span className="down">Anahtar tanımlı değil</span>) : '…'}
        </p>
        <label>Anthropic API anahtarı
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={status?.llm_enabled ? 'Değiştirmek için yeni anahtar girin' : 'sk-ant-…'} autoComplete="off" />
        </label>
        <label>Model
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-5-5" />
        </label>
        <p className="muted small">Anahtar yalnızca bu bilgisayardaki <code>backend/data/settings.json</code> dosyasında saklanır. Ortam değişkeni olarak <code>ANTHROPIC_API_KEY</code> da kullanılabilir.</p>
        {msg && <div className="info-box">{msg}</div>}
        <div className="row gap">
          <button className="btn primary">Kaydet</button>
          {status?.llm_enabled && <button type="button" className="btn ghost" onClick={removeKey}>Anahtarı sil</button>}
        </div>
      </form>
      <div className="card narrow">
        <h3>Masaüstü Uygulaması</h3>
        <label className="toggle-row">
          <input type="checkbox" checked={status?.tray_on_close ?? true} onChange={e => setTray(e.target.checked)} />
          Pencere kapatılınca sistem tepsisine küçült ve fiyat alarmlarını izlemeye devam et
        </label>
        <p className="muted small mt">Açıkken pencereyi kapattığınızda FinAnaliz saatin yanındaki simge alanında çalışmaya devam eder,
          alarmlarınızı dakikada bir kontrol eder ve tetiklendiğinde Windows bildirimi gösterir. Tamamen kapatmak için tepsi simgesine
          sağ tıklayıp <b>Çıkış</b>'ı seçin.</p>
      </div>
      <DesktopNotifyCard />
      <div className="card narrow">
        <h3>Görünüm ve Efektler</h3>
        <div className="muted small">Vurgu rengi</div>
        <div className="accent-row">
          {Object.entries(ACCENTS).map(([k, a]) => (
            <button key={k} type="button" className={`accent-dot ${prefs.accent === k ? 'on' : ''}`} style={{ background: a.color }} title={a.name} onClick={() => setPrefs({ accent: k })} />
          ))}
        </div>
        <label className="toggle-row mt"><input type="checkbox" checked={prefs.animations} onChange={e => setPrefs({ animations: e.target.checked })} />Animasyonlar ve geçiş efektleri</label>
        <label className="toggle-row"><input type="checkbox" checked={prefs.confetti} onChange={e => setPrefs({ confetti: e.target.checked })} />Rozet ve kârlı işlemlerde konfeti</label>
        <label className="toggle-row"><input type="checkbox" checked={prefs.sound} onChange={e => { setPrefs({ sound: e.target.checked }); if (e.target.checked) setTimeout(() => chime('good'), 50) }} />Bildirim sesleri</label>
        <label className="toggle-row"><input type="checkbox" checked={prefs.sidebarCollapsed} onChange={e => setPrefs({ sidebarCollapsed: e.target.checked })} />Yan menüyü daralt (yalnızca simgeler)</label>
        <button type="button" className="btn ghost small mt" onClick={() => confetti()}>🎉 Konfetiyi dene</button>
      </div>
      <div className="card narrow">
        <h3>Veri Yenileme</h3>
        <label>Otomatik yenileme aralığı
          <select value={refreshSec} onChange={e => setRefreshSec(+e.target.value)}>
            {REFRESH_OPTIONS.map(o => <option key={o.sec} value={o.sec}>{o.label}</option>)}
          </select>
        </label>
        <p className="muted small mt">Piyasa özeti, piyasa sayfaları, izleme listesi, portföy ve KAP bildirimleri bu aralıkla otomatik güncellenir.
          Sayfalardaki <b>↻ Yenile</b> düğmesi ise önbelleği atlayarak verileri anında yeniden çeker. Fiyatlar veri sağlayıcıdan gecikmeli gelebilir
          (BIST için genellikle 15 dakika).</p>
      </div>
      <div className="card narrow">
        <h3>Telegram Bildirimleri</h3>
        <p className="muted">Durum: {status?.telegram_configured ? <span className="up">Bağlı (sohbet {status.telegram_chat_id})</span> : <span className="muted">Bağlı değil</span>}</p>
        <label>Bot anahtarı (BotFather'dan)<input type="password" autoComplete="off" value={tg.token} onChange={e => setTg({ ...tg, token: e.target.value })} placeholder={status?.telegram_configured ? 'Değiştirmek için yeni anahtar girin' : '123456:ABC…'} /></label>
        <label>Sohbet kimliği (chat id)<input value={tg.chat} onChange={e => setTg({ ...tg, chat: e.target.value })} placeholder={status?.telegram_chat_id ?? 'ör. 123456789'} /></label>
        <p className="muted small">Kurulum: Telegram'da <b>@BotFather</b> ile bir bot oluşturup anahtarını alın, botunuza bir mesaj yazın, ardından
          <b> @userinfobot</b> ile sohbet kimliğinizi öğrenin. Alarmlar tetiklendiğinde bu sohbete mesaj gönderilir.</p>
        {tgMsg && <div className="info-box">{tgMsg}</div>}
        <div className="row gap">
          <button type="button" className="btn primary" onClick={saveTelegram} disabled={!tg.token && !tg.chat}>Kaydet</button>
          <button type="button" className="btn ghost" onClick={testTelegram}>Test mesajı gönder</button>
          {status?.telegram_configured && <button type="button" className="btn ghost" onClick={removeTelegram}>Bağlantıyı kaldır</button>}
        </div>
      </div>
      <div className="card narrow">
        <h3>Hakkında</h3>
        <p>FinAnaliz — Borsa, Döviz ve Kripto Piyasaları için Yapay Zekâ Destekli Finansal Analiz Platformu.</p>
        <p className="muted small">Veri kaynağı: Yahoo Finance (yfinance). Veriler gecikmeli olabilir. API dokümantasyonu: <a href="/docs" target="_blank">/docs (Swagger UI)</a></p>
      </div>
    </div>
  )
}

type NotifySettings = { enabled: boolean; mode: 'background' | 'always'; kinds: string[]; sound: boolean; quiet: boolean; quiet_start: number; quiet_end: number
  available: boolean; kind_labels: Record<string, string> }

function DesktopNotifyCard() {
  const [ns, setNs] = useState<NotifySettings | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { api<NotifySettings>('/desktop/notify-settings').then(setNs).catch(() => setUnsupported(true)) }, [])
  const update = async (patch: Partial<NotifySettings>) => {
    if (!ns) return
    setNs({ ...ns, ...patch })
    try { setNs(await api<NotifySettings>('/desktop/notify-settings', { method: 'PUT', body: patch })) } catch (e) { setMsg((e as Error).message) }
  }
  const test = async () => {
    setMsg(null)
    try { await api('/desktop/notify-test', { body: {} }); setMsg('Test bildirimi gönderildi; ekranın sağ alt köşesine bakın.') } catch (e) { setMsg((e as Error).message) }
  }
  if (unsupported) return null
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <div className="card narrow">
      <h3>🔔 Masaüstü Bildirimleri</h3>
      {!ns ? <p className="muted small">Yükleniyor…</p> : (
        <>
          {!ns.available && <div className="error-box">Windows bildirim servisine erişilemedi; bildirimler sistem tepsisi balonu olarak gösterilecek.</div>}
          <label className="toggle-row">
            <input type="checkbox" checked={ns.enabled} onChange={e => update({ enabled: e.target.checked })} />
            Alarmlar, emirler ve diğer gelişmeler için Windows bildirimi göster
          </label>
          <div className={ns.enabled ? '' : 'disabled-block'}>
            <div className="muted small mt">Ne zaman?</div>
            <div className="seg">
              <button className={ns.mode === 'background' ? 'active' : ''} onClick={() => update({ mode: 'background' })} title="Uygulama simge durumunda, tepside veya başka bir pencere öndeyken">Uygulama arka plandayken</button>
              <button className={ns.mode === 'always' ? 'active' : ''} onClick={() => update({ mode: 'always' })}>Her zaman</button>
            </div>
            <div className="muted small mt">Hangi bildirimler?</div>
            <div className="chips">
              {Object.entries(ns.kind_labels).map(([k, label]) => (
                <button key={k} className={`chip ${ns.kinds.includes(k) ? 'on' : ''}`}
                  onClick={() => update({ kinds: ns.kinds.includes(k) ? ns.kinds.filter(x => x !== k) : [...ns.kinds, k] })}>{label}</button>
              ))}
            </div>
            <label className="toggle-row mt"><input type="checkbox" checked={ns.sound} onChange={e => update({ sound: e.target.checked })} />Bildirim sesi çal</label>
            <label className="toggle-row">
              <input type="checkbox" checked={ns.quiet} onChange={e => update({ quiet: e.target.checked })} />
              Sessiz saatler:
              <select value={ns.quiet_start} disabled={!ns.quiet} onChange={e => update({ quiet_start: +e.target.value })}>{hours.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
              –
              <select value={ns.quiet_end} disabled={!ns.quiet} onChange={e => update({ quiet_end: +e.target.value })}>{hours.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
              arası bildirim gösterme
            </label>
          </div>
          {msg && <div className="info-box mt">{msg}</div>}
          <div className="row gap mt">
            <button className="btn ghost" onClick={test}>Test bildirimi gönder</button>
          </div>
          <p className="muted small mt">Bildirimdeki <b>Grafiği aç</b> / <b>Portföyü aç</b> düğmesi uygulamayı öne getirip ilgili sayfayı açar. Kaçırdığınız bildirimler Windows Bildirim Merkezi'nde (Win + N) ve uygulamadaki 🔔 menüsünde durur.</p>
        </>
      )}
    </div>
  )
}
