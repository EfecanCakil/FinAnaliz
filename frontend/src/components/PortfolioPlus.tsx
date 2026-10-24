import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtPct, fmtPrice } from '../api'
import { Loading } from './common'
import { chime } from './fx'
import { openStock } from './StockCard'

/* ------------------------------------------------------------------ Hedef fiyat & zarar sınırı */
export type Protection = { target: number | null; stop: number | null; mode: 'order' | 'alert' | null }

/** Zarar sınırı — güncel fiyat — hedef arasındaki konumu gösteren çubuk. */
export function RangeBar({ stop, price, target, compact }: { stop: number | null; price: number | null; target: number | null; compact?: boolean }) {
  if (price == null || (stop == null && target == null)) return null
  const lo = stop ?? price * 0.9, hi = target ?? price * 1.1
  const pos = Math.min(100, Math.max(0, (price - lo) / Math.max(hi - lo, 1e-9) * 100))
  return (
    <div className={`prot-range ${compact ? 'compact' : ''}`} title={`Zarar sınırı ${stop != null ? fmtPrice(stop) : '—'} · Güncel ${fmtPrice(price)} · Hedef ${target != null ? fmtPrice(target) : '—'}`}>
      <div className="prot-track"><span className="prot-dot" style={{ left: `${pos}%` }} /></div>
      {!compact && (
        <div className="row between small mono">
          <span className="down">{stop != null ? `🛡 ${fmtPrice(stop)} (${fmtPct((stop / price - 1) * 100)})` : '🛡 —'}</span>
          <span className="up">{target != null ? `🎯 ${fmtPrice(target)} (${fmtPct((target / price - 1) * 100)})` : '🎯 —'}</span>
        </div>
      )}
    </div>
  )
}

export function ProtectionEditor({ symbol, price, avgCost, quantity, currency, value, onSaved }:
  { symbol: string; price: number; avgCost: number | null; quantity: number; currency: string; value: Protection; onSaved: () => void }) {
  const has = value.target != null || value.stop != null
  const [edit, setEdit] = useState(!has)
  const [target, setTarget] = useState(value.target ? String(value.target) : '')
  const [stop, setStop] = useState(value.stop ? String(value.stop) : '')
  const [mode, setMode] = useState<'order' | 'alert'>(value.mode ?? 'order')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dec = price < 10 ? 3 : 2
  const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(v) && v > 0 ? v : null }
  const t = num(target), s = num(stop)
  const pnlAt = (p: number) => (p - (avgCost ?? price)) * quantity
  const pnlText = (p: number) => { const v = pnlAt(p); return <b className={v >= 0 ? 'up' : 'down'}>{fmtMoney(Math.abs(v), currency)} {v >= 0 ? 'kâr' : 'zarar'}</b> }

  const save = async (clear = false) => {
    setBusy(true); setErr(null)
    try {
      await api('/portfolio/protection', { body: { symbol, target: clear ? null : t, stop: clear ? null : s, mode } })
      if (!clear) window.dispatchEvent(new Event('finanaliz:alarm-set')); else chime('info')
      window.dispatchEvent(new Event('finanaliz:orders-changed'))
      setEdit(false); onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!edit && has) return (
    <div className="prot-box">
      <div className="row between"><b className="small">🛡 Hedef & zarar sınırı</b><span className="pill">{value.mode === 'order' ? 'Otomatik satış' : 'Bildirim'}</span></div>
      <RangeBar stop={value.stop} price={price} target={value.target} />
      <div className="row gap">
        <button className="btn ghost small" onClick={() => setEdit(true)}>Düzenle</button>
        <button className="btn ghost small danger" onClick={() => save(true)} disabled={busy}>Kaldır</button>
      </div>
    </div>
  )

  return (
    <div className="prot-box">
      <b className="small">🛡 Hedef & zarar sınırı belirle</b>
      <p className="muted small">Fiyat hedefe ulaşınca kârınızı alın, zarar sınırına inince kaybınızı sınırlayın.</p>
      <label className="small">🎯 Hedef fiyat (kâr al)
        <input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder={`ör. ${(price * 1.1).toFixed(dec)}`} />
      </label>
      <div className="chips">{[5, 10, 20, 50].map(p => <button key={p} className="chip" onClick={() => setTarget((price * (1 + p / 100)).toFixed(dec))}>+%{p}</button>)}</div>
      <label className="small">🛡 Zarar sınırı (zarar durdur)
        <input inputMode="decimal" value={stop} onChange={e => setStop(e.target.value)} placeholder={`ör. ${(price * 0.95).toFixed(dec)}`} />
      </label>
      <div className="chips">
        {[3, 5, 10, 20].map(p => <button key={p} className="chip" onClick={() => setStop((price * (1 - p / 100)).toFixed(dec))}>−%{p}</button>)}
        {avgCost != null && avgCost < price && <button className="chip" onClick={() => setStop(avgCost.toFixed(dec))} title="Fiyat alış maliyetinize inerse sat: bu pozisyonda zarar etmezsiniz">Maliyetim ({fmtPrice(avgCost)})</button>}
      </div>
      <div className="seg">
        <button className={mode === 'order' ? 'active' : ''} onClick={() => setMode('order')} title="Seviyeye gelince tüm pozisyon otomatik satılır; biri gerçekleşince diğeri iptal olur">Otomatik sat</button>
        <button className={mode === 'alert' ? 'active' : ''} onClick={() => setMode('alert')} title="Yalnızca bildirim gelir; satış kararını siz verirsiniz">Sadece haber ver</button>
      </div>
      {(t || s) && (
        <ul className="prot-summary small">
          {t && <li>Fiyat <b className="mono">{fmtPrice(t)}</b>'e çıkarsa {mode === 'order' ? `${quantity.toLocaleString('tr-TR')} adetin tamamı satılır` : 'bildirim alırsınız'} → toplam {pnlText(t)}.</li>}
          {s && <li>Fiyat <b className="mono">{fmtPrice(s)}</b>'e inerse {mode === 'order' ? 'tamamı satılır' : 'bildirim alırsınız'} → toplam {pnlText(s)}.</li>}
        </ul>
      )}
      {err && <div className="error-box">{err}</div>}
      <div className="row gap">
        <button className="btn primary small" disabled={busy || (!t && !s)} onClick={() => save()}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
        {has && <button className="btn ghost small" onClick={() => setEdit(false)}>Vazgeç</button>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Portföy sağlık skoru */
type Health = { empty: boolean; score: number; grade: string
  components: { key: string; title: string; weight: number; score: number; status: string; tip: string | null; gain: number }[]
  tips: { title: string; text: string; gain: number }[]; sectors: { label: string; pct: number }[] }

export function HealthCard({ refresh }: { refresh?: number }) {
  const [h, setH] = useState<Health | null>(null)
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => { api<Health>('/portfolio/health').then(setH).catch(() => setH(null)) }, [refresh, tick])
  useEffect(() => {  // koruma (zarar sınırı) değişince skor yeniden hesaplanır
    const h = () => setTick(t => t + 1)
    window.addEventListener('finanaliz:orders-changed', h)
    return () => window.removeEventListener('finanaliz:orders-changed', h)
  }, [])
  if (!h) return <div className="card"><Loading text="Portföy sağlığı hesaplanıyor…" /></div>
  if (h.empty) return null
  const color = h.score >= 80 ? 'var(--up)' : h.score >= 65 ? '#2ec4b6' : h.score >= 50 ? '#f5a623' : 'var(--down)'
  const C = 2 * Math.PI * 42
  return (
    <div className="card health-card">
      <div className="health-top">
        <div className="health-ring" title="100 üzerinden portföy sağlık skoru">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" className="hr-bg" />
            <circle cx="50" cy="50" r="42" className="hr-fg" style={{ stroke: color, strokeDasharray: C, strokeDashoffset: C * (1 - h.score / 100) }} />
          </svg>
          <div><b style={{ color }}>{h.score}</b><span className="muted small">/100</span></div>
        </div>
        <div className="health-main">
          <h3>🩺 Portföy Sağlığı: <span style={{ color }}>{h.grade}</span></h3>
          <p className="muted small">Çeşitlendirme, sektör dağılımı, risk, koruma, nakit ve kur dengesine göre hesaplanır.</p>
          {h.tips.length > 0 && (
            <ul className="health-tips">
              {h.tips.map(t => <li key={t.title}><span className="pill up">+{t.gain} puana kadar</span> {t.text}</li>)}
            </ul>
          )}
          <button className="link-btn" onClick={() => setOpen(!open)}>{open ? '▾ Ayrıntıları gizle' : '▸ Puanın nasıl hesaplandı?'}</button>
        </div>
      </div>
      {open && (
        <div className="health-comps">
          {h.components.map(c => (
            <div key={c.key} className="health-comp">
              <div className="row between small"><b>{c.title}</b><span className="muted">ağırlık %{c.weight} · {c.score}/100</span></div>
              <div className="hc-bar"><span style={{ width: `${c.score}%`, background: c.score >= 80 ? 'var(--up)' : c.score >= 50 ? '#f5a623' : 'var(--down)' }} /></div>
              <div className="muted small">{c.status}</div>
            </div>
          ))}
          <p className="muted small">Bu skor portföyün yapısına dair eğitim amaçlı bir değerlendirmedir; yatırım tavsiyesi değildir.</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Temettü takvimi */
type Cal = { events: { symbol: string; name: string; date: string; pay_date: string | null; status: 'kesin' | 'tahmini'; per_share: number; quantity: number; currency: string; amount: number; amount_try: number }[]
  months: { month: string; total_try: number }[]; expected_try: number; received_12m_try: number; payers: number; holdings: number }

export function DividendCalendar() {
  const [c, setC] = useState<Cal | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Cal>('/portfolio/dividend-calendar').then(setC).catch(e => setErr(e.message)) }, [])
  if (err) return <div className="error-box">{err}</div>
  if (!c) return <Loading text="Temettü takvimi hazırlanıyor (ilk açılışta biraz sürebilir)…" />
  const max = Math.max(...c.months.map(m => m.total_try), 1)
  const monthName = (m: string) => new Date(m + '-01').toLocaleDateString('tr-TR', { month: 'short' })
  return (
    <div className="div-cal">
      <div className="grid3">
        <div className="card kpi"><div className="muted small">Önümüzdeki 12 ayda beklenen</div><div className="kpi-value">{fmtMoney(c.expected_try, 'TRY')}</div>
          <div className="muted small">{c.payers} / {c.holdings} hissenizden</div></div>
        <div className="card kpi"><div className="muted small">Son 12 ayda alınan</div><div className="kpi-value">{fmtMoney(c.received_12m_try, 'TRY')}</div></div>
        <div className="card kpi"><div className="muted small">Aylık ortalama (beklenen)</div><div className="kpi-value">{fmtMoney(c.expected_try / 12, 'TRY')}</div></div>
      </div>
      <div className="dcal-bars" aria-label="Aylara göre beklenen temettü">
        {c.months.map(m => (
          <div key={m.month} className="dcal-bar" title={`${monthName(m.month)}: ${fmtMoney(m.total_try, 'TRY')}`}>
            <span style={{ height: `${Math.max(m.total_try > 0 ? 6 : 0, m.total_try / max * 100)}%` }} />
            <small>{monthName(m.month)}</small>
          </div>
        ))}
      </div>
      {c.events.length === 0 ? <p className="muted">Portföyünüzdeki hisseler için önümüzdeki 12 ayda beklenen temettü bulunamadı.</p> : (
        <table className="table">
          <thead><tr><th>Tarih</th><th>Hisse</th><th className="c">Durum</th><th className="r">Hisse başı</th><th className="r">Adet</th><th className="r">Tahmini tutar</th></tr></thead>
          <tbody>{c.events.map((e, i) => (
            <tr key={i}>
              <td>{new Date(e.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
              <td className="clickable" onClick={() => openStock(e.symbol)}><span className="sym">{e.symbol.replace('.IS', '')}</span> <span className="muted small">{e.name}</span></td>
              <td className="c"><span className={`pill ${e.status === 'kesin' ? 'up' : ''}`} title={e.status === 'kesin' ? 'Şirketin açıkladığı hak kullanım tarihi' : 'Geçmiş ödeme düzenine göre tahmin; tarih ve tutar değişebilir'}>{e.status === 'kesin' ? 'Kesin' : 'Tahmini'}</span></td>
              <td className="r mono">{fmtPrice(e.per_share)} {e.currency}</td>
              <td className="r mono">{e.quantity.toLocaleString('tr-TR')}</td>
              <td className="r mono">{fmtMoney(e.amount_try, 'TRY')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="muted small">"Tahmini" kayıtlar şirketin son bir yıldaki ödeme düzeninden hesaplanır; şirket temettü kararını değiştirebilir. Tutarlar bugünkü adet ve kurla hesaplanmıştır.</p>
    </div>
  )
}
