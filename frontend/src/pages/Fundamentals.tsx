import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtPct, fmtPrice } from '../api'
import { Disclaimer, ErrorBox, Loading, SymbolPicker } from '../components/common'

type Ratios = Record<string, number | null>
type Stmt = { period: string; revenue: number | null; gross_profit: number | null; operating_income: number | null; net_income: number | null }
type Fund = {
  symbol: string; name: string; sector: string | null; industry: string | null; website: string | null; employees: number | null
  description: string | null; currency: string; financial_currency: string; fx_applied: number | null
  price: number | null; market_cap: number | null; shares: number | null; high_52w: number | null; low_52w: number | null
  ratios: Ratios; scores: Record<string, number | null>; revenue_ttm: number | null; net_income_ttm: number | null
  target_price: number | null; recommendation: string | null; analyst_count: number | null
  quarterly: Stmt[]; annual: Stmt[]
}
type Peer = { symbol: string; name: string; market_cap: number | null } & Ratios

const RATIO_GROUPS: { title: string; items: { key: string; label: string; kind: 'x' | 'pct' | 'num'; hint: string }[] }[] = [
  { title: 'Değerleme', items: [
    { key: 'pe', label: 'F/K', kind: 'x', hint: 'Piyasa değeri / net kâr. Düşük olması kârına göre ucuz olduğunu gösterebilir.' },
    { key: 'forward_pe', label: 'İleriye dönük F/K', kind: 'x', hint: 'Analistlerin beklenen kâr tahminine göre F/K.' },
    { key: 'pb', label: 'PD/DD', kind: 'x', hint: 'Piyasa değeri / defter (özkaynak) değeri.' },
    { key: 'ps', label: 'F/S', kind: 'x', hint: 'Piyasa değeri / yıllık satışlar.' },
    { key: 'ev_ebitda', label: 'FD/FAVÖK', kind: 'x', hint: 'Firma değeri / faiz, amortisman ve vergi öncesi kâr.' },
    { key: 'eps', label: 'Hisse başı kâr', kind: 'num', hint: 'Son 12 ay net kâr / hisse sayısı.' },
  ] },
  { title: 'Kârlılık', items: [
    { key: 'profit_margin', label: 'Net kâr marjı', kind: 'pct', hint: 'Net kâr / satışlar.' },
    { key: 'operating_margin', label: 'Faaliyet kâr marjı', kind: 'pct', hint: 'Esas faaliyet kârı / satışlar.' },
    { key: 'roe', label: 'Özkaynak kârlılığı (ROE)', kind: 'pct', hint: 'Net kâr / özkaynaklar.' },
    { key: 'roa', label: 'Aktif kârlılığı (ROA)', kind: 'pct', hint: 'Net kâr / toplam varlıklar.' },
  ] },
  { title: 'Büyüme', items: [
    { key: 'revenue_growth', label: 'Satış büyümesi (yıllık)', kind: 'pct', hint: 'Son çeyrek satışlarının geçen yılın aynı çeyreğine göre değişimi.' },
    { key: 'earnings_growth', label: 'Kâr büyümesi (yıllık)', kind: 'pct', hint: 'Son çeyrek kârının geçen yılın aynı çeyreğine göre değişimi.' },
  ] },
  { title: 'Finansal sağlık ve temettü', items: [
    { key: 'debt_to_equity', label: 'Borç / Özkaynak', kind: 'num', hint: 'Toplam borç / özkaynak (%). Yüksekse kaldıraç fazladır.' },
    { key: 'current_ratio', label: 'Cari oran', kind: 'num', hint: 'Dönen varlıklar / kısa vadeli borçlar. 1\'in üzeri genelde olumludur.' },
    { key: 'dividend_yield', label: 'Temettü verimi (12 ay)', kind: 'pct', hint: 'Son 12 ayda ödenen temettü / fiyat.' },
    { key: 'payout_ratio', label: 'Dağıtım oranı', kind: 'pct', hint: 'Kârın temettü olarak dağıtılan kısmı.' },
    { key: 'beta', label: 'Beta', kind: 'num', hint: 'Piyasaya göre oynaklık.' },
  ] },
]

const REC: Record<string, string> = { strong_buy: 'Güçlü Al', buy: 'Al', hold: 'Tut', underperform: 'Endeksin altında', sell: 'Sat', none: '—' }

export function fmtBig(v: number | null | undefined, ccy = '') {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  const f = (x: number, s: string) => `${x.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${s}${ccy ? ' ' + ccy : ''}`
  return a >= 1e12 ? f(v / 1e12, 'Tr') : a >= 1e9 ? f(v / 1e9, 'Mr') : a >= 1e6 ? f(v / 1e6, 'Mn') : f(v, '')
}
const fmtRatio = (v: number | null | undefined, kind: 'x' | 'pct' | 'num') =>
  v === null || v === undefined ? '—' : kind === 'pct' ? fmtPct(v, false) : kind === 'x' ? `${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}×` : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })

function Bars({ rows, ccy }: { rows: Stmt[]; ccy: string }) {
  const max = Math.max(...rows.flatMap(r => [Math.abs(r.revenue ?? 0), Math.abs(r.net_income ?? 0)]), 1)
  return (
    <div className="fin-bars">
      {rows.map(r => (
        <div key={r.period} className="fin-col">
          <div className="fin-stack">
            <div className="fin-bar rev" style={{ height: `${Math.abs(r.revenue ?? 0) / max * 100}%` }} title={`Satışlar: ${fmtBig(r.revenue, ccy)}`} />
            <div className={`fin-bar ${(r.net_income ?? 0) >= 0 ? 'net' : 'neg'}`} style={{ height: `${Math.abs(r.net_income ?? 0) / max * 100}%` }} title={`Net kâr: ${fmtBig(r.net_income, ccy)}`} />
          </div>
          <div className="small muted">{r.period}</div>
          <div className="small mono">{fmtBig(r.net_income)}</div>
        </div>
      ))}
    </div>
  )
}

export default function Fundamentals() {
  const [params, setParams] = useSearchParams()
  const symbol = params.get('s') || 'THYAO.IS'
  const [data, setData] = useState<Fund | null>(null)
  const [peers, setPeers] = useState<Peer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'quarterly' | 'annual'>('quarterly')

  useEffect(() => {
    setData(null); setPeers(null); setError(null)
    api<Fund>(`/fundamentals/${encodeURIComponent(symbol)}`).then(setData).catch(e => setError(e.message))
    api<Peer[]>(`/fundamentals/${encodeURIComponent(symbol)}/peers`).then(setPeers).catch(() => setPeers([]))
  }, [symbol])

  const r = data?.ratios
  const stmts = data ? data[period] : []
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Temel Analiz</h1><p className="muted">Şirketin değerlemesi, kârlılığı, büyümesi, finansal sağlığı ve sektör karşılaştırması</p></div>
        <div className="row gap">
          <SymbolPicker value={symbol} onChange={s => setParams({ s })} />
          <Link className="btn ghost" to={`/analiz?s=${encodeURIComponent(symbol)}`}>📈 Teknik analiz</Link>
        </div>
      </header>
      <ErrorBox error={error} />
      {!data && !error && <Loading text="Şirket verileri ve finansal tablolar çekiliyor…" />}
      {data && r && (
        <>
          <div className="card">
            <div className="row between wrap gap">
              <div>
                <span className="title-sym">{data.symbol.replace('.IS', '')}</span> <span className="muted">{data.name}</span>
                <div className="muted small">{[data.sector, data.industry].filter(Boolean).join(' · ')}{data.employees ? ` · ${data.employees.toLocaleString('tr-TR')} çalışan` : ''}</div>
              </div>
              <div className="stats compact">
                <div className="stat"><div className="stat-label">Fiyat</div><div className="stat-value">{fmtPrice(data.price)} <small>{data.currency}</small></div></div>
                <div className="stat"><div className="stat-label">Piyasa değeri</div><div className="stat-value">{fmtBig(data.market_cap, data.currency)}</div></div>
                <div className="stat"><div className="stat-label">Satışlar (12 ay)</div><div className="stat-value">{fmtBig(data.revenue_ttm, data.currency)}</div></div>
                <div className="stat"><div className="stat-label">Net kâr (12 ay)</div><div className={`stat-value ${(data.net_income_ttm ?? 0) < 0 ? 'down' : ''}`}>{fmtBig(data.net_income_ttm, data.currency)}</div></div>
              </div>
            </div>
            {data.fx_applied && <div className="info-box small mt">Şirket finansallarını {data.financial_currency} cinsinden raporluyor; oranlar güncel kur ({fmtPrice(data.fx_applied)}) ile {data.currency}'ye çevrilerek hesaplandı.</div>}
          </div>

          <div className="grid4">
            {Object.entries(data.scores).map(([k, v]) => (
              <div key={k} className="card kpi">
                <div className="muted small">{k}</div>
                <div className={`kpi-value ${v === null ? '' : v >= 60 ? 'up' : v < 35 ? 'down' : 'warn'}`}>{v === null ? '—' : `${v}/100`}</div>
                <div className="prob neutral"><div style={{ width: `${v ?? 0}%` }} /></div>
              </div>
            ))}
          </div>

          <div className="grid2">
            {RATIO_GROUPS.map(g => (
              <div key={g.title} className="card">
                <h3>{g.title}</h3>
                <table className="table">
                  <tbody>
                    {g.items.map(it => (
                      <tr key={it.key} title={it.hint}>
                        <td>{it.label}<div className="muted small">{it.hint}</div></td>
                        <td className={`r mono ${it.kind === 'pct' && (r[it.key] ?? 0) < 0 ? 'down' : ''}`}>{fmtRatio(r[it.key], it.kind)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="grid2">
            <div className="card">
              <div className="row between">
                <h3>Satışlar ve Net Kâr ({data.currency})</h3>
                <div className="seg">
                  <button className={period === 'quarterly' ? 'active' : ''} onClick={() => setPeriod('quarterly')}>Çeyreklik</button>
                  <button className={period === 'annual' ? 'active' : ''} onClick={() => setPeriod('annual')}>Yıllık</button>
                </div>
              </div>
              {stmts.length ? <Bars rows={stmts} ccy="" /> : <p className="muted">Finansal tablo verisi yok.</p>}
              <div className="row gap small mt"><span><span className="dot" style={{ background: 'var(--accent)' }} /> Satışlar</span><span><span className="dot" style={{ background: 'var(--up)' }} /> Net kâr</span><span><span className="dot" style={{ background: 'var(--down)' }} /> Net zarar</span></div>
            </div>
            <div className="card">
              <h3>Analist Beklentisi ve Şirket</h3>
              <div className="stats">
                <div className="stat"><div className="stat-label">Ortalama hedef fiyat</div><div className="stat-value">{fmtPrice(data.target_price)}</div></div>
                <div className="stat"><div className="stat-label">Potansiyel</div><div className="stat-value">{data.target_price && data.price ? fmtPct((data.target_price / data.price - 1) * 100) : '—'}</div></div>
                <div className="stat"><div className="stat-label">Analist görüşü</div><div className="stat-value sm">{REC[data.recommendation ?? 'none'] ?? data.recommendation}{data.analyst_count ? ` (${data.analyst_count})` : ''}</div></div>
                <div className="stat"><div className="stat-label">52H aralık</div><div className="stat-value sm">{fmtPrice(data.low_52w)} – {fmtPrice(data.high_52w)}</div></div>
              </div>
              {data.description && <p className="small muted clamp5">{data.description}</p>}
              {data.website && <a className="small" href={data.website} target="_blank" rel="noreferrer">{data.website}</a>}
            </div>
          </div>

          <div className="card">
            <h3>Sektör Karşılaştırması</h3>
            {!peers ? <Loading /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Şirket</th><th className="r">Piyasa değeri</th><th className="r">F/K</th><th className="r">PD/DD</th><th className="r">F/S</th><th className="r">Net marj</th><th className="r">ROE</th><th className="r">Satış büyümesi</th><th className="r">Temettü verimi</th></tr></thead>
                  <tbody>
                    {peers.map(p => (
                      <tr key={p.symbol} className={p.symbol === symbol ? 'highlight clickable' : 'clickable'} onClick={() => setParams({ s: p.symbol })}>
                        <td><span className="sym">{p.symbol.replace('.IS', '')}</span> <span className="muted small">{p.name}</span></td>
                        <td className="r mono">{fmtBig(p.market_cap)}</td>
                        <td className="r mono">{fmtRatio(p.pe, 'x')}</td><td className="r mono">{fmtRatio(p.pb, 'x')}</td><td className="r mono">{fmtRatio(p.ps, 'x')}</td>
                        <td className="r mono">{fmtRatio(p.profit_margin, 'pct')}</td><td className="r mono">{fmtRatio(p.roe, 'pct')}</td>
                        <td className="r mono">{fmtRatio(p.revenue_growth, 'pct')}</td><td className="r mono">{fmtRatio(p.dividend_yield, 'pct')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="disclaimer">Veriler Yahoo Finance'ten alınır ve gecikmeli ya da eksik olabilir. Puanlar basit eşiklere dayalı bir özettir; yatırım tavsiyesi değildir.</p>
        </>
      )}
      {!data && <Disclaimer />}
    </div>
  )
}
