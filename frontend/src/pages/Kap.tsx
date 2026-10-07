import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ErrorBox, Loading } from '../components/common'
import { useAutoRefresh } from '../refresh'

export type Disclosure = {
  id: number; time: number | null; title: string; summary: string | null; company: string; codes: string[]
  class: string; class_name: string; attachments: number; url: string
}

const CLASS_PILL: Record<string, string> = { ODA: 'warn', FR: 'up', DG: '', DUY: '' }

export function DisclosureList({ items, compact }: { items: Disclosure[]; compact?: boolean }) {
  const nav = useNavigate()
  return (
    <div className="news-list">
      {items.map(d => (
        <div key={d.id} className="kap-item">
          <div className="kap-meta">
            <span className="mono small muted">{d.time ? new Date(d.time * 1000).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
            <span className={`pill ${CLASS_PILL[d.class] ?? ''}`}>{d.class_name}</span>
          </div>
          <div>
            <div className="row gap wrap">
              {d.codes.slice(0, 3).map(c => <button key={c} className="code-link" onClick={() => nav(`/analiz?s=${c}.IS`)}>{c}</button>)}
              {!compact && <span className="muted small">{d.company}</span>}
            </div>
            <a href={d.url} target="_blank" rel="noreferrer" className="kap-title">{d.title}</a>
            {d.summary && <div className="muted small">{d.summary}</div>}
          </div>
          <a href={d.url} target="_blank" rel="noreferrer" className="btn ghost small">KAP'ta aç ↗{d.attachments > 0 ? ` · ${d.attachments} ek` : ''}</a>
        </div>
      ))}
      {items.length === 0 && <p className="muted">Bildirim bulunamadı.</p>}
    </div>
  )
}

export default function Kap() {
  const [scope, setScope] = useState<'all' | 'favorites' | 'portfolio'>('all')
  const [days, setDays] = useState(3)
  const [cls, setCls] = useState('Tümü')
  const [q, setQ] = useState('')
  const [data, setData] = useState<Disclosure[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)

  const load = () => api<Disclosure[]>(`/kap?scope=${scope}&days=${days}`)
    .then(d => { setData(d); setError(null); setUpdated(new Date()) }).catch(e => setError(e.message))
  useEffect(() => { setData(null); load() }, [scope, days])
  useAutoRefresh(load)

  const items = useMemo(() => (data ?? []).filter(d =>
    (cls === 'Tümü' || d.class_name === cls) &&
    (!q || d.codes.some(c => c.includes(q.toUpperCase())) || d.company.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))
      || d.title.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))), [data, cls, q])

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>KAP Bildirimleri</h1><p className="muted">Kamuyu Aydınlatma Platformu'ndaki şirket bildirimleri ve borsa duyuruları</p></div>
        <div className="row gap">
          {updated && <span className="muted small">Güncelleme: {updated.toLocaleTimeString('tr-TR')}</span>}
          <button className="btn ghost" onClick={load}>↻ Yenile</button>
        </div>
      </header>
      <div className="card">
        <div className="toolbar wrap">
          <div className="seg">
            <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Tüm şirketler</button>
            <button className={scope === 'favorites' ? 'active' : ''} onClick={() => setScope('favorites')}>★ Favorilerim</button>
            <button className={scope === 'portfolio' ? 'active' : ''} onClick={() => setScope('portfolio')}>💼 Portföyüm</button>
          </div>
          <div className="row gap">
            <select value={days} onChange={e => setDays(+e.target.value)}>
              <option value={1}>Bugün</option><option value={3}>Son 3 gün</option><option value={7}>Son 7 gün</option><option value={30}>Son 30 gün</option>
            </select>
            <input className="search" placeholder="Kod, şirket veya başlık ara…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        <div className="chips">
          {['Tümü', 'Özel Durum Açıklaması', 'Finansal Rapor', 'Diğer', 'Borsa Duyurusu'].map(c => (
            <button key={c} className={`chip ${cls === c ? 'on' : ''}`} onClick={() => setCls(c)}>{c}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading text="KAP bildirimleri çekiliyor…" />}
      {data && (
        <div className="card">
          <h3>{items.length} bildirim</h3>
          <DisclosureList items={items.slice(0, 300)} />
          {scope !== 'all' && data.length === 0 && <p className="muted small">Bu liste yalnızca Borsa İstanbul hisselerini kapsar. Favorilerinize veya portföyünüze BIST hissesi ekleyin.</p>}
        </div>
      )}
      <p className="disclaimer">Kaynak: kap.org.tr. Bildirimlerin tam metni ve ekleri için "KAP'ta aç" bağlantısını kullanın.</p>
    </div>
  )
}

/** Analiz sayfasında kullanılan kısa KAP kartı (yalnızca BIST hisseleri). */
export function KapCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Disclosure[] | null>(null)
  useEffect(() => {
    setData(null)
    api<Disclosure[]>(`/kap?symbol=${encodeURIComponent(symbol)}&days=30`).then(setData).catch(() => setData([]))
  }, [symbol])
  return (
    <div className="card">
      <h3>KAP Bildirimleri <span className="muted small">(son 30 gün)</span></h3>
      {!data ? <Loading /> : <DisclosureList items={data.slice(0, 8)} compact />}
    </div>
  )
}
