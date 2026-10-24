// Çoklu portföy seçici, düzenli alım planları, bilanço takvimi ve ABD hisseleri vergi hesaplayıcısı.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { activePortfolio, api, fmtPct, fmtPrice, tone } from '../api'
import Chart, { COLORS, type SeriesSpec } from './Chart'
import { EmptyState, ErrorBox, Loading, SymbolPicker } from './common'
import { openStock } from './StockCard'

const TL0 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 })
const tl = (v: number | null | undefined) => v == null || Number.isNaN(v) ? '—' : TL0.format(v)
const num = (s: string) => { const v = Number(s.replace(/\./g, '').replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null }

/* ------------------------------------------------------------------ Portföy seçici */
export type PortfolioItem = { id: number; name: string; main: boolean; equity?: number | null; return_pct?: number | null; positions?: number; net_deposits?: number | null; cash?: number | null }

export function usePortfolios() {
  const [items, setItems] = useState<PortfolioItem[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    api<{ items: PortfolioItem[] }>('/portfolios').then(d => {
      setItems(d.items)
      const cur = activePortfolio.get()
      if (cur && !d.items.some(i => i.id === cur)) activePortfolio.set(null)  // silinmiş ya da başka kişiye ait
    }).catch(() => setItems(null))
  }, [tick])
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener('finanaliz:portfolio', h)
    return () => window.removeEventListener('finanaliz:portfolio', h)
  }, [])
  const activeId = activePortfolio.get() ?? items?.find(i => i.main)?.id ?? null
  return { items, active: items?.find(i => i.id === activeId) ?? items?.[0] ?? null, reload: () => setTick(t => t + 1) }
}

export function PortfolioSwitcher() {
  const { items, active } = usePortfolios()
  if (!items || items.length < 2) return (
    <Link to="/portfoyler" className="btn ghost small" title="Ayrı bakiyeli ek portföyler oluşturun">＋ Yeni portföy</Link>
  )
  return (
    <div className="pf-switch">
      <span className="muted small">Portföy:</span>
      <select value={active?.id ?? ''} onChange={e => { const id = Number(e.target.value); activePortfolio.switchTo(items.find(i => i.id === id)?.main ? null : id, location.pathname + location.search) }}>
        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <Link to="/portfoyler" className="btn ghost small" title="Portföyleri yönet ve karşılaştır">⚙</Link>
    </div>
  )
}

/* ------------------------------------------------------------------ Düzenli alım */
type Plan = { id: number; symbol: string; name: string; amount: number; freq: string; freq_label: string; day: number; day_label: string
  next_date: string; active: number; runs: number; last_run: string | null; last_result: string | null; currency: string
  quantity: number; cost: number; avg_cost: number | null; price: number | null; value: number | null; pnl_pct: number | null
  executions: { date: string; price: number; avg_cost: number; quantity: number }[] }
type Sim = { buys: number; invested: number; dca_value: number; dca_return: number; lump_value: number; lump_return: number; avg_cost: number
  last_price: number; series: { time: number; value: number; invested: number; lump: number }[]; rate_note: string | null }

export function DcaTab() {
  const [data, setData] = useState<{ plans: Plan[]; weekdays: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [symbol, setSymbol] = useState('THYAO.IS')
  const [amount, setAmount] = useState('2.000')
  const [freq, setFreq] = useState<'monthly' | 'weekly' | 'biweekly'>('monthly')
  const [day, setDay] = useState(1)
  const [sim, setSim] = useState<Sim | null>(null)
  const [simBusy, setSimBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => api<{ plans: Plan[]; weekdays: string[] }>('/dca').then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { setDay(freq === 'monthly' ? 1 : 0) }, [freq])

  const create = async () => {
    const a = num(amount)
    if (!a) { setErr('Geçerli bir tutar girin.'); return }
    setErr(null)
    try {
      await api('/dca', { body: { symbol, amount: a, freq, day } })
      setMsg('Plan oluşturuldu. Plan günü geldiğinde, piyasa açıkken alım otomatik yapılır ve bildirim alırsınız.')
      load()
    } catch (e) { setErr((e as Error).message) }
  }
  const simulate = async () => {
    const a = num(amount)
    if (!a) return
    setSimBusy(true); setSim(null)
    try { setSim(await api<Sim>(`/dca/simulate?symbol=${encodeURIComponent(symbol)}&amount=${a}&years=3&freq=${freq}`)) } catch (e) { setErr((e as Error).message) } finally { setSimBusy(false) }
  }
  const simSeries = useMemo<SeriesSpec[]>(() => sim ? [
    { kind: 'line', data: sim.series.map(p => ({ time: p.time, value: p.value })), color: COLORS.orange, title: 'Düzenli alım', width: 2 },
    { kind: 'line', data: sim.series.map(p => ({ time: p.time, value: p.lump })), color: COLORS.up, title: 'Tek seferde', width: 1 },
    { kind: 'line', data: sim.series.map(p => ({ time: p.time, value: p.invested })), color: COLORS.gray, title: 'Yatırılan', width: 1 },
  ] : [], [sim])

  return (
    <div className="mt">
      <div className="dca-form">
        <label>Varlık<SymbolPicker value={symbol} onChange={setSymbol} /></label>
        <label>Tutar (TL)<input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Sıklık
          <select value={freq} onChange={e => setFreq(e.target.value as typeof freq)}>
            <option value="monthly">Her ay</option><option value="biweekly">İki haftada bir</option><option value="weekly">Her hafta</option>
          </select>
        </label>
        <label>{freq === 'monthly' ? 'Ayın günü' : 'Gün'}
          <select value={day} onChange={e => setDay(+e.target.value)}>
            {freq === 'monthly' ? Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)
              : (data?.weekdays ?? ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']).map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
      </div>
      <div className="row gap mt">
        <button className="btn primary" onClick={create}>🔁 Planı başlat</button>
        <button className="btn ghost" onClick={simulate} disabled={simBusy}>{simBusy ? 'Hesaplanıyor…' : '⏪ Son 3 yılda uygulasaydım?'}</button>
      </div>
      <ErrorBox error={err} />
      {msg && <div className="info-box small mt">{msg}</div>}
      {sim && (
        <div className="card mt">
          <div className="grid4">
            <div className="kpi"><div className="muted small">{sim.buys} alımda yatırılan</div><div className="kpi-value">{tl(sim.invested)}</div></div>
            <div className="kpi"><div className="muted small">Düzenli alımla bugün</div><div className={`kpi-value ${tone(sim.dca_return)}`}>{tl(sim.dca_value)}</div><div className={`small ${tone(sim.dca_return)}`}>{fmtPct(sim.dca_return)}</div></div>
            <div className="kpi"><div className="muted small">Hepsi ilk gün yatırılsaydı</div><div className={`kpi-value ${tone(sim.lump_return)}`}>{tl(sim.lump_value)}</div><div className={`small ${tone(sim.lump_return)}`}>{fmtPct(sim.lump_return)}</div></div>
            <div className="kpi"><div className="muted small">Ortalama maliyet / bugünkü fiyat</div><div className="kpi-value sm">{fmtPrice(sim.avg_cost)} / {fmtPrice(sim.last_price)}</div></div>
          </div>
          <Chart series={simSeries} height={220} />
          <p className="muted small">Düzenli alım, fiyat düştüğünde daha çok, yükseldiğinde daha az adet alarak ortalama maliyeti dengeler; zamanlama riskini azaltır. {sim.rate_note}</p>
        </div>
      )}
      <h4 className="mt">Planlarım</h4>
      {!data ? <Loading /> : data.plans.length === 0 ? <EmptyState icon="🔁" title="Henüz düzenli alım planı yok" text="Yukarıdan bir varlık, tutar ve gün seçerek otomatik düzenli alım başlatın." /> : (
        <div className="dca-list">
          {data.plans.map(p => (
            <div key={p.id} className={`dca-plan ${p.active ? '' : 'paused'}`}>
              <div className="row between wrap gap">
                <div>
                  <b className="clickable" onClick={() => openStock(p.symbol)}>{p.symbol.replace('.IS', '')}</b> <span className="muted small">{p.name}</span>
                  <div className="small">{p.freq_label} {p.day_label} · <b>{tl(p.amount)}</b>{p.active ? <> · sonraki alım <b>{new Date(p.next_date).toLocaleDateString('tr-TR')}</b></> : <span className="pill warn"> duraklatıldı</span>}</div>
                </div>
                <div className="row gap">
                  <button className="btn ghost small" onClick={() => api(`/dca/${p.id}/toggle`, { body: {} }).then(load)}>{p.active ? '⏸ Duraklat' : '▶ Devam'}</button>
                  <button className="btn ghost small danger" onClick={() => api(`/dca/${p.id}`, { method: 'DELETE' }).then(load)}>Sil</button>
                </div>
              </div>
              {p.runs > 0 && (
                <div className="dca-stats small">
                  <span>{p.runs} alım · {p.quantity.toLocaleString('tr-TR')} adet</span>
                  <span>Ortalama maliyet <b className="mono">{fmtPrice(p.avg_cost)}</b></span>
                  <span>Güncel <b className="mono">{fmtPrice(p.price)}</b></span>
                  <span className={tone(p.pnl_pct)}>{fmtPct(p.pnl_pct)}</span>
                </div>
              )}
              {p.last_result && <div className="muted small">Son işlem: {p.last_run} · {p.last_result}</div>}
            </div>
          ))}
        </div>
      )}
      <p className="muted small">Alım, plan günü ilgili piyasa açıkken o anki fiyattan yapılır; uygulama kapalıysa ilk açılışta yapılır. Hisselerde tam adet alınır, kalan tutar nakitte kalır.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ Bilanço takvimi */
type Earn = { items: { symbol: string; name: string; held: boolean; last_period_label: string | null; next_date: string | null
  kap_reports: { title: string; time: number | null; url: string }[] }[]; upcoming: { symbol: string; name: string; next_date: string }[]; note: string }

export function EarningsTab() {
  const [d, setD] = useState<Earn | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Earn>('/earnings').then(setD).catch(e => setErr(e.message)) }, [])
  if (err) return <ErrorBox error={err} />
  if (!d) return <Loading text="Bilanço bilgileri toplanıyor…" />
  if (!d.items.length) return <EmptyState icon="📑" title="Takip edilen şirket yok" text="Portföyünüzdeki veya favorilerinizdeki hisseler için bilanço dönemleri burada görünür." />
  return (
    <div className="mt">
      {d.upcoming.length > 0 && (
        <div className="info-box small">📅 Yaklaşan: {d.upcoming.slice(0, 5).map(u => `${u.symbol.replace('.IS', '')} (${new Date(u.next_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })})`).join(' · ')}</div>
      )}
      <div className="table-wrap mt">
        <table className="table">
          <thead><tr><th>Şirket</th><th>Son bilanço</th><th>Sonraki açıklama</th><th>KAP'taki son finansal rapor</th><th /></tr></thead>
          <tbody>{d.items.map(i => (
            <tr key={i.symbol}>
              <td className="clickable" onClick={() => openStock(i.symbol)}><span className="sym">{i.symbol.replace('.IS', '')}</span> {i.held ? <span className="pill up">portföyde</span> : <span className="pill">favori</span>}<div className="muted small">{i.name}</div></td>
              <td>{i.last_period_label ?? '—'}</td>
              <td>{i.next_date ? new Date(i.next_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : <span className="muted small">{i.symbol.endsWith('.IS') ? 'KAP\'ta duyurulunca' : 'bilinmiyor'}</span>}</td>
              <td className="small">{i.kap_reports[0] ? <a href={i.kap_reports[0].url} target="_blank" rel="noreferrer">{i.kap_reports[0].title}</a> : '—'}</td>
              <td><Link className="btn ghost small" to={`/temel?s=${encodeURIComponent(i.symbol)}`}>📋 Özet</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="muted small">🔔 Portföyünüzdeki bir şirket finansal rapor yayımladığında ve yeni dönem bilançosu veri kaynağına yansıdığında otomatik özetle birlikte bildirim alırsınız. {d.note}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ Vergi (ABD hisseleri) */
type TaxSale = { symbol: string; buy_date: string; sell_date: string; quantity: number; buy_price: number; sell_price: number; buy_rate: number; sell_rate: number
  cost_try: number; ufe_change: number; indexed: boolean; cost_adj_try: number; proceeds_try: number; gain_try: number }
type TaxRes = { year: number; years: number[]; sales: TaxSale[]; gains_try: number; losses_try: number; net_try: number; exemption: number; taxable_try: number
  tax_try: number; effective_rate: number; brackets_used: { from: number; to: number; rate: number; tax: number }[]
  settings: { brackets: [number | null, number][]; exemption: number; custom: boolean; default_year: number }
  dividends: { count: number; gross_try: number }; ufe_error: string | null; deadline: string; notes: string[] }

export function TaxTab() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [r, setR] = useState<TaxRes | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ brackets: string[][]; exemption: string } | null>(null)
  const load = (y = year) => { setR(null); setErr(null); api<TaxRes>(`/tax/${y}`).then(setR).catch(e => setErr(e.message)) }
  useEffect(() => { load() }, [year])
  const save = async () => {
    if (!edit) return
    try {
      await api('/tax/settings', { method: 'PUT', body: { brackets: edit.brackets.map(([l, rate], i) => [i === edit.brackets.length - 1 ? null : num(l), num(rate) ?? 0]), exemption: num(edit.exemption) ?? 0 } })
      setEdit(null); load()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="mt">
      <div className="row between wrap gap">
        <p className="muted small" style={{ margin: 0 }}>ABD hisselerinin satışından doğan kazanç Türkiye'de “değer artış kazancı” olarak beyan edilir. Bu hesap, portföyünüzdeki işlemlere göre tahmini vergiyi gösterir.</p>
        <select value={year} onChange={e => setYear(+e.target.value)}>
          {(r?.years ?? [new Date().getFullYear()]).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <ErrorBox error={err} />
      {!r && !err && <Loading text="Kur ve Yİ-ÜFE verileri işleniyor…" />}
      {r && (
        <>
          <div className="grid4 mt">
            <div className="card kpi"><div className="muted small">Net kazanç ({r.year})</div><div className={`kpi-value ${tone(r.net_try)}`}>{tl(r.net_try)}</div><div className="muted small">kâr {tl(r.gains_try)} · zarar {tl(r.losses_try)}</div></div>
            <div className="card kpi"><div className="muted small">Vergiye tabi</div><div className="kpi-value">{tl(r.taxable_try)}</div>{r.exemption > 0 && <div className="muted small">istisna {tl(r.exemption)} düşüldü</div>}</div>
            <div className="card kpi"><div className="muted small">Tahmini vergi</div><div className="kpi-value down">{tl(r.tax_try)}</div><div className="muted small">efektif oran %{r.effective_rate.toFixed(1).replace('.', ',')}</div></div>
            <div className="card kpi"><div className="muted small">Beyan</div><div className="kpi-value sm">{r.sales.length ? 'Gerekli' : 'Satış yok'}</div><div className="muted small">{r.deadline}</div></div>
          </div>
          {r.ufe_error && <div className="info-box small mt">{r.ufe_error}</div>}
          {r.sales.length === 0 ? <EmptyState icon="🧾" title={`${r.year} yılında ABD hissesi satışı yok`} text="ABD hisselerini sattığınızda kazanç ve tahmini vergi burada hesaplanır." /> : (
            <div className="table-wrap mt">
              <table className="table">
                <thead><tr><th>Hisse</th><th>Alış → Satış</th><th className="r">Adet</th><th className="r">Maliyet (TL)</th><th className="r" title="Alış ile satış arasındaki Yİ-ÜFE artışı %10'u geçerse maliyet endekslenir">Yİ-ÜFE</th><th className="r">Satış (TL)</th><th className="r">Kazanç (TL)</th></tr></thead>
                <tbody>{r.sales.map((s, i) => (
                  <tr key={i}>
                    <td><span className="sym">{s.symbol}</span></td>
                    <td className="small">{new Date(s.buy_date).toLocaleDateString('tr-TR')} → {new Date(s.sell_date).toLocaleDateString('tr-TR')}<div className="muted">kur {s.buy_rate.toFixed(2)} → {s.sell_rate.toFixed(2)}</div></td>
                    <td className="r mono">{s.quantity.toLocaleString('tr-TR')}</td>
                    <td className="r mono">{tl(s.cost_try)}{s.indexed && <div className="muted small">endeksli {tl(s.cost_adj_try)}</div>}</td>
                    <td className="r mono small">{s.indexed ? <span className="pill up">+%{s.ufe_change.toFixed(0)}</span> : `+%${s.ufe_change.toFixed(0)}`}</td>
                    <td className="r mono">{tl(s.proceeds_try)}</td>
                    <td className={`r mono ${tone(s.gain_try)}`}><b>{tl(s.gain_try)}</b></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {r.brackets_used.length > 0 && (
            <div className="small mt">Dilimler: {r.brackets_used.map((b, i) => <span key={i} className="pill" style={{ marginRight: 4 }}>{tl(b.from)}–{tl(b.to)} × %{b.rate} = {tl(b.tax)}</span>)}</div>
          )}
          {r.dividends.count > 0 && <div className="info-box small mt">Bu yıl ABD hisselerinden {r.dividends.count} temettü ödemesi (brüt ≈ {tl(r.dividends.gross_try)}) alındı; temettüler ayrıca menkul sermaye iradı olarak değerlendirilir.</div>}
          <details className="mt">
            <summary className="small">Vergi dilimleri ve istisna ({r.settings.custom ? 'özel ayar' : `${r.settings.default_year} tarifesi`}) — düzenle</summary>
            {!edit ? <button className="btn ghost small mt" onClick={() => setEdit({ brackets: r.settings.brackets.map(([l, rt]) => [l == null ? '' : String(l), String(rt)]), exemption: String(r.settings.exemption) })}>Düzenle</button> : (
              <div className="tax-edit mt">
                {edit.brackets.map((b, i) => (
                  <div key={i} className="row gap small">
                    <span>{i === edit.brackets.length - 1 ? 'Üzeri' : 'Üst sınır'}</span>
                    {i < edit.brackets.length - 1 && <input value={b[0]} onChange={e => setEdit({ ...edit, brackets: edit.brackets.map((x, j) => j === i ? [e.target.value, x[1]] : x) })} />}
                    <span>oran %</span><input style={{ width: 60 }} value={b[1]} onChange={e => setEdit({ ...edit, brackets: edit.brackets.map((x, j) => j === i ? [x[0], e.target.value] : x) })} />
                  </div>
                ))}
                <label className="small">İstisna tutarı (TL) <input value={edit.exemption} onChange={e => setEdit({ ...edit, exemption: e.target.value })} /></label>
                <div className="row gap"><button className="btn primary small" onClick={save}>Kaydet</button><button className="btn ghost small" onClick={() => setEdit(null)}>Vazgeç</button></div>
              </div>
            )}
          </details>
          <ul className="muted small">{r.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </div>
  )
}

