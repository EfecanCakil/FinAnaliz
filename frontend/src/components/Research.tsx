// Şirket araştırma kartları (bilanço özeti, benzer hisseler, olay etkisi) ve portföy risk uyarıcısı.
import { useEffect, useState } from 'react'
import { api, fmtPct } from '../api'
import { Loading } from './common'
import { openStock } from './StockCard'

const short = (s: string) => s.replace('.IS', '')
const TONE: Record<string, string> = { good: 'up', bad: 'down', neutral: '' }

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setData(null); setErr(null)
    if (!path) return
    let alive = true
    api<T>(path).then(d => { if (alive) setData(d) }).catch(e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [path])
  return { data, err }
}

/* ------------------------------------------------------------------ Bilanço özeti */
type Digest = { symbol: string; name: string; period: string | null; currency: string; is_bank: boolean
  points: { key: string; icon: string; title: string; text: string; tone: 'good' | 'bad' | 'neutral' }[]
  verdict: { tone: 'good' | 'bad' | 'neutral'; text: string }; good: number; bad: number }

export function DigestCard({ symbol }: { symbol: string }) {
  const { data, err } = useLoad<Digest>(`/research/${encodeURIComponent(symbol)}/digest`)
  return (
    <div className="card digest">
      <div className="row between wrap gap">
        <h3>📋 Bilanço Özeti <span className="muted small">{data?.period ? `· ${data.period}` : ''}</span></h3>
        {data && <span className={`pill ${TONE[data.verdict.tone] || 'warn'}`}>{data.good} güçlü · {data.bad} zayıf yön</span>}
      </div>
      {err && <p className="muted small">{err}</p>}
      {!data && !err && <Loading text="Finansal tablolar okunuyor…" />}
      {data && (
        <>
          <ol className="digest-list">
            {data.points.map(p => (
              <li key={p.key} className={`digest-item ${p.tone}`}>
                <span className="digest-icon" aria-hidden>{p.icon}</span>
                <div><b>{p.title}</b><span className={`digest-dot ${TONE[p.tone]}`} title={p.tone === 'good' ? 'Olumlu' : p.tone === 'bad' ? 'Olumsuz' : 'Nötr'} /><p>{p.text}</p></div>
              </li>
            ))}
          </ol>
          <div className={`digest-verdict ${data.verdict.tone}`}>{data.verdict.text}</div>
          {data.is_bank && <p className="muted small">Bankalarda mevduatlar borç sayıldığından borçluluk ve nakit akışı maddeleri gösterilmez.</p>}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Benzer hisseler */
type Similar = { symbol: string; name: string; sector: string | null; universe: number; days: number; pending?: boolean
  target: { perf_6m: number | null; vol: number | null; pe: number | null; pb: number | null }
  items: { symbol: string; name: string; sector: string | null; score: number; corr: number; perf_6m: number | null; vol: number
    pe: number | null; pb: number | null; dividend_yield: number | null; reasons: string[] }[] }

const num = (v: number | null | undefined, d = 1) => v == null ? '—' : v.toLocaleString('tr-TR', { maximumFractionDigits: d })

export function SimilarCard({ symbol, onPick }: { symbol: string; onPick?: (s: string) => void }) {
  const [data, setData] = useState<Similar | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setData(null); setErr(null)
    let alive = true, tries = 0, timer = 0
    const load = () => api<Similar>(`/research/${encodeURIComponent(symbol)}/similar`).then(d => {
      if (!alive) return
      setData(d)
      // F/K gibi oranlar arka planda hazırlanıyorsa birkaç saniye sonra (en fazla 2 kez) tekrar iste
      if (d.pending && tries++ < 2) timer = window.setTimeout(load, 6000)
    }).catch(e => { if (alive) setErr((e as Error).message) })
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [symbol])
  return (
    <div className="card">
      <h3>🧬 Benzer Hisseler <span className="muted small">· {short(symbol)} gibi hareket eden ve ona benzeyen şirketler</span></h3>
      <p className="muted small">Son 6 ayın günlük fiyat hareketi uyumu (%60), aynı sektör (%25) ve piyasa değeri yakınlığı (%15) ile puanlanır{data ? `; ${data.universe} hisse tarandı` : ''}.</p>
      {err && <p className="muted small">{err}</p>}
      {!data && !err && <Loading text="Tüm hisselerle karşılaştırılıyor…" />}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hisse</th><th className="r">Benzerlik</th><th className="r">6 ay</th><th className="r">F/K</th><th className="r">PD/DD</th><th>Neden benzer?</th></tr></thead>
            <tbody>
              <tr className="highlight">
                <td><span className="sym">{short(data.symbol)}</span> <span className="muted small">{data.name}</span></td>
                <td className="r muted small">referans</td>
                <td className={`r mono ${(data.target.perf_6m ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtPct(data.target.perf_6m)}</td>
                <td className="r mono">{num(data.target.pe)}</td><td className="r mono">{num(data.target.pb, 2)}</td><td />
              </tr>
              {data.items.map(i => (
                <tr key={i.symbol} className="clickable" onClick={() => (onPick ? onPick(i.symbol) : openStock(i.symbol))}>
                  <td><span className="sym">{short(i.symbol)}</span> <span className="muted small">{i.name}</span></td>
                  <td className="r"><div className="sim-score"><span style={{ width: `${i.score}%` }} /></div><span className="mono small">{i.score}</span></td>
                  <td className={`r mono ${(i.perf_6m ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtPct(i.perf_6m)}</td>
                  <td className="r mono">{num(i.pe)}</td><td className="r mono">{num(i.pb, 2)}</td>
                  <td className="small">{i.reasons.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Olay etkisi */
type Stat = { avg: number; median: number; hit: number; excess: number | null; n: number }
type EvGroup = { kind: string; title: string; count: number; insight: string; stats: Record<string, Stat>; avg_path: (number | null)[] | null
  events: ({ date: string; detail: string } & Record<string, number | string>)[] }
type Events = { symbol: string; name: string; benchmark: string; path_from: number; groups: EvGroup[]; since: string }

const H_LABEL: Record<string, string> = { '1': 'Olay günü', '5': '1 hafta', '20': '1 ay', '60': '3 ay', '250': '1 yıl' }
const KIND_ICON: Record<string, string> = { dividend: '💰', split: '🎁', rights: '🧾', ipo: '🚀' }

function PathChart({ path, from }: { path: (number | null)[]; from: number }) {
  const W = 520, H = 150, P = 26
  const vals = path.filter((v): v is number => v != null)
  if (vals.length < 3) return null
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const x = (i: number) => P + i / (path.length - 1) * (W - P - 8)
  const y = (v: number) => 8 + (hi - v) / span * (H - 30)
  const pts = path.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ')
  const ev = -from  // olay gününün dizideki yeri
  const last = vals[vals.length - 1]
  return (
    <svg className="ev-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Olay çevresindeki ortalama fiyat değişimi">
      <line x1={P} x2={W - 8} y1={y(0)} y2={y(0)} className="ev-zero" />
      <line x1={x(ev)} x2={x(ev)} y1={4} y2={H - 20} className="ev-day" />
      <text x={x(ev) + 4} y={14} className="ev-lbl">olay günü</text>
      <polyline points={pts} fill="none" stroke={last >= 0 ? 'var(--up)' : 'var(--down)'} strokeWidth="2.2" />
      {[0, 5, 10, 15, 20, 25].filter(i => i < path.length).map(i => (
        <text key={i} x={x(i)} y={H - 5} className="ev-lbl" textAnchor="middle">{i + from >= 0 ? `+${i + from}` : i + from}</text>
      ))}
      <text x={2} y={y(hi) + 4} className="ev-lbl">{fmtPct(hi, true)}</text>
      {lo < 0 && <text x={2} y={y(lo)} className="ev-lbl">{fmtPct(lo, true)}</text>}
    </svg>
  )
}

export function EventImpact({ symbol }: { symbol: string }) {
  const { data, err } = useLoad<Events>(`/research/${encodeURIComponent(symbol)}/events`)
  const [sel, setSel] = useState<string | null>(null)
  const g = data?.groups.find(x => x.kind === sel) ?? data?.groups[0]
  return (
    <div className="card">
      <h3>📅 Olay Etkisi Analizi</h3>
      <p className="muted small">Temettü, bedelsiz/bedelli sermaye artırımı ve halka arz gibi olaylardan sonra {short(symbol)} geçmişte ortalama ne yaptı?</p>
      {err && <p className="muted small">{err}</p>}
      {!data && !err && <Loading text="Geçmiş olaylar inceleniyor…" />}
      {data && !data.groups.length && <p className="muted">Bu hisse için incelenecek geçmiş olay bulunamadı.</p>}
      {data && g && (
        <>
          <div className="seg wrap">
            {data.groups.map(x => (
              <button key={x.kind} className={x.kind === g.kind ? 'active' : ''} onClick={() => setSel(x.kind)}>{KIND_ICON[x.kind]} {x.title.split(' (')[0]} ({x.count})</button>
            ))}
          </div>
          <div className="info-box small mt">{g.insight}</div>
          <div className="ev-stats">
            {Object.entries(g.stats).map(([h, s]) => (
              <div key={h} className="ev-stat">
                <span className="muted small">{H_LABEL[h] ?? `${h} gün`}</span>
                <b className={`mono ${s.avg >= 0 ? 'up' : 'down'}`}>{fmtPct(s.avg)}</b>
                <span className="muted small">{g.kind === 'ipo' ? 'ilk kapanışa göre' : `%${s.hit.toFixed(0)} pozitif`}</span>
                {s.excess != null && <span className={`small ${s.excess >= 0 ? 'up' : 'down'}`}>{data.benchmark}'e göre {fmtPct(s.excess)}</span>}
              </div>
            ))}
          </div>
          {g.avg_path && <><div className="muted small mt">Ortalama fiyat yolu (olaydan önceki günün kapanışı = 0, işlem günü)</div><PathChart path={g.avg_path} from={data.path_from} /></>}
          <details className="mt">
            <summary className="small">Olay listesi ({Math.min(g.events.length, 15)} / {g.count})</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tarih</th><th>Ayrıntı</th>{Object.keys(g.stats).map(h => <th key={h} className="r">{H_LABEL[h] ?? h}</th>)}</tr></thead>
                <tbody>{g.events.map(e => (
                  <tr key={e.date + e.detail}>
                    <td>{new Date(e.date).toLocaleDateString('tr-TR')}</td><td className="small">{e.detail}</td>
                    {Object.keys(g.stats).map(h => { const v = e[`r${h}`] as number | undefined; return <td key={h} className={`r mono ${v == null ? '' : v >= 0 ? 'up' : 'down'}`}>{v == null ? '—' : fmtPct(v)}</td> })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
          <p className="muted small">Temettü günü getirisine dağıtılan temettü eklenmiştir. Geçmiş davranış geleceği garanti etmez; veriler {new Date(data.since).getFullYear()} yılından itibarendir.</p>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Portföy risk uyarıcı */
type Risks = { empty: boolean; level: 'high' | 'medium' | 'ok'; summary: string
  warnings: { key: string; level: 'high' | 'medium' | 'info'; icon: string; title: string; text: string; action: string | null }[] }

export function RiskAlerts({ refresh }: { refresh?: number }) {
  const [r, setR] = useState<Risks | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => { api<Risks>('/portfolio/risks').then(setR).catch(() => setR(null)) }, [refresh])
  if (!r || r.empty) return null
  const list = all ? r.warnings : r.warnings.slice(0, 3)
  return (
    <div className={`card risk-card ${r.level}`}>
      <div className="row between wrap gap">
        <h3>{r.level === 'ok' ? '✅' : '⚠️'} Risk Uyarıcı</h3>
        <span className={`pill ${r.level === 'high' ? 'down' : r.level === 'medium' ? 'warn' : 'up'}`}>
          {r.level === 'ok' ? 'Belirgin risk yok' : `${r.warnings.filter(w => w.level !== 'info').length} uyarı`}
        </span>
      </div>
      <p className="muted small">{r.summary}</p>
      {list.length > 0 && (
        <ul className="risk-list">
          {list.map(w => (
            <li key={w.key} className={`risk-item ${w.level}`}>
              <span className="risk-icon" aria-hidden>{w.icon}</span>
              <div>
                <b>{w.title}</b>
                <p>{w.text}</p>
                {w.action && <p className="risk-action">💡 {w.action}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.warnings.length > 3 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? '▾ Daha az göster' : `▸ Tüm uyarılar (${r.warnings.length})`}</button>}
      <p className="muted small">Önemli yeni riskler günde bir kez bildirim olarak da gönderilir. Eğitim amaçlıdır; yatırım tavsiyesi değildir.</p>
    </div>
  )
}
