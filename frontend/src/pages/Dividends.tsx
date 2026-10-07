import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtPct, fmtPrice, tone } from '../api'
import { ErrorBox, Loading } from '../components/common'

type Row = {
  symbol: string; name: string; sector: string | null; price: number | null; currency: string; change_pct: number | null
  pays: boolean; ttm_per_share?: number; yield_pct?: number | null; payments_12m?: number; last_date?: string; last_amount?: number
  next_ex_date?: string | null; growth_5y_pct?: number | null; streak_years?: number; paid_last_12m?: boolean
}
type History = { symbol: string; payments: { date: string; amount: number }[]; yearly: { year: number; amount: number }[] }
type SortKey = 'yield_pct' | 'ttm_per_share' | 'growth_5y_pct' | 'streak_years' | 'last_date' | 'name'

const freq = (n?: number) => !n ? '—' : n >= 4 ? 'Çeyreklik' : n >= 2 ? `Yılda ${n} kez` : 'Yıllık'

export default function Dividends() {
  const [mkt, setMkt] = useState<'bist' | 'us'>('bist')
  const [data, setData] = useState<Record<string, Row[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [onlyPayers, setOnlyPayers] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'yield_pct', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const [hist, setHist] = useState<History | null>(null)

  useEffect(() => {
    if (data[mkt]) return
    setError(null)
    api<Row[]>(`/dividends/${mkt}`).then(d => setData(x => ({ ...x, [mkt]: d }))).catch(e => setError(e.message))
  }, [mkt])
  useEffect(() => {
    setHist(null)
    if (open) api<History>(`/dividends/history/${encodeURIComponent(open)}`).then(setHist).catch(() => {})
  }, [open])

  const rows = useMemo(() => {
    const list = (data[mkt] ?? []).filter(r => !onlyPayers || r.paid_last_12m)
    return [...list].sort((a, b) => {
      if (sort.key === 'name' || sort.key === 'last_date') return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'tr') * sort.dir
      return ((a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity)) * sort.dir
    })
  }, [data, mkt, onlyPayers, sort])
  const all = data[mkt] ?? []
  const payers = all.filter(r => r.paid_last_12m)
  const avgYield = payers.length ? payers.reduce((s, r) => s + (r.yield_pct ?? 0), 0) / payers.length : null
  const upcoming = all.filter(r => r.next_ex_date).sort((a, b) => a.next_ex_date!.localeCompare(b.next_ex_date!))
  const th = (key: SortKey, label: string, cls = 'r') => (
    <th className={`${cls} sortable`} onClick={() => setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}>
      {label}{sort.key === key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
    </th>
  )
  const maxYear = Math.max(...(hist?.yearly.map(y => y.amount) ?? [1]), 1e-9)

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Temettü</h1><p className="muted">Temettü veren hisseler, verimleri, ödeme geçmişi ve yaklaşan hak kullanım tarihleri</p></div>
        <div className="row gap">
          <div className="seg">
            <button className={mkt === 'bist' ? 'active' : ''} onClick={() => { setMkt('bist'); setOpen(null) }}>Borsa İstanbul</button>
            <button className={mkt === 'us' ? 'active' : ''} onClick={() => { setMkt('us'); setOpen(null) }}>ABD Borsaları</button>
          </div>
          <Link className="btn ghost" to="/portfoy">💼 Portföyümdeki temettüler</Link>
        </div>
      </header>
      <ErrorBox error={error} />
      {!data[mkt] && !error && <Loading text="Temettü geçmişleri çekiliyor (ilk açılışta birkaç saniye sürebilir)…" />}
      {data[mkt] && (
        <>
          <div className="grid4">
            <div className="card kpi"><div className="muted small">Temettü veren hisse (son 12 ay)</div><div className="kpi-value">{payers.length} / {all.length}</div></div>
            <div className="card kpi"><div className="muted small">Ortalama temettü verimi</div><div className="kpi-value">{fmtPct(avgYield, false)}</div></div>
            <div className="card kpi"><div className="muted small">En yüksek verim</div>
              <div className="kpi-value sm">{payers.length ? [...payers].sort((a, b) => (b.yield_pct ?? 0) - (a.yield_pct ?? 0))[0].symbol.replace('.IS', '') : '—'}</div>
              <div className="muted small">{payers.length ? fmtPct([...payers].sort((a, b) => (b.yield_pct ?? 0) - (a.yield_pct ?? 0))[0].yield_pct, false) : ''}</div></div>
            <div className="card kpi"><div className="muted small">Yaklaşan hak kullanım</div>
              {upcoming.length ? upcoming.slice(0, 3).map(u => <div key={u.symbol} className="small"><b>{u.symbol.replace('.IS', '')}</b> · {u.next_ex_date}</div>) : <div className="muted small">Bilinen tarih yok</div>}</div>
          </div>

          <div className="card">
            <div className="toolbar">
              <h3>{rows.length} hisse</h3>
              <label className="toggle-row small"><input type="checkbox" checked={onlyPayers} onChange={e => setOnlyPayers(e.target.checked)} />Yalnızca son 12 ayda temettü verenler</label>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  {th('name', 'Hisse', '')}<th className="r">Fiyat</th>{th('ttm_per_share', 'Hisse başı (12 ay)')}{th('yield_pct', 'Verim')}
                  <th className="c">Sıklık</th>{th('last_date', 'Son ödeme', 'c')}<th className="c">Sonraki hak kullanım</th>{th('growth_5y_pct', '5 yıllık büyüme')}{th('streak_years', 'Kesintisiz yıl')}
                </tr></thead>
                <tbody>
                  {rows.map(r => [
                    <tr key={r.symbol} className={`clickable ${open === r.symbol ? 'highlight' : ''}`} onClick={() => setOpen(open === r.symbol ? null : r.symbol)}>
                      <td><span className="sym">{r.symbol.replace('.IS', '')}</span> <span className="muted small">{r.name}</span><div className="muted small">{r.sector}</div></td>
                      <td className="r mono">{fmtPrice(r.price)}<div className={`small ${tone(r.change_pct)}`}>{fmtPct(r.change_pct)}</div></td>
                      <td className="r mono">{r.pays ? fmtPrice(r.ttm_per_share) : '—'}</td>
                      <td className="r mono"><span className={`pill ${(r.yield_pct ?? 0) >= 5 ? 'up' : ''}`}>{r.pays ? fmtPct(r.yield_pct, false) : '—'}</span></td>
                      <td className="c small">{freq(r.payments_12m)}</td>
                      <td className="c small">{r.last_date ?? '—'}{r.last_amount ? <div className="muted">{fmtPrice(r.last_amount)}</div> : null}</td>
                      <td className="c small">{r.next_ex_date ?? '—'}</td>
                      <td className={`r mono ${tone(r.growth_5y_pct)}`}>{fmtPct(r.growth_5y_pct)}</td>
                      <td className="r mono">{r.streak_years ?? '—'}</td>
                    </tr>,
                    open === r.symbol && (
                      <tr key={r.symbol + '-d'}><td colSpan={9}>
                        {!hist ? <Loading /> : (
                          <div className="grid2">
                            <div>
                              <h3>Yıllık temettü (hisse başı)</h3>
                              <div className="div-bars">
                                {hist.yearly.map(y => (
                                  <div key={y.year} className="div-col" title={`${y.year}: ${fmtPrice(y.amount)}`}>
                                    <div className="div-bar" style={{ height: `${y.amount / maxYear * 100}%` }} />
                                    <span className="small muted">{String(y.year).slice(2)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <h3>Ödeme geçmişi</h3>
                              <table className="table"><tbody>
                                {hist.payments.slice(0, 10).map(p => <tr key={p.date}><td>{p.date}</td><td className="r mono">{fmtPrice(p.amount)} {r.currency}</td></tr>)}
                              </tbody></table>
                              <Link to={`/temel?s=${encodeURIComponent(r.symbol)}`} className="small">Temel analizini aç →</Link>
                            </div>
                          </div>
                        )}
                      </td></tr>
                    ),
                  ])}
                </tbody>
              </table>
            </div>
          </div>
          <p className="disclaimer">Tutarlar hisse başı brüt temettüdür (stopaj hariç). Bedelsiz sermaye artırımı yapan şirketlerde geçmiş tutarlar veri sağlayıcı tarafından düzeltilmiş olabilir. Kaynak: Yahoo Finance.</p>
        </>
      )}
    </div>
  )
}
