import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtPct, fmtPrice, fmtVolume, marketStatus, tone, type Quote } from '../api'
import { Disclaimer, ErrorBox, Loading, Sparkline } from '../components/common'
import { ExportButton } from '../components/extras'
import { useAutoRefresh } from '../refresh'
import { TradeModal } from '../components/TradePanel'
import { LivePrice, Treemap } from '../components/ui'

type MarketRes = {
  key: string; name: string; quotes: Quote[]
  breadth: { up: number; down: number; flat: number }
  sectors: { sector: string; avg_change_pct: number; count: number }[]
}

const INFO: Record<string, { title: string; desc: string; unit: string }> = {
  bist: { title: 'Borsa İstanbul', desc: 'BIST endeksleri ve sektörlerine göre öne çıkan hisseler (TL)', unit: 'Hisse' },
  us: { title: 'ABD Borsaları', desc: 'NYSE ve NASDAQ endeksleri ile büyük şirket hisseleri (USD)', unit: 'Hisse' },
  fx: { title: 'Döviz & Emtia', desc: 'TL kurları, çapraz kurlar, altın, gümüş, petrol ve diğer emtialar', unit: 'Varlık' },
  crypto: { title: 'Kripto Paralar', desc: 'Piyasa değeri büyük kripto paralar ve altcoinler (USD)', unit: 'Kripto' },
}

type SortKey = 'name' | 'price' | 'change_pct' | 'change_1w' | 'change_1m' | 'change_ytd' | 'change_1y' | 'volume'

/** Değişim yüzdesine göre ısı haritası rengi (kırmızı → gri → yeşil). */
function heat(v: number | null | undefined) {
  if (v === null || v === undefined) return 'rgba(139,150,168,0.15)'
  const a = Math.min(Math.abs(v) / 4, 1) * 0.75 + 0.12
  return v >= 0 ? `rgba(38,166,154,${a})` : `rgba(239,83,80,${a})`
}

export default function Market({ market }: { market: string }) {
  const [data, setData] = useState<MarketRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)
  const [watch, setWatch] = useState<Set<string>>(new Set())
  const [sector, setSector] = useState<string>('Tümü')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'change_pct', dir: -1 })
  const [view, setView] = useState<'table' | 'heatmap' | 'treemap'>('table')
  const hasAll = market === 'bist' || market === 'us'
  const [scope, setScope] = useState<'featured' | 'all'>('featured')
  const [all, setAll] = useState<{ quotes: Quote[]; fetched_at: number | null; refreshing: boolean; error: string | null } | null>(null)
  const [limit, setLimit] = useState(100)
  const [trade, setTrade] = useState<string | null>(null)
  const nav = useNavigate()
  const info = INFO[market]
  const status = marketStatus(market)

  const [busy, setBusy] = useState(false)
  const load = (fresh = false) => {
    setBusy(true)
    return api<MarketRes>(`/market/${market}${fresh ? '?fresh=true' : ''}`).then(d => { setData(d); setUpdated(new Date()); setError(null) })
      .catch(e => setError(e.message)).finally(() => setBusy(false))
  }
  const loadAll = (fresh = false) => {
    if (!hasAll) return
    api<typeof all>(`/market/${market}/all${fresh ? '?fresh=true' : ''}`).then(d => {
      setAll(d)
      if (d?.refreshing) setTimeout(() => api<typeof all>(`/market/${market}/all`).then(setAll).catch(() => {}), 8000)
    }).catch(e => setError(e.message))
  }
  useAutoRefresh(() => { load(); if (scope === 'all') loadAll() })
  useEffect(() => { if (scope === 'all') loadAll() }, [scope, market])
  useEffect(() => {
    setData(null); setSector('Tümü'); setQuery(''); setAll(null); setLimit(100)
    if (!hasAll) setScope('featured')
    load()
    api<Quote[]>('/watchlist').then(l => setWatch(new Set(l.map(q => q.symbol)))).catch(() => {})
  }, [market])

  const toggleWatch = async (s: string) => {
    if (watch.has(s)) await api(`/watchlist/${encodeURIComponent(s)}`, { method: 'DELETE' })
    else await api('/watchlist', { body: { symbol: s } })
    setWatch(w => { const n = new Set(w); n.has(s) ? n.delete(s) : n.add(s); return n })
  }
  const open = (s: string) => nav(`/analiz?s=${encodeURIComponent(s)}`)

  const indices = data?.quotes.filter(q => q.is_index) ?? []
  const featured = data?.quotes.filter(q => !q.is_index) ?? []
  const assets = scope === 'all' && all ? all.quotes.filter(q => q.price !== null) : featured
  const sectors = ['Tümü', ...Array.from(new Set(assets.map(q => q.sector ?? 'Diğer')))]
  const hasVolume = market !== 'fx' && assets.some(q => q.volume)

  const rows = useMemo(() => {
    const ql = query.toLowerCase()
    const list = assets.filter(q => (sector === 'Tümü' || q.sector === sector) &&
      (!ql || q.symbol.toLowerCase().includes(ql) || q.name.toLowerCase().includes(ql)))
    return list.sort((a, b) => {
      // Favoriler (izleme listesindekiler) her zaman en üstte, kendi aralarında seçili sıralamayla
      const fav = Number(watch.has(b.symbol)) - Number(watch.has(a.symbol))
      if (fav) return fav
      if (sort.key === 'name') return a.name.localeCompare(b.name, 'tr') * sort.dir
      const av = a[sort.key] ?? -Infinity, bv = b[sort.key] ?? -Infinity
      return ((av as number) - (bv as number)) * sort.dir
    })
  }, [data, all, scope, sector, query, sort, watch])

  const ranked = featured.filter(q => q.change_pct !== null).sort((a, b) => b.change_pct! - a.change_pct!)
  const th = (key: SortKey, label: string, cls = 'r') => (
    <th className={`${cls} sortable`} onClick={() => setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}>
      {label}{sort.key === key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
    </th>
  )

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{info.title}</h1>
          <p className="muted">{info.desc}</p>
        </div>
        <div className="row gap">
          <span className={`status ${status.open ? 'on' : ''}`}><span className="status-dot" />{status.label}</span>
          {updated && <span className="muted small">Güncelleme: {updated.toLocaleTimeString('tr-TR')}</span>}
          <button className="btn ghost" onClick={() => { load(true); if (scope === 'all') loadAll(true) }} disabled={busy}>{busy ? 'Yenileniyor…' : '↻ Yenile'}</button>
          <ExportButton label="Excel" endpoint={`/export/market/${market}`} />
        </div>
      </header>
      <ErrorBox error={error} />
      {!data && !error && <Loading text="Piyasa verileri çekiliyor…" />}
      {data && (
        <>
          {indices.length > 0 && (
            <div className="grid-idx">
              {indices.map(q => (
                <div key={q.symbol} className="card kpi clickable" onClick={() => open(q.symbol)}>
                  <div className="muted small">{q.name}</div>
                  <div className="kpi-value">{fmtPrice(q.price)}</div>
                  <div className="row between">
                    <span className={`kpi-change ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span>
                    <span className="muted small">YBB <span className={tone(q.change_ytd)}>{fmtPct(q.change_ytd)}</span></span>
                  </div>
                  <Sparkline data={q.spark} width={220} height={34} />
                </div>
              ))}
            </div>
          )}

          {market === 'fx' && <FxTools quotes={data.quotes} />}

          <div className="grid3">
            <div className="card">
              <h3>Piyasa Genişliği</h3>
              <div className="breadth">
                <div className="up-bar" style={{ flex: data.breadth.up || 0.0001 }} />
                <div className="flat-bar" style={{ flex: data.breadth.flat || 0.0001 }} />
                <div className="down-bar" style={{ flex: data.breadth.down || 0.0001 }} />
              </div>
              <div className="row between small mt">
                <span className="up">▲ {data.breadth.up} yükselen</span>
                <span className="muted">{data.breadth.flat} değişmeyen</span>
                <span className="down">▼ {data.breadth.down} düşen</span>
              </div>
              <h3 className="mt">Sektör Performansı (günlük ort.)</h3>
              <div className="sector-bars">
                {data.sectors.map(s => {
                  const max = Math.max(...data.sectors.map(x => Math.abs(x.avg_change_pct)), 0.01)
                  return (
                    <div key={s.sector} className="sector-row clickable" onClick={() => setSector(s.sector)}>
                      <span className="sector-name">{s.sector} <span className="muted small">({s.count})</span></span>
                      <div className="diverge">
                        <div className="neg">{s.avg_change_pct < 0 && <div style={{ width: `${Math.abs(s.avg_change_pct) / max * 100}%` }} />}</div>
                        <div className="pos">{s.avg_change_pct > 0 && <div style={{ width: `${s.avg_change_pct / max * 100}%` }} />}</div>
                      </div>
                      <span className={`mono small ${tone(s.avg_change_pct)}`}>{fmtPct(s.avg_change_pct)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="card">
              <h3>Günün Kazandıranları</h3>
              <Movers items={ranked.slice(0, 6)} onPick={open} />
            </div>
            <div className="card">
              <h3>Günün Kaybettirenleri</h3>
              <Movers items={ranked.slice(-6).reverse()} onPick={open} />
            </div>
          </div>

          <div className="card">
            {hasAll && (
              <div className="toolbar">
                <div className="seg">
                  <button className={scope === 'featured' ? 'active' : ''} onClick={() => { setScope('featured'); setSector('Tümü') }}>Öne çıkanlar ({featured.length})</button>
                  <button className={scope === 'all' ? 'active' : ''} onClick={() => { setScope('all'); setSector('Tümü') }}>
                    {market === 'bist' ? 'Tüm BIST hisseleri' : 'Tüm S&P 500 hisseleri'}{all ? ` (${all.quotes.filter(q => q.price !== null).length})` : ''}</button>
                </div>
                {scope === 'all' && <span className="muted small">
                  {!all ? 'Tüm hisseler yükleniyor (ilk açılışta 10–30 sn sürebilir)…' : all.refreshing ? 'Arka planda güncelleniyor…' : all.fetched_at ? `Veri zamanı: ${new Date(all.fetched_at * 1000).toLocaleTimeString('tr-TR')}` : ''}
                  {all && ' · Bu listede hacim bilgisi yoktur.'}</span>}
              </div>
            )}
            {scope === 'all' && !all && <Loading text="Tüm hisseler yükleniyor…" />}
            <div className="toolbar wrap">
              <div className="chips">
                {sectors.map(s => <button key={s} className={`chip ${sector === s ? 'on' : ''}`} onClick={() => setSector(s)}>{s}</button>)}
              </div>
              <div className="row gap">
                <input className="search" placeholder={`${info.unit} ara…`} value={query} onChange={e => setQuery(e.target.value)} />
                <div className="seg">
                  <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Tablo</button>
                  <button className={view === 'heatmap' ? 'active' : ''} onClick={() => setView('heatmap')}>Isı Haritası</button>
                  <button className={view === 'treemap' ? 'active' : ''} onClick={() => setView('treemap')}>Ağaç Haritası</button>
                </div>
              </div>
            </div>

            {view === 'treemap' ? (
              <>
                <p className="muted small">{rows.some(q => q.volume) ? 'Kutu büyüklüğü günlük işlem hacmini (fiyat × adet), renk günlük değişimi gösterir.' : 'Bu listede hacim bilgisi olmadığından kutular eşit büyüklüktedir; renk günlük değişimi gösterir.'}</p>
                <Treemap height={620} groups={Object.entries(rows.reduce<Record<string, Quote[]>>((acc, q) => { (acc[q.sector ?? 'Diğer'] ??= []).push(q); return acc }, {}))
                  .map(([name, qs]) => ({ name, nodes: qs.map(q => ({ key: q.symbol, label: q.symbol.replace('.IS', '').replace('-USD', '').replace('=X', ''), sub: q.name,
                    value: q.volume && q.price ? q.volume * q.price : 1, change: q.change_pct, onClick: () => open(q.symbol) })) }))} />
              </>
            ) : view === 'heatmap' ? (
              <div className="heatmap">
                {sectors.filter(s => s !== 'Tümü' && (sector === 'Tümü' || s === sector)).map(s => (
                  <div key={s} className="heat-group">
                    <div className="muted small">{s}</div>
                    <div className="heat-tiles">
                      {rows.filter(q => (q.sector ?? 'Diğer') === s).map(q => (
                        <div key={q.symbol} className="heat-tile" style={{ background: heat(q.change_pct) }} onClick={() => open(q.symbol)} title={q.name}>
                          <strong>{q.symbol.replace('.IS', '').replace('-USD', '').replace('=X', '')}</strong>
                          <span>{fmtPct(q.change_pct)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      {th('name', info.unit, '')}
                      {th('price', 'Fiyat')}
                      {th('change_pct', 'Günlük')}
                      {th('change_1w', 'Haftalık')}
                      {th('change_1m', 'Aylık')}
                      {th('change_ytd', 'YBB')}
                      {th('change_1y', '1 Yıl')}
                      <th className="c">52 hafta aralığı</th>
                      {hasVolume && th('volume', 'Hacim')}
                      <th className="r">30 gün</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((q, i) => (
                      <tr key={q.symbol} className={watch.has(q.symbol) ? `fav-row${!watch.has(rows[i + 1]?.symbol) ? ' fav-last' : ''}` : ''}>
                        <td><button className={`star ${watch.has(q.symbol) ? 'on' : ''}`} title={watch.has(q.symbol) ? 'Favorilerden çıkar' : 'Favorilere ekle (en üste sabitlenir)'} onClick={() => toggleWatch(q.symbol)}>{watch.has(q.symbol) ? '★' : '☆'}</button></td>
                        <td className="clickable" onClick={() => open(q.symbol)}>
                          <div className="sym">{q.symbol.replace('.IS', '')}</div>
                          <div className="muted small">{q.name}</div>
                        </td>
                        <td className="r"><LivePrice value={q.price} /></td>
                        <td className={`r mono ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</td>
                        <td className={`r mono ${tone(q.change_1w)}`}>{fmtPct(q.change_1w)}</td>
                        <td className={`r mono ${tone(q.change_1m)}`}>{fmtPct(q.change_1m)}</td>
                        <td className={`r mono ${tone(q.change_ytd)}`}>{fmtPct(q.change_ytd)}</td>
                        <td className={`r mono ${tone(q.change_1y)}`}>{fmtPct(q.change_1y)}</td>
                        <td><RangeBar low={q.low_52w} high={q.high_52w} value={q.price} /></td>
                        {hasVolume && <td className="r mono" title={q.volume_avg ? `20 günlük ort.: ${fmtVolume(q.volume_avg)}` : ''}>
                          {fmtVolume(q.volume)}
                          {q.volume && q.volume_avg && q.volume > q.volume_avg * 1.5 ? <span className="pill up ml" title="Ortalamanın 1,5 katından fazla hacim">yüksek</span> : null}
                        </td>}
                        <td className="r"><Sparkline data={q.spark} /></td>
                        <td className="r"><button className="btn ghost small" onClick={() => setTrade(q.symbol)}>Al / Sat</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={12} className="muted">Sonuç yok.</td></tr>}
                  </tbody>
                </table>
                {rows.length > limit && <div className="center mt"><button className="btn ghost" onClick={() => setLimit(l => l + 200)}>Daha fazla göster ({rows.length - limit} hisse daha)</button></div>}
              </div>
            )}
          </div>
        </>
      )}
      {trade && <TradeModal symbol={trade} onClose={() => setTrade(null)} />}
      <Disclaimer />
    </div>
  )
}

function Movers({ items, onPick }: { items: Quote[]; onPick: (s: string) => void }) {
  return (
    <div className="movers">
      {items.map(q => (
        <div key={q.symbol} className="mover clickable" onClick={() => onPick(q.symbol)}>
          <div><span className="sym">{q.symbol.replace('.IS', '')}</span> <span className="muted small">{q.name}</span></div>
          <div className="row gap"><span className="mono">{fmtPrice(q.price)}</span><span className={`pill ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span></div>
        </div>
      ))}
    </div>
  )
}

function RangeBar({ low, high, value }: { low?: number | null; high?: number | null; value: number | null }) {
  if (low == null || high == null || value == null || high <= low) return <span className="muted">—</span>
  const pos = Math.min(Math.max((value - low) / (high - low), 0), 1) * 100
  return (
    <div className="range" title={`52H en düşük ${fmtPrice(low)} · en yüksek ${fmtPrice(high)}`}>
      <span className="mono small muted">{fmtPrice(low)}</span>
      <div className="range-track"><div className="range-dot" style={{ left: `${pos}%` }} /></div>
      <span className="mono small muted">{fmtPrice(high)}</span>
    </div>
  )
}

/** Döviz çevirici ve altın hesaplayıcı. Tüm kurlar TL üzerinden çaprazlanır. */
function FxTools({ quotes }: { quotes: Quote[] }) {
  const price = (s: string) => quotes.find(q => q.symbol === s)?.price ?? null
  const units: Record<string, { label: string; tl: number | null }> = {
    TRY: { label: 'Türk Lirası (TL)', tl: 1 },
    USD: { label: 'ABD Doları (USD)', tl: price('USDTRY=X') },
    EUR: { label: 'Euro (EUR)', tl: price('EURTRY=X') },
    GBP: { label: 'İngiliz Sterlini (GBP)', tl: price('GBPTRY=X') },
    CHF: { label: 'İsviçre Frangı (CHF)', tl: price('CHFTRY=X') },
    GAU: { label: 'Gram Altın', tl: price('GRAM-ALTIN') },
    CEYREK: { label: 'Çeyrek Altın (≈1,75 g, 22 ayar)', tl: price('GRAM-ALTIN') && price('GRAM-ALTIN')! * 1.75 * 0.916 },
    GAG: { label: 'Gram Gümüş', tl: price('GRAM-GUMUS') },
  }
  const [amount, setAmount] = useState(100)
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('TRY')
  const a = units[from].tl, b = units[to].tl
  const result = a && b ? (amount * a) / b : null

  return (
    <div className="grid2">
      <div className="card">
        <h3>Döviz & Altın Çevirici</h3>
        <div className="converter">
          <input type="number" min={0} step="any" value={amount} onChange={e => setAmount(+e.target.value)} />
          <select value={from} onChange={e => setFrom(e.target.value)}>{Object.entries(units).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}</select>
          <button className="btn ghost" title="Yer değiştir" onClick={() => { setFrom(to); setTo(from) }}>⇄</button>
          <select value={to} onChange={e => setTo(e.target.value)}>{Object.entries(units).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}</select>
        </div>
        <div className="convert-result">
          {result === null ? <span className="muted">Kur verisi yok</span> :
            <><span className="mono">{amount.toLocaleString('tr-TR')} {from}</span> = <strong className="mono">{fmtPrice(result)} {to}</strong></>}
        </div>
        <p className="muted small">Çeyrek altın değeri, gram altın fiyatından yaklaşık olarak hesaplanır. Kuyumcu satış fiyatları işçilik ve makas nedeniyle farklıdır.</p>
      </div>
      <div className="card">
        <h3>TL Karşılıkları</h3>
        <div className="stats">
          {Object.entries(units).filter(([k]) => k !== 'TRY').map(([k, u]) => (
            <div key={k} className="stat">
              <div className="stat-label">{u.label}</div>
              <div className="stat-value mono">{u.tl ? `${fmtPrice(u.tl)} ₺` : '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
