import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorBox, Loading } from '../components/common'

type Event = {
  time: number; country: string; country_name: string; title: string; title_original: string
  impact: string; impact_tr: string; forecast: string | null; previous: string | null
}

const IMPACTS = ['High', 'Medium', 'Low', 'Holiday']
const IMPACT_CLASS: Record<string, string> = { High: 'down', Medium: 'warn', Low: '', Holiday: '' }

const dayKey = (t: number) => new Date(t * 1000).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' })
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })

function countdown(t: number) {
  const s = t - Date.now() / 1000
  if (s <= 0) return 'şimdi'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d} gün ${h} sa` : h ? `${h} sa ${m} dk` : `${m} dk`
}

export default function Calendar() {
  const [data, setData] = useState<{ events: Event[]; source: string; error: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [impacts, setImpacts] = useState<string[]>(['High', 'Medium'])
  const [countries, setCountries] = useState<string[]>([])
  const [, tick] = useState(0)

  useEffect(() => {
    api('/calendar').then(setData).catch(e => setError(e.message))
    const id = setInterval(() => tick(x => x + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const allCountries = useMemo(() => Array.from(new Map((data?.events ?? []).map(e => [e.country, e.country_name])).entries()), [data])
  const events = (data?.events ?? []).filter(e => impacts.includes(e.impact) && (!countries.length || countries.includes(e.country)))
  const now = Date.now() / 1000
  const next = events.find(e => e.time > now && e.impact === 'High')
  const days: [string, Event[]][] = []
  for (const e of events) {
    const k = dayKey(e.time)
    const last = days[days.length - 1]
    if (last && last[0] === k) last[1].push(e); else days.push([k, [e]])
  }
  const toggle = (list: string[], v: string) => list.includes(v) ? list.filter(x => x !== v) : [...list, v]

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Ekonomik Takvim</h1><p className="muted">Bu haftanın önemli veri açıklamaları ve merkez bankası kararları (saatler Türkiye saatiyle)</p></div>
      </header>
      <ErrorBox error={error || data?.error || null} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {next && (
            <div className="card next-event">
              <div className="muted small">Sıradaki yüksek etkili gelişme</div>
              <div className="row between wrap gap">
                <div><strong className="big-text">{next.title}</strong> <span className="muted">· {next.country_name}</span></div>
                <div className="row gap"><span className="muted">{dayKey(next.time)} {hhmm(next.time)}</span><span className="pill down">{countdown(next.time)} sonra</span></div>
              </div>
            </div>
          )}
          <div className="card">
            <div className="row gap wrap">
              <span className="muted small">Etki:</span>
              {IMPACTS.map(i => <button key={i} className={`chip ${impacts.includes(i) ? 'on' : ''}`} onClick={() => setImpacts(toggle(impacts, i))}>
                {{ High: 'Yüksek', Medium: 'Orta', Low: 'Düşük', Holiday: 'Tatil' }[i]}</button>)}
              <span className="muted small ml">Ülke:</span>
              {allCountries.map(([c, n]) => <button key={c} className={`chip ${countries.includes(c) ? 'on' : ''}`} onClick={() => setCountries(toggle(countries, c))}>{n}</button>)}
            </div>
          </div>
          {days.map(([day, list]) => (
            <div key={day} className="card">
              <h3>{day}</h3>
              <table className="table">
                <thead><tr><th>Saat</th><th>Ülke</th><th>Etki</th><th>Gelişme</th><th className="r">Beklenti</th><th className="r">Önceki</th></tr></thead>
                <tbody>
                  {list.map((e, i) => (
                    <tr key={i} className={e.time < now ? 'dim' : ''}>
                      <td className="mono">{hhmm(e.time)}</td>
                      <td>{e.country_name}</td>
                      <td><span className={`pill ${IMPACT_CLASS[e.impact] ?? ''}`}>{e.impact_tr}</span></td>
                      <td>{e.title}{e.title !== e.title_original && <div className="muted small">{e.title_original}</div>}</td>
                      <td className="r mono">{e.forecast ?? '—'}</td>
                      <td className="r mono">{e.previous ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {days.length === 0 && <div className="card muted">Seçilen filtrelere uygun etkinlik yok.</div>}
          <p className="disclaimer">Kaynak: {data.source}. Türkiye'ye özgü TCMB ve TÜİK açıklamaları bu kaynakta yer almayabilir. Geçmiş saatteki etkinlikler soluk gösterilir.</p>
        </>
      )}
    </div>
  )
}
