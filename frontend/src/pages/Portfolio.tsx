import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtPct, fmtPrice, tone, type Point } from '../api'
import Chart, { COLORS, PALETTE, type SeriesSpec } from '../components/Chart'
import { Disclaimer, ErrorBox, Loading, Stat } from '../components/common'
import { ExportButton } from '../components/extras'
import Markdown from '../components/Markdown'
import TradePanel, { EMOTIONS, TAGS, TradeModal } from '../components/TradePanel'
import { Modal } from '../components/ui'
import { CountMoney } from '../components/fx'
import { useAutoRefresh } from '../refresh'

type Item = {
  id: string; symbol: string; name: string; currency: string; quantity: number; buy_price: number; buy_date: string | null
  price: number | null; cost: number; value: number | null; pnl: number | null; pnl_pct: number | null; day_change_pct: number | null
}
type Order = { id: number; symbol: string; type: string; type_name: string; quantity: number; price: number; status: string; expires: string | null
  reserved_try: number; filled_price: number | null; result: string | null; created_at: string; closed_at: string | null }
type Tx = { reason?: string | null; emotion?: string | null; tag?: string | null; review?: string | null; id: number; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; date: string | null; fee: number
  note: string | null; currency: string; realized_pnl: number | null; realized_pnl_try: number | null }
type PfRes = {
  items: Item[]; totals: Record<string, { cost: number; value: number; pnl: number; pnl_pct: number }>
  transactions: Tx[]; realized: { total_try: number; by_symbol: { symbol: string; currency: string; realized: number; realized_try: number }[] }
}
type Rebalance = { category: string; label: string; current_pct: number; target_pct: number | null; diff_pct: number | null; amount_try: number | null }
type Divs = {
  payments: { symbol: string; date: string; per_share: number; quantity: number; amount: number; currency: string; amount_try: number }[]
  total_try: number; yields: { symbol: string; name: string; currency: string; ttm_per_share: number; yield_pct: number; last_date: string | null }[]
}
type Account = {
  t0: number; t1: number; t2: number; buying_power: number; total_cash: number; net_deposits: number
  holdings_value_try: number; equity_try: number; total_pnl_try: number; total_pnl_pct: number | null; holdings_count: number
  settle_dates: { t0: string; t1: string; t2: string }
  pending: { kind: string; amount: number; date: string; settle_date: string; note: string }[]
}
type Advice = { observations: { level: 'ok' | 'info' | 'warn'; title: string; text: string }[]; llm_text: string | null; source: string | null }
type Alloc = { label: string; value: number; pct: number }
type Analytics = {
  empty: boolean; usdtry: number
  totals: { value_try: number; cost_try: number; pnl_try: number; pnl_pct: number; value_usd: number; day_change_try: number | null }
  value_series: Point[]; performance: Record<string, Point[]>; period_return_pct: number | null
  benchmark_returns: Record<string, number>
  risk: { volatility_pct: number | null; max_drawdown_pct: number | null; sharpe: number | null; beta_bist100: number | null
    var95_try: number | null; best_day_pct: number | null; worst_day_pct: number | null }
  allocation: { market: Alloc[]; currency: Alloc[]; asset: Alloc[] }
  realized_try: number; targets: Record<string, number>; rebalance: Rebalance[]
  inflation_pct?: number | null; real_return_pct?: number | null; benchmark_real?: Record<string, number>
}

const PERF_COLORS = [COLORS.blue, COLORS.orange, COLORS.teal, COLORS.yellow, COLORS.gray]

export default function Portfolio() {
  const [data, setData] = useState<PfRes | null>(null)
  const [an, setAn] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acc, setAcc] = useState<Account | null>(null)
  const [trade, setTrade] = useState<string | null>(null)
  const [divs, setDivs] = useState<Divs | null>(null)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [targetsDraft, setTargetsDraft] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'tx' | 'div' | 'target' | 'advice' | 'orders'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [jEdit, setJEdit] = useState<Tx | null>(null)
  const loadOrders = () => api<Order[]>('/orders').then(setOrders).catch(() => {})
  useEffect(() => { loadOrders() }, [])
  const cancelOrder = (id: number) => api(`/orders/${id}`, { method: 'DELETE' }).then(() => { loadOrders(); load() })
  const saveJournal = async () => {
    if (!jEdit) return
    await api(`/portfolio/transactions/${jEdit.id}/journal`, { method: 'PUT', body: { reason: jEdit.reason, emotion: jEdit.emotion, tag: jEdit.tag, review: jEdit.review } })
    setJEdit(null); load()
  }
  const [chart, setChart] = useState<'perf' | 'value'>('perf')
  const [allocBy, setAllocBy] = useState<'market' | 'currency' | 'asset'>('market')

  const load = (fresh = false) => {
    api<PfRes>(`/portfolio${fresh ? '?fresh=true' : ''}`).then(setData).catch(e => setError(e.message))
    api<Account>('/account').then(setAcc).catch(() => {})
    setAn(null); setAdvice(null); setDivs(null)
    api<Analytics>('/portfolio/analytics').then(a => {
      setAn(a)
      if (!a.empty) setTargetsDraft(Object.fromEntries(a.rebalance.map(r => [r.category, r.target_pct ? String(r.target_pct) : ''])))
    }).catch(() => {})
    api<Divs>('/portfolio/dividends').then(setDivs).catch(() => {})
    api<Advice>('/portfolio/advisor').then(setAdvice).catch(() => {})
  }
  useEffect(() => { load() }, [])
  // Otomatik yenilemede yalnızca güncel fiyat ve pozisyonlar sessizce güncellenir
  useAutoRefresh(() => { api<PfRes>('/portfolio').then(setData).catch(() => {}); api<Account>('/account').then(setAcc).catch(() => {}) })

  const remove = (sym: string) => { if (confirm(`${sym} için tüm alış/satış işlemleri silinsin mi?`)) api(`/portfolio/${encodeURIComponent(sym)}`, { method: 'DELETE' }).then(load) }
  const removeTx = (id: number) => { if (confirm('Bu işlem silinsin mi?')) api(`/portfolio/transactions/${id}`, { method: 'DELETE' }).then(load) }
  const sell = (i: Item) => setTrade(i.symbol)
  const saveTargets = async () => {
    setError(null)
    try {
      await api('/portfolio/targets', { method: 'PUT', body: { targets: Object.fromEntries(Object.entries(targetsDraft).map(([k, v]) => [k, v ? +v : null])) } })
      load()
    } catch (err: any) { setError(err.message) }
  }
  const targetSum = Object.values(targetsDraft).reduce((a, v) => a + (+v || 0), 0)

  const series = useMemo<SeriesSpec[]>(() => {
    if (!an || an.empty) return []
    if (chart === 'value') return [{ kind: 'area', data: an.value_series, color: COLORS.blue, title: 'Değer (TL)' }]
    return Object.entries(an.performance).map(([name, pts], i) => (
      { kind: 'line', data: pts, color: PERF_COLORS[i % PERF_COLORS.length], title: name, width: i === 0 ? 3 : 1 }))
  }, [an, chart])

  const hasItems = !!data && data.items.length > 0
  const t = an && !an.empty ? an.totals : null
  const r = an && !an.empty ? an.risk : null

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Portföy</h1><p className="muted">Varlıklarınızı ekleyin; değer, kâr/zarar, performans ve riski TL bazında takip edin</p></div>
        <div className="row gap">
          <button className="btn ghost" onClick={() => load(true)}>↻ Yenile</button>
          {hasItems && <ExportButton label="Excel" endpoint="/export/portfolio?fmt=xlsx" />}
          {hasItems && <ExportButton label="PDF rapor" endpoint="/export/portfolio?fmt=pdf" />}
        </div>
      </header>
      {acc && (
        <div className="grid4">
          <div className="card kpi">
            <div className="muted small">Toplam varlık (nakit + yatırımlar)</div>
            <div className="kpi-value"><CountMoney value={acc.equity_try} /></div>
            <div className={`small ${tone(acc.total_pnl_try)}`}>Toplam K/Z {fmtMoney(acc.total_pnl_try, 'TRY')} ({fmtPct(acc.total_pnl_pct)})</div>
          </div>
          <div className="card kpi">
            <div className="muted small">Alım gücü (T2 bakiyesi)</div>
            <div className={`kpi-value ${acc.buying_power <= 0 ? 'down' : ''}`}><CountMoney value={acc.buying_power} /></div>
            <div className="muted small">Yatırılan sanal para: {fmtMoney(acc.net_deposits, 'TRY')}</div>
          </div>
          <div className="card kpi">
            <div className="muted small">Nakit takas durumu</div>
            <div className="tline"><span>T0 · {acc.settle_dates.t0.slice(5)}</span><b className="mono">{fmtMoney(acc.t0, 'TRY')}</b></div>
            <div className="tline"><span>T1 · {acc.settle_dates.t1.slice(5)}</span><b className="mono">{fmtMoney(acc.t1, 'TRY')}</b></div>
            <div className="tline"><span>T2 · {acc.settle_dates.t2.slice(5)}</span><b className="mono">{fmtMoney(acc.t2, 'TRY')}</b></div>
          </div>
          <div className="card kpi">
            <div className="muted small">Yatırımların değeri</div>
            <div className="kpi-value"><CountMoney value={acc.holdings_value_try} /></div>
            <div className="muted small">{acc.holdings_count} farklı varlık · <Link to="/profil">hesap ayarları</Link></div>
          </div>
        </div>
      )}
      <div className="grid-trade">
        <div className="card">
          <h3>Al / Sat</h3>
          <TradePanel onDone={() => { load(); loadOrders() }} />
        </div>
        <div className="card">
          <h3>Bekleyen Takaslar</h3>
          {!acc ? <Loading /> : acc.pending.length === 0 ? <p className="muted">Takası bekleyen işlem yok; tüm nakit T0'da.</p> : (
            <table className="table">
              <thead><tr><th>İşlem</th><th>Tarih</th><th>Takas</th><th className="r">Tutar</th></tr></thead>
              <tbody>
                {acc.pending.map((p, i) => (
                  <tr key={i}><td>{p.note}</td><td className="small">{p.date}</td><td className="small">{p.settle_date}</td>
                    <td className={`r mono ${tone(p.amount)}`}>{fmtMoney(p.amount, 'TRY')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small mt">Borsa İstanbul işlemleri T+2, ABD hisseleri T+1 iş gününde takasa girer; döviz, emtia ve kripto anında kesinleşir.
            Satıştan gelen tutar takas tamamlanmadan da yeni alımlarda kullanılabilir (alım gücü = T2 bakiyesi).</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <div className="card muted">Portföyünüzde henüz varlık yok. Yukarıdaki Al / Sat panelinden ilk alımınızı yapabilirsiniz.</div>}
      {trade && <TradeModal symbol={trade} onClose={() => { setTrade(null); load() }} />}
      {hasItems && (
        <>
          {t ? (
            <div className="grid4">
              <div className="card kpi">
                <div className="muted small">Toplam değer (TL)</div>
                <div className="kpi-value">{fmtMoney(t.value_try, 'TRY')}</div>
                <div className="muted small">≈ {fmtMoney(t.value_usd, 'USD')} · USD/TL {fmtPrice(an!.usdtry)}</div>
              </div>
              <div className="card kpi">
                <div className="muted small">Toplam kâr / zarar</div>
                <div className={`kpi-value ${tone(t.pnl_try)}`}>{fmtMoney(t.pnl_try, 'TRY')}</div>
                <div className={`small ${tone(t.pnl_pct)}`}>{fmtPct(t.pnl_pct)} · maliyet {fmtMoney(t.cost_try, 'TRY')}</div>
              </div>
              <div className="card kpi">
                <div className="muted small">Günlük değişim</div>
                <div className={`kpi-value ${tone(t.day_change_try)}`}>{fmtMoney(t.day_change_try, 'TRY')}</div>
                <div className="muted small">Gerçekleşen K/Z: <span className={tone(an!.realized_try)}>{fmtMoney(an!.realized_try, 'TRY')}</span></div>
                {divs && divs.total_try > 0 && <div className="muted small">Alınan temettü: <span className="up">{fmtMoney(divs.total_try, 'TRY')}</span></div>}
              </div>
              <div className="card kpi">
                <div className="muted small">Dönem getirisi (zaman ağırlıklı)</div>
                <div className={`kpi-value ${tone(an!.period_return_pct)}`}>{fmtPct(an!.period_return_pct)}</div>
                <div className="muted small">BIST 100: <span className={tone(an!.benchmark_returns['BIST 100'])}>{fmtPct(an!.benchmark_returns['BIST 100'])}</span></div>
                {an!.real_return_pct != null && <div className="small">Reel (TÜFE'ye göre): <b className={tone(an!.real_return_pct)}>{fmtPct(an!.real_return_pct)}</b>
                  <span className="muted"> · enflasyon {fmtPct(an!.inflation_pct, false)}</span></div>}
              </div>
            </div>
          ) : <Loading text="Portföy analitiği hesaplanıyor…" />}

          {an && !an.empty && (
            <div className="card">
              <div className="row between">
                <h3>{chart === 'perf' ? 'Performans: Portföy ve Kıyaslama Endeksleri (%)' : 'Portföy Değeri (TL)'}</h3>
                <div className="seg">
                  <button className={chart === 'perf' ? 'active' : ''} onClick={() => setChart('perf')}>Karşılaştırma</button>
                  <button className={chart === 'value' ? 'active' : ''} onClick={() => setChart('value')}>Değer</button>
                </div>
              </div>
              {chart === 'perf' && (
                <div className="chips mb">
                  {Object.keys(an.performance).map((n, i) => (
                    <span key={n} className="legend"><span className="dot" style={{ background: PERF_COLORS[i % PERF_COLORS.length] }} />{n}
                      <span className={`small ${tone(i === 0 ? an.period_return_pct : an.benchmark_returns[n])}`}>
                        {fmtPct(i === 0 ? an.period_return_pct : an.benchmark_returns[n])}</span></span>
                  ))}
                </div>
              )}
              <Chart series={series} height={320} percent={chart === 'perf'} />
              <p className="muted small">Zaman ağırlıklı getiri, para ekleme/çıkarmanın etkisini ayırarak yalnızca varlıkların fiyat performansını ölçer. ABD varlıkları ve S&P 500 TL'ye çevrilerek karşılaştırılır.</p>
            </div>
          )}

          {r && (
            <div className="grid2">
              <div className="card">
                <h3>Risk Ölçümleri</h3>
                <div className="stats">
                  <Stat label="Yıllık oynaklık" value={fmtPct(r.volatility_pct, false)} />
                  <Stat label="Maksimum düşüş" value={fmtPct(r.max_drawdown_pct)} cls="down" />
                  <Stat label="Sharpe oranı" value={r.sharpe?.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) ?? '—'} />
                  <Stat label="Beta (BIST 100)" value={r.beta_bist100?.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) ?? '—'} />
                  <Stat label="Günlük %95 VaR" value={fmtMoney(r.var95_try, 'TRY')} />
                  <Stat label="En iyi / en kötü gün" value={<><span className="up">{fmtPct(r.best_day_pct)}</span> / <span className="down">{fmtPct(r.worst_day_pct)}</span></>} />
                </div>
                <p className="muted small">
                  <b>VaR:</b> geçmiş günlerin %95'inde günlük kayıp bu tutarı aşmamıştır. <b>Beta:</b> 1'den büyükse portföy BIST 100'den daha oynaktır.
                  <b> Sharpe:</b> birim risk başına getiri (risksiz faiz 0 kabul edilmiştir).
                </p>
              </div>
              <div className="card">
                <div className="row between">
                  <h3>Dağılım (TL)</h3>
                  <div className="seg">
                    <button className={allocBy === 'market' ? 'active' : ''} onClick={() => setAllocBy('market')}>Piyasa</button>
                    <button className={allocBy === 'currency' ? 'active' : ''} onClick={() => setAllocBy('currency')}>Para birimi</button>
                    <button className={allocBy === 'asset' ? 'active' : ''} onClick={() => setAllocBy('asset')}>Varlık</button>
                  </div>
                </div>
                <div className="alloc">
                  {an!.allocation[allocBy].map((a, k) => <div key={a.label} style={{ width: `${a.pct}%`, background: PALETTE[k % PALETTE.length] }} title={a.label} />)}
                </div>
                <div className="bars">
                  {an!.allocation[allocBy].map((a, k) => (
                    <div key={a.label} className="bar-row">
                      <span><span className="dot" style={{ background: PALETTE[k % PALETTE.length] }} /> {a.label}</span>
                      <span className="mono small r">{fmtMoney(a.value, 'TRY')}</span>
                      <span className="mono small">%{a.pct.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Pozisyonlar</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Varlık</th><th className="r">Miktar</th><th className="r">Ort. maliyet</th><th className="r">Güncel</th><th className="r">Günlük</th><th className="r">Değer</th><th className="r">Kâr/Zarar</th><th /></tr></thead>
                <tbody>
                  {data.items.map(i => (
                    <tr key={i.id}>
                      <td><div className="sym">{i.symbol}</div><div className="muted small">{i.name}{i.buy_date ? ` · ${i.buy_date}` : ''}</div></td>
                      <td className="r mono">{i.quantity.toLocaleString('tr-TR')}</td>
                      <td className="r mono">{fmtPrice(i.buy_price)}</td>
                      <td className="r mono">{fmtPrice(i.price)}</td>
                      <td className={`r mono ${tone(i.day_change_pct)}`}>{fmtPct(i.day_change_pct)}</td>
                      <td className="r mono">{fmtMoney(i.value, i.currency)}</td>
                      <td className={`r mono ${tone(i.pnl)}`}>{fmtMoney(i.pnl, i.currency)}<div className="small">{fmtPct(i.pnl_pct)}</div></td>
                      <td className="r nowrap"><button className="btn ghost small" onClick={() => sell(i)}>Al / Sat</button>
                        <button className="btn ghost small" onClick={() => remove(i.symbol)}>Sil</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Bu tablodaki kâr/zarar varlığın kendi para birimindedir; üstteki TL toplamları kur farkını da içerir.</p>
          </div>
        </>
      )}

      {data && (data.transactions.length > 0 || orders.length > 0) && (
        <div className="card">
          <div className="row between wrap gap">
            <div className="seg">
              <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>📋 Emirler ({orders.filter(o => o.status === 'open').length} açık)</button>
              <button className={tab === 'advice' ? 'active' : ''} onClick={() => setTab('advice')}>🤖 Portföy Danışmanı</button>
              <button className={tab === 'target' ? 'active' : ''} onClick={() => setTab('target')}>🎯 Hedef Dağılım</button>
              <button className={tab === 'div' ? 'active' : ''} onClick={() => setTab('div')}>💰 Temettüler</button>
              <button className={tab === 'tx' ? 'active' : ''} onClick={() => setTab('tx')}>📜 İşlem Geçmişi ({data.transactions.length})</button>
            </div>
          </div>

          {tab === 'orders' && (
            <div className="table-wrap mt">
              {orders.length === 0 ? <p className="muted">Henüz emir yok. Al / Sat panelinde "Limit emir" veya "Zarar durdur / Kâr al" sekmesinden emir verebilirsiniz.</p> : (
                <table className="table">
                  <thead><tr><th>Varlık</th><th>Emir</th><th className="r">Adet</th><th className="r">Tetik fiyatı</th><th>Durum</th><th>Geçerlilik</th><th>Sonuç</th><th /></tr></thead>
                  <tbody>{orders.map(o => (
                    <tr key={o.id} className={o.status === 'open' ? '' : 'dim'}>
                      <td className="sym">{o.symbol.replace('.IS', '')}</td>
                      <td><span className={`pill ${o.type.endsWith('buy') ? 'up' : 'down'}`}>{o.type_name}</span></td>
                      <td className="r mono">{o.quantity.toLocaleString('tr-TR')}</td>
                      <td className="r mono">{fmtPrice(o.price)}</td>
                      <td>{{ open: '⏳ Bekliyor', filled: '✅ Gerçekleşti', cancelled: 'İptal edildi', expired: 'Süresi doldu', rejected: '⛔ Reddedildi' }[o.status] ?? o.status}
                        {o.reserved_try > 0 && <div className="muted tiny">Bloke: {fmtMoney(o.reserved_try, 'TRY')}</div>}</td>
                      <td className="small">{o.expires ?? 'İptal edilene kadar'}</td>
                      <td className="small">{o.result ?? '—'}</td>
                      <td className="r">{o.status === 'open' && <button className="btn ghost small" onClick={() => cancelOrder(o.id)}>İptal</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <p className="muted small">Bekleyen emirler arka planda dakikada bir güncel fiyatla kontrol edilir; gerçekleşince bildirim gelir.</p>
            </div>
          )}

          {tab === 'advice' && (!advice ? <Loading text="Portföy değerlendiriliyor…" /> : (
            <div className="mt">
              {advice.observations.map((o, i) => (
                <div key={i} className="obs">
                  <span className="obs-icon">{o.level === 'warn' ? '⚠️' : o.level === 'ok' ? '✅' : 'ℹ️'}</span>
                  <div><strong>{o.title}</strong><div className="muted">{o.text}</div></div>
                </div>
              ))}
              {advice.llm_text && <div className="mt"><h3>Yapay Zekâ Değerlendirmesi</h3><Markdown text={advice.llm_text} /></div>}
              <p className="muted small mt">Bu değerlendirme portföyün yapısına dair eğitim amaçlı gözlemlerdir; yatırım tavsiyesi değildir.
                {advice.source !== 'llm' && ' Ayarlar\'da LLM anahtarı tanımlarsanız yapay zekâ yorumu da eklenir.'}</p>
            </div>
          ))}

          {tab === 'target' && (
            <div className="mt">
              <p className="muted small">Her piyasa için portföyde olmasını istediğiniz payı girin. Mevcut dağılımın hedeften sapması ve hedefe dönmek için gereken yaklaşık alım/satım tutarı hesaplanır.</p>
              <table className="table">
                <thead><tr><th>Piyasa</th><th className="r">Mevcut</th><th className="r">Hedef %</th><th className="r">Sapma</th><th className="r">Hedefe dönmek için</th></tr></thead>
                <tbody>
                  {(an && !an.empty ? an.rebalance : []).map(r => (
                    <tr key={r.category}>
                      <td>{r.label}</td>
                      <td className="r mono">%{r.current_pct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                      <td className="r"><input className="target-input" type="number" min={0} max={100} step="any" value={targetsDraft[r.category] ?? ''}
                        onChange={e => setTargetsDraft({ ...targetsDraft, [r.category]: e.target.value })} /></td>
                      <td className={`r mono ${r.diff_pct === null ? '' : Math.abs(r.diff_pct) > 5 ? 'down' : 'up'}`}>{r.diff_pct === null ? '—' : `${r.diff_pct > 0 ? '+' : ''}${r.diff_pct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} puan`}</td>
                      <td className="r mono">{r.amount_try === null ? '—' : <span className={r.amount_try > 0 ? 'up' : 'down'}>{r.amount_try > 0 ? 'Alım ' : 'Satış '}{fmtMoney(Math.abs(r.amount_try), 'TRY')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row gap mt">
                <button className="btn primary" onClick={saveTargets} disabled={targetSum > 100}>Hedefleri kaydet</button>
                <span className={`small ${targetSum > 100 ? 'down' : 'muted'}`}>Toplam: %{targetSum.toFixed(0)}{targetSum > 100 ? ' — %100\'ü geçemez' : ''}</span>
              </div>
            </div>
          )}

          {tab === 'div' && (!divs ? <Loading /> : (
            <div className="mt grid2">
              <div>
                <h3>Alınan Temettüler <span className="muted small">(toplam {fmtMoney(divs.total_try, 'TRY')})</span></h3>
                {divs.payments.length === 0 ? <p className="muted">Elde tutulan sürede temettü ödemesi bulunamadı.</p> : (
                  <table className="table">
                    <thead><tr><th>Tarih</th><th>Hisse</th><th className="r">Hisse başı</th><th className="r">Adet</th><th className="r">Tutar</th><th className="r">TL</th></tr></thead>
                    <tbody>
                      {divs.payments.map((p, i) => (
                        <tr key={i}><td className="nowrap">{p.date}</td><td className="sym">{p.symbol.replace('.IS', '')}</td>
                          <td className="r mono">{fmtPrice(p.per_share)}</td><td className="r mono">{p.quantity.toLocaleString('tr-TR')}</td>
                          <td className="r mono">{fmtMoney(p.amount, p.currency)}</td><td className="r mono up">{fmtMoney(p.amount_try, 'TRY')}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3>Temettü Verimi (son 12 ay)</h3>
                <table className="table">
                  <thead><tr><th>Hisse</th><th className="r">Hisse başı (12 ay)</th><th className="r">Verim</th><th className="r">Son ödeme</th></tr></thead>
                  <tbody>
                    {divs.yields.map(y => (
                      <tr key={y.symbol}><td><span className="sym">{y.symbol.replace('.IS', '')}</span> <span className="muted small">{y.name}</span></td>
                        <td className="r mono">{fmtMoney(y.ttm_per_share, y.currency)}</td><td className="r mono">%{y.yield_pct.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                        <td className="r">{y.last_date ?? '—'}</td></tr>
                    ))}
                    {divs.yields.length === 0 && <tr><td colSpan={4} className="muted">Portföyde hisse senedi yok.</td></tr>}
                  </tbody>
                </table>
                <p className="muted small">Ödemeler, hak kullanım tarihinde elinizde bulunan adet üzerinden hesaplanır (vergi kesintisi hariç).</p>
              </div>
            </div>
          ))}

          {tab === 'tx' && (
            <div className="table-wrap mt">
              <table className="table">
                <thead><tr><th>Tarih</th><th>Varlık</th><th>İşlem</th><th className="r">Miktar</th><th className="r">Fiyat</th><th className="r">Komisyon</th><th className="r">Tutar</th><th className="r">Gerçekleşen K/Z</th><th /></tr></thead>
                <tbody>
                  {data.transactions.map(x => (
                    <tr key={x.id}>
                      <td className="nowrap">{x.date ?? <span className="muted">tarihsiz</span>}</td>
                      <td><span className="sym">{x.symbol}</span>{x.note && <div className="muted small">{x.note}</div>}
                        {(x.reason || x.emotion || x.tag) && <div className="small">📓 {[x.reason, x.emotion, x.tag].filter(Boolean).join(' · ')}</div>}
                        {x.review && <div className="small muted">Değerlendirme: {x.review}</div>}</td>
                      <td><span className={`pill ${x.side === 'buy' ? 'up' : 'down'}`}>{x.side === 'buy' ? 'Alış' : 'Satış'}</span></td>
                      <td className="r mono">{x.quantity.toLocaleString('tr-TR')}</td>
                      <td className="r mono">{fmtPrice(x.price)}</td>
                      <td className="r mono">{x.fee ? fmtPrice(x.fee) : '—'}</td>
                      <td className="r mono">{fmtMoney(x.quantity * x.price, x.currency)}</td>
                      <td className={`r mono ${tone(x.realized_pnl)}`}>{x.realized_pnl === null ? '—' : fmtMoney(x.realized_pnl, x.currency)}</td>
                      <td className="r nowrap"><button className="btn ghost small" onClick={() => setJEdit(x)} title="İşlem günlüğü">📓</button>
                        <button className="btn ghost small" onClick={() => removeTx(x.id)}>Sil</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {jEdit && (
        <Modal title={`İşlem Günlüğü — ${jEdit.symbol} ${jEdit.side === 'buy' ? 'alış' : 'satış'} (${jEdit.date ?? ''})`} onClose={() => setJEdit(null)}>
          <div className="trade-grid">
            <label className="span2">Neden bu işlemi yaptım?<input value={jEdit.reason ?? ''} onChange={e => setJEdit({ ...jEdit, reason: e.target.value })} /></label>
            <label>Duygu durumu<select value={jEdit.emotion ?? ''} onChange={e => setJEdit({ ...jEdit, emotion: e.target.value })}><option value="">Seçiniz</option>{EMOTIONS.map(x => <option key={x}>{x}</option>)}</select></label>
            <label>Etiket<select value={jEdit.tag ?? ''} onChange={e => setJEdit({ ...jEdit, tag: e.target.value })}><option value="">Seçiniz</option>{TAGS.map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="span2">Sonradan değerlendirme (ne öğrendim?)<textarea rows={3} value={jEdit.review ?? ''} onChange={e => setJEdit({ ...jEdit, review: e.target.value })} /></label>
          </div>
          <div className="row gap mt"><button className="btn primary" onClick={saveJournal}>Kaydet</button><button className="btn ghost" onClick={() => setJEdit(null)}>Vazgeç</button></div>
        </Modal>
      )}
      <Disclaimer />
    </div>
  )
}
