import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtPct, fmtPrice, tone, type Quote } from '../api'
import { ErrorBox, Loading, Sparkline, SymbolPicker } from '../components/common'
import { useAutoRefresh } from '../refresh'

type Alert = {
  id: number; symbol: string; condition: string; target: number | null; triggered: number; triggered_at: string | null
  created_at: string; repeat: number; note: string | null
}
type Conditions = Record<string, { label: string; needs_target: boolean }>

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Fiyat', keys: ['above', 'below', 'change_up', 'change_down', 'high_52w', 'low_52w'] },
  { title: 'Teknik', keys: ['rsi_below', 'rsi_above', 'golden_cross', 'death_cross', 'macd_up', 'macd_down', 'volume_spike'] },
  { title: 'Haber', keys: ['kap'] },
]
const PLACEHOLDER: Record<string, string> = {
  above: 'Hedef fiyat', below: 'Hedef fiyat', change_up: 'Yüzde (ör. 5)', change_down: 'Yüzde (ör. 5)',
  rsi_below: 'RSI (ör. 30)', rsi_above: 'RSI (ör. 70)', volume_spike: 'Kat (ör. 2)',
}
const DEFAULTS: Record<string, string> = { change_up: '5', change_down: '5', rsi_below: '30', rsi_above: '70', volume_spike: '2' }

function alertText(a: Alert, conds: Conditions) {
  const t = a.target
  switch (a.condition) {
    case 'above': return `Fiyat ≥ ${fmtPrice(t)}`
    case 'below': return `Fiyat ≤ ${fmtPrice(t)}`
    case 'change_up': return `Günlük yükseliş ≥ %${t}`
    case 'change_down': return `Günlük düşüş ≥ %${t}`
    case 'rsi_below': return `RSI ≤ ${t}`
    case 'rsi_above': return `RSI ≥ ${t}`
    case 'volume_spike': return `Hacim ≥ ortalamanın ${t} katı`
    default: return conds[a.condition]?.label ?? a.condition
  }
}

export default function Watchlist() {
  const [list, setList] = useState<Quote[] | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [conds, setConds] = useState<Conditions>({})
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ symbol: '', condition: 'above', target: '', repeat: false, note: '' })
  const nav = useNavigate()

  const loadAlerts = () => api<Alert[]>('/alerts').then(setAlerts).catch(() => {})
  const load = (fresh = false) => {
    api<Quote[]>(`/watchlist${fresh ? '?fresh=true' : ''}`).then(setList).catch(e => setError(e.message))
    loadAlerts()
  }
  useEffect(() => { load(); api<Conditions>('/alerts/conditions').then(setConds).catch(() => {}) }, [])
  useAutoRefresh(() => { api<Quote[]>('/watchlist').then(setList).catch(() => {}); loadAlerts() })

  const needsTarget = conds[form.condition]?.needs_target ?? true
  const addWatch = (symbol: string) => api('/watchlist', { body: { symbol } }).then(() => load())
  const delWatch = (symbol: string) => api(`/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }).then(() => load())
  const addAlert = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null)
    try {
      await api('/alerts', { body: { symbol: form.symbol, condition: form.condition, target: needsTarget ? +form.target : null, repeat: form.repeat, note: form.note || null } })
      setForm({ ...form, target: DEFAULTS[form.condition] ?? '', note: '' })
      setMsg('Alarm kuruldu.')
      loadAlerts()
    } catch (err: any) { setError(err.message) }
  }
  const delAlert = (id: number) => api(`/alerts/${id}`, { method: 'DELETE' }).then(loadAlerts)
  const checkNow = async () => {
    const fired = await api<{ message: string }[]>('/alerts/check', { method: 'POST' })
    setMsg(fired.length ? `Tetiklenen: ${fired.map(f => f.message).join(' · ')}` : 'Şu an koşulu sağlanan alarm yok.')
    loadAlerts()
  }
  const prefill = (q: Quote) => { setForm({ ...form, symbol: q.symbol, condition: 'above', target: q.price ? String(+(q.price * 1.05).toPrecision(6)) : '' }); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }
  const setCondition = (c: string) => setForm({ ...form, condition: c, target: c === form.condition ? form.target : (DEFAULTS[c] ?? '') })

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>İzleme Listesi & Alarmlar</h1><p className="muted">Takip ettiğiniz varlıklar; fiyat, teknik gösterge ve KAP alarmları</p></div>
        <button className="btn ghost" onClick={() => load(true)}>↻ Yenile</button>
      </header>
      <ErrorBox error={error} />
      {msg && <div className="info-box" onClick={() => setMsg(null)}>{msg}</div>}
      <div className="card">
        <h3>İzleme Listesi</h3>
        <SymbolPicker onChange={addWatch} placeholder="Listeye varlık ekle" />
        {!list ? <Loading /> : list.length === 0 ? <p className="muted mt">Listeniz boş.</p> : (
          <table className="table mt">
            <thead><tr><th>Varlık</th><th className="r">Fiyat</th><th className="r">Günlük</th><th className="r">Haftalık</th><th className="r">Aylık</th><th /><th /></tr></thead>
            <tbody>
              {list.map(q => (
                <tr key={q.symbol}>
                  <td className="clickable" onClick={() => nav(`/analiz?s=${encodeURIComponent(q.symbol)}`)}><div className="sym">{q.symbol}</div><div className="muted small">{q.name}</div></td>
                  <td className="r mono">{fmtPrice(q.price)}</td>
                  <td className={`r mono ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</td>
                  <td className={`r mono ${tone(q.change_1w)}`}>{fmtPct(q.change_1w)}</td>
                  <td className={`r mono ${tone(q.change_1m)}`}>{fmtPct(q.change_1m)}</td>
                  <td className="r"><Sparkline data={q.spark} /></td>
                  <td className="r nowrap">
                    <button className="btn ghost small" title="Alarm kur" onClick={() => prefill(q)}>🔔</button>
                    <button className="btn ghost small" onClick={() => delWatch(q.symbol)}>Sil</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h3>Alarm Kur</h3>
          <Link to="/ayarlar" className="small">📨 Telegram bildirimi ayarları →</Link>
        </div>
        <form onSubmit={addAlert}>
          <div className="form-grid">
            <label>Varlık<SymbolPicker value={form.symbol} onChange={s => setForm({ ...form, symbol: s })} /></label>
            <label>Koşul
              <select value={form.condition} onChange={e => setCondition(e.target.value)}>
                {GROUPS.map(g => (
                  <optgroup key={g.title} label={g.title}>
                    {g.keys.filter(k => conds[k]).map(k => <option key={k} value={k}>{conds[k].label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {needsTarget && <label>{PLACEHOLDER[form.condition] ?? 'Değer'}<input type="number" step="any" required value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} /></label>}
            <label>Not (isteğe bağlı)<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          <div className="row gap mt wrap">
            <label className="toggle-row small"><input type="checkbox" checked={form.repeat} onChange={e => setForm({ ...form, repeat: e.target.checked })} />Tekrarlayan alarm (koşul her sağlandığında, en fazla günde bir kez)</label>
            <button className="btn primary" disabled={!form.symbol}>+ Alarm kur</button>
          </div>
        </form>
        <p className="muted small mt">
          Alarmlar uygulama açıkken veya sistem tepsisindeyken dakikada bir kontrol edilir; tetiklendiğinde ekranda, Windows bildirimi olarak
          ve ayarlıysa Telegram'dan bildirilir. KAP alarmı yalnızca Borsa İstanbul hisseleri için çalışır.
        </p>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Alarmlarım ({alerts.length})</h3>
          <button className="btn ghost small" onClick={checkNow}>Şimdi kontrol et</button>
        </div>
        <table className="table">
          <thead><tr><th>Varlık</th><th>Koşul</th><th>Tür</th><th>Durum</th><th>Not</th><th /></tr></thead>
          <tbody>
            {alerts.map(a => (
              <tr key={a.id} className={a.triggered && !a.repeat ? 'dim' : ''}>
                <td className="sym clickable" onClick={() => nav(`/analiz?s=${encodeURIComponent(a.symbol)}`)}>{a.symbol}</td>
                <td>{alertText(a, conds)}</td>
                <td>{a.repeat ? <span className="pill">Tekrarlayan</span> : <span className="pill">Tek seferlik</span>}</td>
                <td>{a.triggered && !a.repeat ? <span className="pill up">Tetiklendi</span> : <span className="pill">Aktif</span>}
                  {a.triggered_at && <div className="muted small">Son: {a.triggered_at}</div>}</td>
                <td className="muted small">{a.note}</td>
                <td className="r"><button className="btn ghost small" onClick={() => delAlert(a.id)}>Sil</button></td>
              </tr>
            ))}
            {alerts.length === 0 && <tr><td colSpan={6} className="muted">Henüz alarm yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
