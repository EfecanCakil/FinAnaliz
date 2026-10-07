import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtPrice } from '../api'
import { ErrorBox, SymbolPicker } from '../components/common'
import { Skeleton } from '../components/ui'

type Bot = {
  id: number; symbol: string; strategy: string; strategy_name: string; params: Record<string, number>; amount_try: number
  active: number; position_qty: number; last_action_date: string | null; last_message: string | null; created_at: string
  trades: { id: number; side: string; quantity: number; price: number; date: string; amount_try: number }[]
}

export default function Bots() {
  const [bots, setBots] = useState<Bot[] | null>(null)
  const [strategies, setStrategies] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ symbol: '', strategy: 'sma_cross', amount: '10000' })
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => api<Bot[]>('/bots').then(setBots).catch(e => setError(e.message))
  useEffect(() => { load(); api<Record<string, string>>('/backtest/strategies').then(s => { const { buy_hold, ...rest } = s; void buy_hold; setStrategies(rest) }).catch(() => {}) }, [])
  useEffect(() => {
    setPreview(null)
    if (form.symbol) api<{ label: string }>(`/bots/preview?symbol=${encodeURIComponent(form.symbol)}&strategy=${form.strategy}`).then(r => setPreview(r.label)).catch(() => {})
  }, [form.symbol, form.strategy])

  const create = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null)
    try { await api('/bots', { body: { symbol: form.symbol, strategy: form.strategy, amount_try: +form.amount } }); setMsg('Bot başlatıldı. Sinyal oluştuğunda sanal hesabınızda işlem yapacak.'); load() }
    catch (err: any) { setError(err.message) }
  }
  const toggle = (b: Bot) => api(`/bots/${b.id}/toggle?active=${!b.active}`, { method: 'POST' }).then(load)
  const remove = (b: Bot) => { if (confirm(`Bot #${b.id} silinsin mi? (Botun açtığı pozisyon portföyünüzde kalır.)`)) api(`/bots/${b.id}`, { method: 'DELETE' }).then(load) }

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Strateji Botları</h1><p className="muted">Strateji testindeki kuralları sanal hesabınızda otomatik çalıştırın</p></div>
        <Link className="btn ghost" to="/backtest">⏱ Önce strateji testi yap</Link>
      </header>
      <ErrorBox error={error} />
      {msg && <div className="info-box" onClick={() => setMsg(null)}>{msg}</div>}
      <form className="card" onSubmit={create}>
        <h3>Yeni Bot</h3>
        <div className="form-grid">
          <label>Varlık<SymbolPicker value={form.symbol} onChange={s => setForm({ ...form, symbol: s })} /></label>
          <label>Strateji<select value={form.strategy} onChange={e => setForm({ ...form, strategy: e.target.value })}>
            {Object.entries(strategies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>İşlem başına tutar (TL)<input type="number" min="100" step="any" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
        </div>
        {preview && <p className="small mt">Şu anki sinyal: <b>{preview}</b></p>}
        <button className="btn primary mt" disabled={!form.symbol}>🤖 Botu başlat</button>
        <p className="muted small mt">Bot dakikada bir günlük verilerle stratejinin sinyalini kontrol eder. Sinyal "pozisyonda ol" olduğunda belirlediğiniz tutar kadar alır,
          sinyal döndüğünde botun aldığı adedi satar. Bir bot günde en fazla bir işlem yapar; her işlem bildirim olarak gelir. Bu bir eğitim simülasyonudur.</p>
      </form>
      <div className="card">
        <h3>Botlarım</h3>
        {!bots ? <Skeleton rows={3} /> : bots.length === 0 ? <p className="muted">Henüz bot yok.</p> : (
          <div className="bot-list">
            {bots.map(b => (
              <div key={b.id} className={`bot ${b.active ? '' : 'paused'}`}>
                <div className="row between wrap gap">
                  <div><span className="pill">#{b.id}</span> <span className="sym">{b.symbol.replace('.IS', '')}</span> · {b.strategy_name}
                    <div className="muted small">İşlem başına {fmtMoney(b.amount_try, 'TRY')} · Pozisyon: {b.position_qty > 0 ? `${b.position_qty.toLocaleString('tr-TR')} adet` : 'yok'}</div>
                    {b.last_message && <div className="small">Son durum ({b.last_action_date}): {b.last_message}</div>}</div>
                  <div className="row gap">
                    <span className={`status ${b.active ? 'on' : ''}`}><span className="status-dot" />{b.active ? 'Çalışıyor' : 'Durduruldu'}</span>
                    <button className="btn ghost small" onClick={() => toggle(b)}>{b.active ? 'Durdur' : 'Başlat'}</button>
                    <button className="btn ghost small" onClick={() => remove(b)}>Sil</button>
                  </div>
                </div>
                {b.trades.length > 0 && (
                  <table className="table mt"><tbody>
                    {b.trades.map(t => <tr key={t.id}><td className="small">{t.date}</td><td><span className={`pill ${t.side === 'buy' ? 'up' : 'down'}`}>{t.side === 'buy' ? 'Alış' : 'Satış'}</span></td>
                      <td className="r mono">{t.quantity.toLocaleString('tr-TR')} @ {fmtPrice(t.price)}</td><td className="r mono">{fmtMoney(Math.abs(t.amount_try), 'TRY')}</td></tr>)}
                  </tbody></table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
