// Geçmiş kayıtlara dayalı kartlar: teknik sinyal sicili, tahmin günlüğü ve ekonomik olayların piyasa etkisi.
import { useEffect, useState } from 'react'
import { api, fmtPct, tone } from '../api'
import { Loading } from './common'

const p1 = (v: number | null | undefined) => v == null ? '—' : `%${v.toFixed(1).replace('.', ',')}`
const sgn = (v: number | null | undefined, d = 2) => v == null ? '—' : `${v >= 0 ? '+' : '−'}%${Math.abs(v).toFixed(d).replace('.', ',')}`

/* ------------------------------------------------------------------ Teknik sinyal sicili */
type SigStat = { avg: number; success: number; n: number; edge: number; base_success: number }
type Sig = { key: string; name: string; direction: 'up' | 'down'; description: string; count: number; stats: Record<string, SigStat>
  verdict: string; grade: 'good' | 'neutral' | 'bad' | 'none'; last_date: string | null; active: boolean; recent: { date: string; r5: number | null; r20: number | null }[] }
type Track = { symbol: string; since: string; signals: Sig[]; active: string[]; note: string; baseline: Record<string, { avg: number; up: number }> }

export function SignalTrackCard({ symbol }: { symbol: string }) {
  const [t, setT] = useState<Track | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    setT(null); setErr(null)
    api<Track>(`/signals/${encodeURIComponent(symbol)}`).then(setT).catch(e => setErr((e as Error).message))
  }, [symbol])
  const list = t ? (all ? t.signals : t.signals.slice(0, 6)) : []
  return (
    <div className="card">
      <h3>🧾 Sinyallerin Sicili <span className="muted small">· bu hissede geçmişte işe yaradılar mı?</span></h3>
      {err && <p className="muted small">{err}</p>}
      {!t && !err && <Loading text="Son 5 yılın sinyalleri sayılıyor…" />}
      {t && (
        <>
          {t.active.length > 0 && <div className="info-box small">Şu an aktif: <b>{t.active.join(', ')}</b></div>}
          <div className="table-wrap mt">
            <table className="table">
              <thead><tr><th>Sinyal</th><th className="r">Kaç kez</th><th className="r">20 gün sonra ort.</th><th className="r" title="Yükseliş sinyalinde sonraki getirinin pozitif, düşüşte negatif olma oranı">Başarı</th><th className="r">Olağan</th><th>Sonuç</th></tr></thead>
              <tbody>
                {list.map(s => {
                  const st = s.stats['20']
                  return [
                    <tr key={s.key} className={`clickable ${s.active ? 'highlight' : ''}`} onClick={() => setOpen(open === s.key ? null : s.key)}>
                      <td><span className={`pill ${s.direction === 'up' ? 'up' : 'down'}`}>{s.direction === 'up' ? '▲' : '▼'}</span> {s.name}{s.active && <span className="pill warn" style={{ marginLeft: 6 }}>şimdi</span>}</td>
                      <td className="r mono">{s.count}</td>
                      <td className={`r mono ${tone(st?.avg)}`}>{sgn(st?.avg, 1)}</td>
                      <td className="r mono">{p1(st?.success)}</td>
                      <td className="r mono muted">{p1(st?.base_success)}</td>
                      <td><span className={`sig-grade ${s.grade}`}>{s.verdict}</span></td>
                    </tr>,
                    open === s.key && (
                      <tr key={s.key + '-d'}><td colSpan={6} className="small">
                        <div className="muted">{s.description}</div>
                        {s.recent.length > 0 && <div className="mt">Son sinyaller: {s.recent.map(r => <span key={r.date} className="pill" style={{ marginRight: 4 }}>{new Date(r.date).toLocaleDateString('tr-TR')} → 5g {sgn(r.r5, 1)} · 20g {sgn(r.r20, 1)}</span>)}</div>}
                      </td></tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
          {t.signals.length > 6 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? '▾ Daha az' : `▸ Tüm sinyaller (${t.signals.length})`}</button>}
          <p className="muted small">{t.note} Veriler {new Date(t.since).getFullYear()} yılından itibaren. Geçmiş başarı geleceği garanti etmez.</p>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Tahmin günlüğü */
type JItem = { id: number; symbol: string; data_date: string; target_date: string; model: string; up_prob: number; expected_ret: number | null
  last_price: number; actual_price: number | null; actual_ret: number | null; correct: number | null; auto: number }
type Journal = { items: JItem[]; watch: string[]; max_watch: number
  stats: { total: number; resolved: number; pending: number; hits: number; accuracy: number | null; last30_accuracy: number | null; confident_accuracy: number | null; confident_n: number; streak: number }
  by_symbol: { symbol: string; n: number; hits: number; accuracy: number }[] }

export function PredictionJournalCard({ symbol, refresh }: { symbol: string; refresh: number }) {
  const [j, setJ] = useState<Journal | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => api<Journal>('/predict-journal').then(setJ).catch(() => setJ(null))
  useEffect(() => { load() }, [refresh])
  if (!j) return null
  const watching = j.watch.includes(symbol.toUpperCase())
  const toggle = async () => {
    try { await api('/predict-journal/watch', { body: { symbol, on: !watching } }); setMsg(watching ? null : `${symbol.replace('.IS', '')} her gün seans kapandıktan sonra otomatik tahmin edilecek.`); load() } catch (e) { setMsg((e as Error).message) }
  }
  const s = j.stats
  return (
    <div className="card">
      <div className="row between wrap gap">
        <h3>📒 Tahmin Günlüğüm <span className="muted small">· gerçek zamanlı sicil</span></h3>
        <button className={`btn small ${watching ? 'ghost' : 'primary'}`} onClick={toggle}>{watching ? '✓ Her gün tahmin ediliyor' : `🔁 ${symbol.replace('.IS', '')} için her gün tahmin et`}</button>
      </div>
      {msg && <div className="info-box small">{msg}</div>}
      {j.items.length === 0 ? <p className="muted small">Henüz kayıtlı tahmin yok. Yaptığınız her tahmin buraya kaydedilir; hedef gün kapanınca doğru mu yanlış mı çıktığı işaretlenir.</p> : (
        <>
          <div className="grid4 mt">
            <div className="kpi"><div className="muted small">İsabet</div><div className={`kpi-value ${(s.accuracy ?? 0) > 50 ? 'up' : 'down'}`}>{p1(s.accuracy)}</div><div className="muted small">{s.hits}/{s.resolved} sonuçlanan</div></div>
            <div className="kpi"><div className="muted small">Son 30 tahmin</div><div className="kpi-value">{p1(s.last30_accuracy)}</div></div>
            <div className="kpi"><div className="muted small">Emin olduğu (≥%60)</div><div className="kpi-value">{p1(s.confident_accuracy)}</div><div className="muted small">{s.confident_n} tahmin</div></div>
            <div className="kpi"><div className="muted small">Bekleyen · seri</div><div className="kpi-value sm">{s.pending} bekliyor · {s.streak} doğru üst üste</div></div>
          </div>
          <div className="table-wrap mt">
            <table className="table">
              <thead><tr><th>Hedef gün</th><th>Varlık</th><th className="r">Tahmin</th><th className="r">Gerçekleşen</th><th>Sonuç</th></tr></thead>
              <tbody>{j.items.slice(0, 15).map(i => (
                <tr key={i.id}>
                  <td className="small">{new Date(i.target_date + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}{i.auto ? <span className="pill" style={{ marginLeft: 4 }}>oto</span> : null}</td>
                  <td><span className="sym">{i.symbol.replace('.IS', '')}</span></td>
                  <td className={`r mono ${i.up_prob >= 50 ? 'up' : 'down'}`}>{i.up_prob >= 50 ? '▲' : '▼'} %{i.up_prob.toFixed(0)}</td>
                  <td className={`r mono ${tone(i.actual_ret)}`}>{i.actual_ret == null ? '—' : fmtPct(i.actual_ret)}</td>
                  <td>{i.correct == null ? <span className="pill">bekliyor</span> : i.correct ? <span className="pill up">✓ doğru</span> : <span className="pill down">✗ yanlış</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {j.by_symbol.length > 1 && <div className="small mt">Varlığa göre: {j.by_symbol.map(b => <span key={b.symbol} className="pill" style={{ marginRight: 4 }}>{b.symbol.replace('.IS', '')} {p1(b.accuracy)} ({b.n})</span>)}</div>}
        </>
      )}
      <p className="muted small">Otomatik tahmin listesine en fazla {j.max_watch} varlık eklenebilir{j.watch.length ? ` (şu an: ${j.watch.map(w => w.replace('.IS', '')).join(', ')})` : ''}. Sonuç, tahminin yönü ile hedef gündeki kapanışın yönü karşılaştırılarak belirlenir.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ Ekonomik olayların etkisi */
type Asset = { name: string; n: number; day_avg: number; day_up: number; day_abs: number; week_avg: number | null; week_up: number | null }
type Macro = { events: Record<string, { label: string; count: number; insight: string; assets: Record<string, Asset>
  recent: ({ date: string; detail: string } & Record<string, number | string>)[] }>; assets: Record<string, string>; errors: string[]; note: string }

export function useMacro() {
  const [m, setM] = useState<Macro | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Macro>('/macro/impact').then(setM).catch(e => setErr((e as Error).message)) }, [])
  return { m, err }
}

export function MacroImpactCard({ m, err }: { m: Macro | null; err: string | null }) {
  const [sel, setSel] = useState('tcmb_hike')
  const e = m?.events[sel]
  return (
    <div className="card">
      <h3>⚡ Olayların Piyasa Etkisi <span className="muted small">· geçmişte bu günlerde ne oldu?</span></h3>
      {err && <p className="muted small">{err}</p>}
      {!m && !err && <Loading text="Faiz kararları ve enflasyon açıklamaları işleniyor (ilk açılışta biraz sürebilir)…" />}
      {m && e && (
        <>
          <div className="seg wrap">
            {Object.entries(m.events).map(([k, v]) => <button key={k} className={k === sel ? 'active' : ''} onClick={() => setSel(k)}>{v.label} ({v.count})</button>)}
          </div>
          <div className="info-box small mt">{e.insight}</div>
          <div className="table-wrap mt">
            <table className="table">
              <thead><tr><th>Varlık</th><th className="r">Olay günü ort.</th><th className="r">Yükselme oranı</th><th className="r">Ort. hareket (±)</th><th className="r">1 hafta ort.</th></tr></thead>
              <tbody>{Object.entries(e.assets).map(([sym, a]) => (
                <tr key={sym}><td>{a.name}</td><td className={`r mono ${tone(a.day_avg)}`}>{sgn(a.day_avg)}</td><td className="r mono">%{a.day_up.toFixed(0)}</td>
                  <td className="r mono">±%{a.day_abs.toFixed(2).replace('.', ',')}</td><td className={`r mono ${tone(a.week_avg)}`}>{sgn(a.week_avg)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {e.recent.length > 0 && (
            <details className="mt"><summary className="small">Son olaylar</summary>
              <table className="table small">
                <thead><tr><th>Tarih</th><th>Ayrıntı</th><th className="r">BIST 100</th><th className="r">Dolar/TL</th><th className="r">S&P 500</th></tr></thead>
                <tbody>{e.recent.map(r => (
                  <tr key={r.date}><td>{new Date(r.date).toLocaleDateString('tr-TR')}</td><td>{r.detail}</td>
                    {['XU100.IS', 'USDTRY=X', '^GSPC'].map(k => <td key={k} className={`r mono ${tone(r[k] as number)}`}>{r[k] == null ? '—' : sgn(r[k] as number)}</td>)}</tr>
                ))}</tbody>
              </table>
            </details>
          )}
          {m.errors.length > 0 && <p className="muted small">{m.errors.join(' ')}</p>}
          <p className="muted small">{m.note}</p>
        </>
      )}
    </div>
  )
}

/** Takvimdeki bir etkinliğin yanında gösterilen kısa geçmiş etki özeti. */
export function impactHint(m: Macro | null, key: string | null | undefined): string | null {
  if (!m || !key) return null
  const pick = (k: string) => m.events[k]?.assets['XU100.IS']
  if (key === 'tcmb') {
    const h = pick('tcmb_hike'), c = pick('tcmb_cut')
    return h && c ? `Geçmişte BIST 100: faiz artırımında ort. ${sgn(h.day_avg)}, indirimde ${sgn(c.day_avg)}` : null
  }
  if (key === 'fed') {
    const h = m.events.fed_hike?.assets['^GSPC'], c = m.events.fed_cut?.assets['^GSPC']
    return h && c ? `Geçmişte S&P 500: FED artırımında ort. ${sgn(h.day_avg)}, indiriminde ${sgn(c.day_avg)}` : null
  }
  const a = pick(key), u = m.events[key]?.assets['USDTRY=X']
  return a ? `Geçmişte bu açıklama günlerinde BIST 100 ort. ${sgn(a.day_avg)} (±%${a.day_abs.toFixed(1).replace('.', ',')})${u ? `, Dolar/TL ${sgn(u.day_avg)}` : ''}` : null
}
