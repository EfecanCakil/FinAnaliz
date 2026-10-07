import { useEffect, useState } from 'react'
import { api, fmtPct, session, tone, type Quote } from '../api'
import { Sparkline } from '../components/common'
import { LivePrice } from '../components/ui'

const DEFAULTS = ['XU100.IS', 'USDTRY=X', 'GRAM-ALTIN', 'BTC-USD']

/** Her zaman üstte duran mini pencere: favoriler (yoksa temel göstergeler), 30 sn'de bir yenilenir. */
export default function Widget() {
  const [qs, setQs] = useState<Quote[]>([])
  const [t, setT] = useState<Date | null>(null)
  const load = async () => {
    try {
      let list = await api<Quote[]>('/watchlist')
      if (!list.length) list = await api<Quote[]>(`/quotes?symbols=${encodeURIComponent(DEFAULTS.join(','))}`)
      setQs(list); setT(new Date())
    } catch { /* yoksay */ }
  }
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id) }, [])
  if (!session.token) return <div className="widget"><p className="muted pad">Önce ana pencereden giriş yapın.</p></div>
  return (
    <div className="widget">
      <div className="widget-head"><span><span className="logo">◆</span> FinAnaliz</span><span className="muted tiny">{t?.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      {qs.map(q => (
        <div key={q.symbol} className="widget-row">
          <div><div className="strong small">{q.symbol.replace('.IS', '').replace('-USD', '').replace('=X', '')}</div><div className="muted tiny">{q.name}</div></div>
          <Sparkline data={q.spark} width={60} height={20} />
          <div className="r"><LivePrice value={q.price} className="small" /><div className={`tiny ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</div></div>
        </div>
      ))}
      {!qs.length && <p className="muted pad small">Yükleniyor…</p>}
    </div>
  )
}
