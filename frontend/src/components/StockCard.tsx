import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtBig, fmtMoney, fmtPct, fmtPrice, MARKET_LABELS, tone, type Point } from '../api'
import Chart, { COLORS, type SeriesSpec } from './Chart'
import { TradeModal } from './TradePanel'
import Term from './Term'
import { friendlyError } from '../errors'
import { ProtectionEditor, type Protection } from './PortfolioPlus'

// Herhangi bir listede hisseye tıklayınca sağdan açılan özet kart. openStock("THYAO.IS") ile her yerden açılır.
export function openStock(symbol: string) {
  window.dispatchEvent(new CustomEvent('finanaliz:stock', { detail: symbol }))
}

type Card = {
  symbol: string; name: string; market: string; currency: string; price: number
  change_pct: number | null; change_1w: number | null; change_1m: number | null; change_1y: number | null
  high_52w: number; low_52w: number; series: Point[]; overall: string; rsi: number; vol_ratio: number | null
  fundamentals: { market_cap: number | null; pe: number | null; pb: number | null; dividend_yield: number | null; roe: number | null; profit_margin: number | null } | null
  news: { title: string; link: string; source: string; time: number | null; sentiment: string }[]
  kap: { title: string; time: number | null; url: string }[]
  why: string[]; favorite: boolean; alerts: number; as_of: number
  position: Position | null
}
type Position = {
  quantity: number; avg_cost: number | null; cost: number | null; value: number | null; pnl: number | null; pnl_pct: number | null
  day_pnl: number | null; realized: number; currency: string; first_buy: string | null; trade_count: number; buy_qty: number; sell_qty: number
  transactions: { date: string | null; side: 'buy' | 'sell'; quantity: number; price: number; fee: number }[]
  orders: { id: number; type: string; quantity: number; price: number; expires: string | null }[]
  protection: Protection
}
const ORDER_TR: Record<string, string> = { limit_buy: 'Limit alış', limit_sell: 'Limit satış', stop_loss: 'Zarar durdur', take_profit: 'Kâr al' }

const ago = (t: number | null) => {
  if (!t) return ''
  const m = Math.round((Date.now() / 1000 - t) / 60)
  return m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`
}

export default function StockCard() {
  const [symbol, setSymbol] = useState<string | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trade, setTrade] = useState<false | { qty?: number }>(false)
  const [alarm, setAlarm] = useState<{ cond: 'above' | 'below'; value: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    const open = (e: Event) => setSymbol((e as CustomEvent<string>).detail)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSymbol(null) }
    window.addEventListener('finanaliz:stock', open)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('finanaliz:stock', open); window.removeEventListener('keydown', esc) }
  }, [])

  useEffect(() => {
    setCard(null); setError(null); setMsg(null); setAlarm(null)
    if (!symbol) return
    let alive = true
    api<Card>(`/stock-card/${encodeURIComponent(symbol)}`).then(c => { if (alive) setCard(c) }).catch(e => { if (alive) setError(friendlyError(e)) })
    return () => { alive = false }
  }, [symbol, retry])

  const series = useMemo<SeriesSpec[]>(() => {
    if (!card?.series.length) return []
    const up = card.series[card.series.length - 1].value >= card.series[0].value
    return [{ kind: 'area', data: card.series, color: up ? COLORS.up : COLORS.down }]
  }, [card])

  if (!symbol) return null
  const close = () => setSymbol(null)
  const go = (to: string) => { close(); nav(to) }
  const short = symbol.replace('.IS', '')

  const toggleFav = async () => {
    if (!card) return
    try {
      if (card.favorite) await api(`/watchlist/${encodeURIComponent(card.symbol)}`, { method: 'DELETE' })
      else await api('/watchlist', { body: { symbol: card.symbol } })
      setCard({ ...card, favorite: !card.favorite })
      setMsg(card.favorite ? 'Favorilerden çıkarıldı.' : '★ Favorilere eklendi.')
    } catch (e) { setMsg(friendlyError(e)) }
  }
  const saveAlarm = async () => {
    if (!card || !alarm) return
    const v = Number(alarm.value.replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) { setMsg('Geçerli bir fiyat girin.'); return }
    try {
      await api('/alerts', { body: { symbol: card.symbol, condition: alarm.cond, target: v } }); window.dispatchEvent(new Event('finanaliz:alarm-set'))
      setCard({ ...card, alerts: card.alerts + 1 }); setAlarm(null)
      setMsg(`🔔 Alarm kuruldu: fiyat ${fmtPrice(v)} ${alarm.cond === 'above' ? 'üzerine çıkınca' : 'altına inince'} bildirim alacaksınız.`)
    } catch (e) { setMsg(friendlyError(e)) }
  }
  const addToCompare = () => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem('finanaliz_compare') || '[]')
      if (!list.includes(symbol)) localStorage.setItem('finanaliz_compare', JSON.stringify([...list, symbol].slice(-6)))
    } catch { /* yoksay */ }
    go('/karsilastir')
  }
  const f = card?.fundamentals
  const pos52 = card ? Math.min(100, Math.max(0, (card.price - card.low_52w) / Math.max(card.high_52w - card.low_52w, 1e-9) * 100)) : 0

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={`${short} özeti`}>
        <div className="drawer-head">
          <div>
            <div className="title-sym">{short}</div>
            <div className="muted small">{card?.name ?? '…'}{card ? ` · ${MARKET_LABELS[card.market] ?? card.market}` : ''}</div>
          </div>
          <div className="row gap">
            {card && <button className={`star big ${card.favorite ? 'on' : ''}`} onClick={toggleFav} title={card.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}>{card.favorite ? '★' : '☆'}</button>}
            <button className="tab-x big" onClick={close} title="Kapat (Esc)">×</button>
          </div>
        </div>

        {error && <div className="drawer-body"><div className="error-box">{error}</div>
          <div className="row gap"><button className="btn ghost" onClick={() => setRetry(r => r + 1)}>↻ Tekrar dene</button>
            <button className="btn ghost" onClick={() => go(`/analiz?s=${encodeURIComponent(symbol)}`)}>📈 Grafiğe git</button></div></div>}
        {!card && !error && <div className="drawer-loading"><div className="skeleton" style={{ height: 40 }} /><div className="skeleton" style={{ height: 160 }} /><div className="skeleton" style={{ height: 90 }} /></div>}
        {card && (
          <div className="drawer-body">
            <div className="row gap wrap" style={{ alignItems: 'baseline' }}>
              <span className="drawer-price mono">{fmtPrice(card.price)} <small>{card.currency}</small></span>
              <span className={`pill ${tone(card.change_pct)}`}>{fmtPct(card.change_pct)} bugün</span>
            </div>
            <div className="drawer-changes">
              {([['1 hafta', card.change_1w], ['1 ay', card.change_1m], ['1 yıl', card.change_1y]] as const).map(([l, v]) => (
                <div key={l}><span className="muted small">{l}</span><b className={`mono ${tone(v)}`}>{fmtPct(v)}</b></div>
              ))}
            </div>
            {card.position && <PositionBox p={card.position} symbol={card.symbol} price={card.price} onChanged={() => setRetry(r => r + 1)} onSellAll={() => setTrade({ qty: card.position!.quantity })} />}
            {series.length > 0 && <Chart series={series} height={160} />}
            <div className="muted small">Son 3 ay · Veri tarihi: {new Date(card.as_of * 1000).toLocaleDateString('tr-TR')} (gecikmeli olabilir)</div>

            <div className="drawer-why">
              <h4>💬 Bugün ne oluyor?</h4>
              <ul>{card.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>

            <div className="fact-grid">
              <div><span className="muted small"><Term k="signal">Teknik görünüm</Term></span>
                <b><span className={`pill ${card.overall.includes('Al') ? 'up' : card.overall.includes('Sat') ? 'down' : ''}`}>{card.overall}</span></b></div>
              <div><span className="muted small"><Term k="rsi">RSI</Term></span><b className="mono">{card.rsi.toFixed(0)}</b></div>
              {f?.market_cap != null && <div><span className="muted small"><Term k="market_cap">Piyasa değeri</Term></span><b className="mono">{fmtBig(f.market_cap, card.currency)}</b></div>}
              {f?.pe != null && <div><span className="muted small"><Term k="pe">F/K</Term></span><b className="mono">{f.pe.toFixed(1)}</b></div>}
              {f?.pb != null && <div><span className="muted small"><Term k="pb">PD/DD</Term></span><b className="mono">{f.pb.toFixed(2)}</b></div>}
              {f?.dividend_yield != null && f.dividend_yield > 0 && <div><span className="muted small"><Term k="dividend_yield">Temettü verimi</Term></span><b className="mono">{fmtPct(f.dividend_yield, false)}</b></div>}
            </div>
            <div>
              <div className="row between small"><span className="muted"><Term k="high_52w">52 haftalık aralık</Term></span><span className="muted">{fmtPrice(card.low_52w)} – {fmtPrice(card.high_52w)}</span></div>
              <div className="range-track"><div className="range-dot" style={{ left: `${pos52}%` }} /></div>
            </div>

            {msg && <div className="info-box">{msg}</div>}
            {alarm ? (
              <div className="alarm-quick">
                <select value={alarm.cond} onChange={e => setAlarm({ ...alarm, cond: e.target.value as 'above' | 'below' })}>
                  <option value="above">Fiyat şunun üzerine çıkınca</option><option value="below">Fiyat şunun altına inince</option>
                </select>
                <input inputMode="decimal" value={alarm.value} onChange={e => setAlarm({ ...alarm, value: e.target.value })} />
                <button className="btn primary small" onClick={saveAlarm}>Kur</button>
                <button className="btn ghost small" onClick={() => setAlarm(null)}>Vazgeç</button>
              </div>
            ) : null}
            <div className="drawer-actions">
              <button className="btn primary" onClick={() => setTrade({})}>Al / Sat</button>
              <button className="btn ghost" onClick={() => setAlarm({ cond: 'above', value: (card.price * 1.05).toFixed(card.price < 10 ? 3 : 2) })}>🔔 Alarm kur{card.alerts ? ` (${card.alerts})` : ''}</button>
              <button className="btn ghost" onClick={() => go(`/analiz?s=${encodeURIComponent(card.symbol)}`)}>📈 Detaylı grafik</button>
              <button className="btn ghost" onClick={addToCompare}>⇄ Karşılaştır</button>
              {(card.market === 'bist' || card.market === 'us') && <button className="btn ghost" onClick={() => go(`/temel?s=${encodeURIComponent(card.symbol)}`)}>📋 Bilanço özeti & benzer hisseler</button>}
            </div>

            {(card.kap.length > 0 || card.news.length > 0) && (
              <div>
                <h4>📰 Son gelişmeler</h4>
                <ul className="drawer-news">
                  {card.kap.map(k => <li key={k.url}><a href={k.url} target="_blank" rel="noreferrer"><span className="pill">KAP</span> {k.title}</a><span className="muted small"> · {ago(k.time)}</span></li>)}
                  {card.news.map(n => <li key={n.link}><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a><span className="muted small"> · {n.source} · {ago(n.time)}</span></li>)}
                </ul>
              </div>
            )}
            <p className="muted small">Bu bilgiler eğitim amaçlıdır; yatırım tavsiyesi değildir.</p>
          </div>
        )}
      </aside>
      {trade && card && <TradeModal symbol={card.symbol} initialQty={trade.qty} onClose={() => setTrade(false)} onDone={() => setRetry(r => r + 1)} />}
    </>
  )
}

// "Pozisyonum": kullanıcının bu varlıktaki adedi, maliyeti, kâr/zararı, son işlemleri ve bekleyen emirleri
function PositionBox({ p, symbol, price, onSellAll, onChanged }: { p: Position; symbol: string; price: number; onSellAll: () => void; onChanged: () => void }) {
  const has = p.quantity > 0
  return (
    <div className="pos-box">
      <div className="row between"><h4>💼 Pozisyonum</h4>{has && p.first_buy && <span className="muted small">İlk alış: {new Date(p.first_buy).toLocaleDateString('tr-TR')}</span>}</div>
      {has ? (
        <>
          <div className="pos-pnl">
            <div><span className="muted small">Toplam kâr / zarar</span><b className={`mono ${tone(p.pnl)}`}>{fmtMoney(p.pnl, p.currency)}</b><span className={`small ${tone(p.pnl_pct)}`}>{fmtPct(p.pnl_pct)}</span></div>
            <div><span className="muted small">Bugün</span><b className={`mono ${tone(p.day_pnl)}`}>{fmtMoney(p.day_pnl, p.currency)}</b></div>
          </div>
          <div className="fact-grid">
            <div><span className="muted small">Adet</span><b className="mono">{p.quantity.toLocaleString('tr-TR')}</b></div>
            <div><span className="muted small">Ortalama maliyet</span><b className="mono">{fmtPrice(p.avg_cost)}</b></div>
            <div><span className="muted small">Toplam maliyet</span><b className="mono">{fmtMoney(p.cost, p.currency)}</b></div>
            <div><span className="muted small">Güncel değer</span><b className="mono">{fmtMoney(p.value, p.currency)}</b></div>
          </div>
        </>
      ) : <p className="muted small">Bu varlık şu an portföyünüzde yok{p.trade_count ? ` (daha önce ${p.trade_count} işlem yaptınız)` : ''}.</p>}
      {p.realized !== 0 && <div className="small">Satışlardan gerçekleşen kâr/zarar: <b className={`mono ${tone(p.realized)}`}>{fmtMoney(p.realized, p.currency)}</b></div>}
      {has && <ProtectionEditor key={`${p.protection.target}-${p.protection.stop}-${p.protection.mode}`} symbol={symbol} price={price} avgCost={p.avg_cost}
        quantity={p.quantity} currency={p.currency} value={p.protection} onSaved={onChanged} />}
      {p.orders.filter(o => o.type !== 'stop_loss' && o.type !== 'take_profit').length > 0 && (
        <div className="small">
          <div className="muted">Bekleyen emirler</div>
          {p.orders.filter(o => o.type !== 'stop_loss' && o.type !== 'take_profit').map(o => <div key={o.id} className="pos-line"><span className="pill">{ORDER_TR[o.type] ?? o.type}</span> {o.quantity.toLocaleString('tr-TR')} adet @ <b className="mono">{fmtPrice(o.price)}</b></div>)}
        </div>
      )}
      {p.transactions.length > 0 && (
        <details className="pos-tx">
          <summary className="small">Son işlemler ({p.trade_count}) · toplam {p.buy_qty.toLocaleString('tr-TR')} adet alış, {p.sell_qty.toLocaleString('tr-TR')} adet satış</summary>
          {p.transactions.map((t, i) => (
            <div key={i} className="pos-line small">
              <span className={`pill ${t.side === 'buy' ? 'up' : 'down'}`}>{t.side === 'buy' ? 'Alış' : 'Satış'}</span>
              <span className="muted">{t.date ? new Date(t.date).toLocaleDateString('tr-TR') : '—'}</span>
              <span className="mono">{t.quantity.toLocaleString('tr-TR')} × {fmtPrice(t.price)}</span>
            </div>
          ))}
        </details>
      )}
      {has && <button className="btn ghost small danger" onClick={onSellAll}>Tümünü sat ({p.quantity.toLocaleString('tr-TR')} adet)</button>}
    </div>
  )
}
