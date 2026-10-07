import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtPct, tone } from '../api'
import { ErrorBox } from '../components/common'
import { Skeleton } from '../components/ui'

type Sec = { sector: string; count: number; '1w': number; '1m': number; '3m': number; '6m': number; momentum: number; quadrant: string; best: string }
const QCOL: Record<string, string> = { 'Lider': '#26a69a', 'Zayıflayan': '#f5c542', 'Geride kalan': '#ef5350', 'Toparlanan': '#4c8dff' }

function Quadrant({ items }: { items: Sec[] }) {
  const W = 620, H = 380, P = 40
  const xs = items.map(i => i['3m']), ys = items.map(i => i.momentum)
  const mx = Math.max(10, ...xs.map(Math.abs)) * 1.15, my = Math.max(4, ...ys.map(Math.abs)) * 1.15
  const X = (v: number) => P + (v + mx) / (2 * mx) * (W - 2 * P), Y = (v: number) => H - P - (v + my) / (2 * my) * (H - 2 * P)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="frontier quadrant">
      <rect x={X(0)} y={P} width={W - P - X(0)} height={Y(0) - P} fill="rgba(38,166,154,0.07)" />
      <rect x={P} y={P} width={X(0) - P} height={Y(0) - P} fill="rgba(76,141,255,0.07)" />
      <rect x={P} y={Y(0)} width={X(0) - P} height={H - P - Y(0)} fill="rgba(239,83,80,0.07)" />
      <rect x={X(0)} y={Y(0)} width={W - P - X(0)} height={H - P - Y(0)} fill="rgba(245,197,66,0.07)" />
      <line x1={X(0)} x2={X(0)} y1={P} y2={H - P} className="grid-line" /><line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} className="grid-line" />
      <text x={W - P - 4} y={P + 14} textAnchor="end" className="lbl strong">Lider</text>
      <text x={P + 4} y={P + 14} className="lbl strong">Toparlanan</text>
      <text x={P + 4} y={H - P - 6} className="lbl strong">Geride kalan</text>
      <text x={W - P - 4} y={H - P - 6} textAnchor="end" className="lbl strong">Zayıflayan</text>
      {items.map(i => (
        <g key={i.sector} className="q-dot">
          <circle cx={X(i['3m'])} cy={Y(i.momentum)} r={6 + Math.min(i.count, 8)} fill={QCOL[i.quadrant]} opacity={0.75} />
          <text x={X(i['3m'])} y={Y(i.momentum) - 12} textAnchor="middle" className="lbl">{i.sector}</text>
        </g>
      ))}
      <text x={W / 2} y={H - 8} textAnchor="middle" className="axis">3 aylık getiri →</text>
      <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="axis">Momentum (hızlanma) →</text>
    </svg>
  )
}

export default function Sectors() {
  const [mkt, setMkt] = useState<'bist' | 'us'>('bist')
  const [data, setData] = useState<Sec[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nav = useNavigate()
  useEffect(() => { setData(null); api<{ sectors: Sec[] }>(`/sectors/rotation?market_key=${mkt}`).then(d => setData(d.sectors)).catch(e => setError(e.message)) }, [mkt])
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Sektör Rotasyonu</h1><p className="muted">Paranın hangi sektörlere girip hangilerinden çıktığını gösteren görünüm</p></div>
        <div className="seg"><button className={mkt === 'bist' ? 'active' : ''} onClick={() => setMkt('bist')}>Borsa İstanbul</button><button className={mkt === 'us' ? 'active' : ''} onClick={() => setMkt('us')}>ABD</button></div>
      </header>
      <ErrorBox error={error} />
      {!data ? <Skeleton rows={6} /> : (
        <div className="grid2">
          <div className="card">
            <h3>Rotasyon Haritası</h3>
            <Quadrant items={data} />
            <p className="muted small"><b>Lider:</b> orta vadede güçlü ve hızlanıyor · <b>Zayıflayan:</b> güçlü ama ivme kaybediyor · <b>Geride kalan:</b> zayıf ve yavaşlıyor · <b>Toparlanan:</b> zayıf ama ivme kazanıyor.</p>
          </div>
          <div className="card">
            <h3>Sektör Getirileri</h3>
            <table className="table">
              <thead><tr><th>Sektör</th><th className="r">1 hafta</th><th className="r">1 ay</th><th className="r">3 ay</th><th className="r">6 ay</th><th>Durum</th></tr></thead>
              <tbody>{data.map(s => (
                <tr key={s.sector} className="clickable" onClick={() => nav(`/analiz?s=${encodeURIComponent(s.best)}`)} title={`Sektörün son 1 ayda en güçlü hissesi: ${s.best}`}>
                  <td><b>{s.sector}</b> <span className="muted small">({s.count})</span></td>
                  {(['1w', '1m', '3m', '6m'] as const).map(k => <td key={k} className={`r mono ${tone(s[k])}`} style={{ background: `rgba(${s[k] >= 0 ? '38,166,154' : '239,83,80'},${Math.min(Math.abs(s[k]) / 25, 0.35)})` }}>{fmtPct(s[k])}</td>)}
                  <td><span className="pill" style={{ background: QCOL[s.quadrant] + '33', color: QCOL[s.quadrant] }}>{s.quadrant}</span></td>
                </tr>
              ))}</tbody>
            </table>
            <p className="muted small">Değerler, uygulamada izlenen hisselerin eşit ağırlıklı ortalamasıdır. Bir satıra tıklayınca sektörün son ayda en güçlü hissesi açılır.</p>
          </div>
        </div>
      )}
    </div>
  )
}
