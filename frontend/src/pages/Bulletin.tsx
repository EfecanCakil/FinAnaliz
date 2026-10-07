import { useEffect, useState } from 'react'
import { api } from '../api'
import { ErrorBox, Loading } from '../components/common'
import Markdown from '../components/Markdown'

type BulletinRes = { date: string; created_at: string; text: string; source: string }

export default function Bulletin() {
  const [data, setData] = useState<BulletinRes | null>(null)
  const [history, setHistory] = useState<{ file: string; date: string; source: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (refresh = false) => {
    setBusy(true); setError(null)
    api<BulletinRes>(`/bulletin${refresh ? '?refresh=true' : ''}`)
      .then(d => { setData(d); return api<typeof history>('/bulletin/history').then(setHistory) })
      .catch(e => setError(e.message)).finally(() => setBusy(false))
  }
  const open = (file: string) => { setBusy(true); api<BulletinRes>(`/bulletin/${file}`).then(setData).catch(e => setError(e.message)).finally(() => setBusy(false)) }
  useEffect(() => { load() }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Günün Piyasa Bülteni</h1><p className="muted">Piyasaların, haberlerin ve takvimin günlük özeti</p></div>
        <button className="btn ghost" onClick={() => load(true)} disabled={busy}>{busy ? 'Hazırlanıyor…' : '↻ Yeniden oluştur'}</button>
      </header>
      <ErrorBox error={error} />
      {!data && !error && <Loading text="Bülten hazırlanıyor (piyasa verileri, haberler ve takvim toplanıyor)…" />}
      {data && (
        <div className="grid-news">
          <div className="card">
            <h3>Geçmiş Bültenler</h3>
            <div className="movers">
              {history.map(h => (
                <div key={h.file} className={`mover clickable ${h.date === data.date ? 'highlight' : ''}`} onClick={() => open(h.file)}>
                  <span>{h.date}</span><span className="pill">{h.source === 'llm' ? 'Yapay zekâ' : 'Şablon'}</span>
                </div>
              ))}
            </div>
            <p className="muted small mt">Bülten her gün ilk açılışta otomatik oluşturulur ve saklanır. Ayarlar'da LLM anahtarı varsa metni yapay zekâ yazar; yoksa aynı verilerden şablonla üretilir.</p>
          </div>
          <div className="card">
            <div className="row between"><span className="muted small">Oluşturulma: {data.date} {data.created_at}</span>
              <span className="pill">{data.source === 'llm' ? 'Yapay zekâ ile yazıldı' : 'Şablon tabanlı'}</span></div>
            <Markdown text={data.text} />
          </div>
        </div>
      )}
    </div>
  )
}
