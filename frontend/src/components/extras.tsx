import { useEffect, useState } from 'react'
import { api } from '../api'
import { Loading } from './common'

type Saved = { path: string; name: string; folder: string }

/** Raporu sunucuda oluşturup İndirilenler\FinAnaliz klasörüne kaydeder. */
export function ExportButton({ label, endpoint, body, icon = '⬇' }: { label: string; endpoint: string; body?: unknown; icon?: string }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null); setSaved(null)
    try { setSaved(await api<Saved>(endpoint, { method: 'POST', body: body ?? {} })) }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }
  const open = () => saved && api('/export/open', { body: { path: saved.path } }).catch(() => {})

  return (
    <span className="export-wrap">
      <button className="btn ghost" onClick={run} disabled={busy}>{busy ? 'Hazırlanıyor…' : `${icon} ${label}`}</button>
      {(saved || error) && (
        <div className={`export-pop ${error ? 'err' : ''}`}>
          {error ? error : <>
            <div><strong>Kaydedildi</strong></div>
            <div className="muted small break">{saved!.path}</div>
            <div className="row gap mt"><button className="btn primary small" onClick={open}>📂 Klasörü aç</button>
              <button className="btn ghost small" onClick={() => setSaved(null)}>Kapat</button></div>
          </>}
          {error && <button className="btn ghost small ml" onClick={() => setError(null)}>×</button>}
        </div>
      )}
    </span>
  )
}

export type NewsItem = { title: string; link: string; source: string; time: number | null; sentiment: string; score: number }
export type NewsRes = {
  symbol: string | null; name: string; items: NewsItem[]; method: string | null; error: string | null
  summary: { count: number; positive: number; negative: number; neutral: number; avg_score: number; label: string } | null
}

export function timeAgo(t: number | null) {
  if (!t) return ''
  const s = Date.now() / 1000 - t
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} dk önce`
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`
  return `${Math.round(s / 86400)} gün önce`
}

export function SentimentGauge({ summary }: { summary: NonNullable<NewsRes['summary']> }) {
  const pos = (summary.avg_score + 1) / 2 * 100
  return (
    <div className="gauge">
      <div className="row between">
        <span className={`verdict ${summary.label === 'Olumlu' ? 'up' : summary.label === 'Olumsuz' ? 'down' : ''}`}>{summary.label}</span>
        <span className="muted small">Ortalama skor: {summary.avg_score.toFixed(2)} (−1 … +1)</span>
      </div>
      <div className="gauge-track"><div className="gauge-dot" style={{ left: `${pos}%` }} /></div>
      <div className="row between small">
        <span className="down">Olumsuz {summary.negative}</span><span className="muted">Nötr {summary.neutral}</span><span className="up">Olumlu {summary.positive}</span>
      </div>
    </div>
  )
}

export function NewsList({ items, compact }: { items: NewsItem[]; compact?: boolean }) {
  return (
    <div className="news-list">
      {items.map((n, i) => (
        <a key={i} className="news-item" href={n.link} target="_blank" rel="noreferrer">
          <span className={`sent-dot ${n.sentiment === 'olumlu' ? 'up' : n.sentiment === 'olumsuz' ? 'down' : ''}`} title={`${n.sentiment} (${n.score})`} />
          <div>
            <div className={compact ? 'small' : ''}>{n.title}</div>
            <div className="muted small">{n.source} · {timeAgo(n.time)} · <span className={n.sentiment === 'olumlu' ? 'up' : n.sentiment === 'olumsuz' ? 'down' : ''}>{n.sentiment}</span></div>
          </div>
        </a>
      ))}
      {items.length === 0 && <p className="muted">Haber bulunamadı.</p>}
    </div>
  )
}

/** Analiz sayfasında kullanılan kısa haber kartı. */
export function NewsCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<NewsRes | null>(null)
  useEffect(() => {
    setData(null)
    api<NewsRes>(`/news?symbol=${encodeURIComponent(symbol)}`).then(setData).catch(() => {})
  }, [symbol])
  return (
    <div className="card">
      <div className="row between"><h3>Son Haberler & Duygu</h3>{data?.method && <span className="muted small">{data.method}</span>}</div>
      {!data ? <Loading text="Haberler çekiliyor…" /> : data.error ? <p className="muted">{data.error}</p> : (
        <>
          {data.summary && <SentimentGauge summary={data.summary} />}
          <NewsList items={data.items.slice(0, 6)} compact />
        </>
      )}
    </div>
  )
}
