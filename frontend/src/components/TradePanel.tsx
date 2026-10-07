import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtPct, fmtPrice, tone } from '../api'
import { SymbolPicker } from './common'

export type Balances = {
  t0: number; t1: number; t2: number; buying_power: number; total_cash: number
  settle_dates: { t0: string; t1: string; t2: string }
}
type Info = {
  symbol: string; name: string; price: number | null; change_pct: number | null; currency: string; fx_rate: number
  holding: number; settlement_days: number; balances: Balances
}

const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-AA-GG (yerel saat)
export const EMOTIONS = ['Sakin', 'Emin', 'Heyecanlı', 'Aceleci', 'Korkulu', 'FOMO (fırsatı kaçırma korkusu)', 'İntikam (zararı telafi)']
export const TAGS = ['Teknik analiz', 'Temel analiz', 'Haber / KAP', 'Temettü', 'Uzun vade', 'Kısa vade', 'Bot / otomatik', 'Deneme']
type Mode = 'market' | 'limit' | 'stop'

/** Al / Sat paneli: güncel fiyat ve tarih otomatik dolar; alım gücü ve eldeki adet kontrol edilir. */
export default function TradePanel({ symbol: fixed, onDone, compact }: { symbol?: string; onDone?: () => void; compact?: boolean }) {
  const [symbol, setSymbol] = useState(fixed ?? '')
  const [info, setInfo] = useState<Info | null>(null)
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [priceTouched, setPriceTouched] = useState(false)
  const [date, setDate] = useState(today())
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<Mode>('market')
  const [expires, setExpires] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [tpPrice, setTpPrice] = useState('')
  const [journal, setJournal] = useState(false)
  const [reason, setReason] = useState('')
  const [emotion, setEmotion] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { if (fixed) setSymbol(fixed) }, [fixed])
  const loadInfo = (sym = symbol, keepPrice = priceTouched) => {
    if (!sym) { setInfo(null); return }
    api<Info>(`/trade/info?symbol=${encodeURIComponent(sym)}`).then(i => {
      setInfo(i)
      if (!keepPrice && i.price) setPrice(String(+i.price.toPrecision(8)))
    }).catch(e => setMsg({ ok: false, text: e.message }))
  }
  useEffect(() => { setPriceTouched(false); setQty(''); setMsg(null); setDate(today()); loadInfo(symbol, false) }, [symbol])
  // Fiyat kullanıcı değiştirmediyse 30 saniyede bir güncellenir
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) loadInfo() }, 30_000); return () => clearInterval(id) }, [symbol, priceTouched])

  const q = +qty || 0, p = +price || 0, f = +fee || 0
  const rate = info?.fx_rate ?? 1
  const totalTry = (q * p + f) * rate
  const proceedsTry = (q * p - f) * rate
  const bp = info?.balances.buying_power ?? 0
  const held = info?.holding ?? 0
  const canBuy = !!info && q > 0 && p > 0 && bp > 0 && totalTry <= bp + 1e-6
  const canSell = !!info && q > 0 && p > 0 && held > 0 && q <= held + 1e-9
  const buyReason = !info ? '' : bp <= 0 ? 'Alım gücünüz sıfır.' : q > 0 && totalTry > bp ? 'Yetersiz bakiye.' : ''
  const sellReason = !info ? '' : held <= 0 ? 'Bu varlık portföyünüzde yok.' : q > held ? `Elinizde yalnızca ${held.toLocaleString('tr-TR')} adet var.` : ''
  const future = date > today()
  const settleText = info ? (info.settlement_days ? `T+${info.settlement_days} takas` : 'Anında takas') : ''

  // Hisse senetleri tam adet, kripto/döviz/emtia küsuratlı alınabilir
  const fractional = /-USD$|=X$|=F$|^GRAM-/.test(symbol)
  const fraction = (k: number) => {
    if (p <= 0) return
    const units = Math.max(0, bp * k / rate - f) / p
    setQty(String(fractional ? Math.floor(units * 10000) / 10000 : Math.floor(units)))
  }

  const submit = async (side: 'buy' | 'sell') => {
    setBusy(true); setMsg(null)
    try {
      if (mode === 'limit') {
        await api('/orders', { body: { symbol, type: side === 'buy' ? 'limit_buy' : 'limit_sell', quantity: q, price: p, expires: expires || null, note: note || null } })
        setMsg({ ok: true, text: `Limit ${side === 'buy' ? 'alış' : 'satış'} emri verildi: ${q.toLocaleString('tr-TR')} adet @ ${fmtPrice(p)}. Fiyat bu seviyeye gelince gerçekleşir; Portföy → Emirler'den izleyebilirsiniz.` })
      } else {
        await api('/portfolio/transactions', { body: { symbol, side, quantity: q, price: p, date: date || null, fee: f, note: note || null,
          reason: reason || null, emotion: emotion || null, tag: tag || null } })
        setMsg({ ok: true, text: `${side === 'buy' ? 'Alış' : 'Satış'} gerçekleşti: ${q.toLocaleString('tr-TR')} adet ${symbol.replace('.IS', '')} · ${fmtMoney(side === 'buy' ? totalTry : proceedsTry, 'TRY')}` })
      }
      setQty(''); setNote(''); setReason('')
      loadInfo()
      onDone?.()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  const placeStops = async () => {
    setBusy(true); setMsg(null)
    try {
      const done: string[] = []
      if (+stopPrice > 0) { await api('/orders', { body: { symbol, type: 'stop_loss', quantity: q, price: +stopPrice, expires: expires || null } }); done.push(`zarar durdur @ ${fmtPrice(+stopPrice)}`) }
      if (+tpPrice > 0) { await api('/orders', { body: { symbol, type: 'take_profit', quantity: q, price: +tpPrice, expires: expires || null } }); done.push(`kâr al @ ${fmtPrice(+tpPrice)}`) }
      setMsg({ ok: true, text: `Emir verildi: ${q.toLocaleString('tr-TR')} adet için ${done.join(' ve ')}.` })
      setStopPrice(''); setTpPrice(''); loadInfo(); onDone?.()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  const switchMode = (m: Mode) => {
    setMode(m); setMsg(null)
    if (m === 'market' && info?.price) { setPriceTouched(false); setPrice(String(+info.price.toPrecision(8))) }
    if (m === 'limit') setPriceTouched(true)
    if (m === 'stop' && held > 0) setQty(String(held))
  }

  return (
    <div className={`trade ${compact ? 'compact' : ''}`}>
      <div className="seg trade-modes">
        <button type="button" className={mode === 'market' ? 'active' : ''} onClick={() => switchMode('market')}>Piyasa</button>
        <button type="button" className={mode === 'limit' ? 'active' : ''} onClick={() => switchMode('limit')}>Limit emir</button>
        <button type="button" className={mode === 'stop' ? 'active' : ''} onClick={() => switchMode('stop')}>Zarar durdur / Kâr al</button>
      </div>
      {!fixed && <label className="trade-symbol">Varlık<SymbolPicker value={symbol} onChange={setSymbol} placeholder="Alınacak / satılacak varlığı seçin" /></label>}
      {info && (
        <div className="trade-head">
          <div><span className="sym">{info.symbol.replace('.IS', '')}</span> <span className="muted small">{info.name}</span></div>
          <div className="row gap">
            <span className="mono strong">{fmtPrice(info.price)} {info.currency}</span>
            <span className={`small ${tone(info.change_pct)}`}>{fmtPct(info.change_pct)}</span>
          </div>
        </div>
      )}
      {info && (
        <div className="balances">
          <div><span className="muted small">Alım gücü (T2)</span><strong className={bp <= 0 ? 'down' : ''}>{fmtMoney(bp, 'TRY')}</strong></div>
          <div><span className="muted small">T0</span><span className="mono">{fmtMoney(info.balances.t0, 'TRY')}</span></div>
          <div><span className="muted small">T1</span><span className="mono">{fmtMoney(info.balances.t1, 'TRY')}</span></div>
          <div><span className="muted small">T2</span><span className="mono">{fmtMoney(info.balances.t2, 'TRY')}</span></div>
          <div><span className="muted small">Eldeki adet</span><span className="mono">{held.toLocaleString('tr-TR')}</span></div>
        </div>
      )}
      <div className="trade-grid">
        <label>Adet<input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" /></label>
        {mode !== 'stop' && <label>{mode === 'limit' ? 'Limit fiyat' : 'Fiyat'} ({info?.currency ?? '—'})
          <input type="number" min="0" step="any" value={price} onChange={e => { setPrice(e.target.value); setPriceTouched(true) }} />
        </label>}
        {mode === 'stop' && <>
          <label>Zarar durdur fiyatı<input type="number" min="0" step="any" value={stopPrice} onChange={e => setStopPrice(e.target.value)} placeholder={info?.price ? fmtPrice(info.price * 0.95) : ''} /></label>
          <label>Kâr al fiyatı<input type="number" min="0" step="any" value={tpPrice} onChange={e => setTpPrice(e.target.value)} placeholder={info?.price ? fmtPrice(info.price * 1.1) : ''} /></label>
        </>}
        {mode === 'market' ? <label>İşlem tarihi<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          : <label>Geçerlilik (boş: iptal edilene kadar)<input type="date" min={today()} value={expires} onChange={e => setExpires(e.target.value)} /></label>}
        {mode === 'market' && <label>Komisyon ({info?.currency ?? '—'})<input type="number" min="0" step="any" value={fee} onChange={e => setFee(e.target.value)} placeholder="0" /></label>}
        {!compact && <label className="span2">Not<input value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı" /></label>}
      </div>
      {mode === 'market' && (
        <div className="journal-box">
          <button type="button" className="btn ghost small" onClick={() => setJournal(!journal)}>📓 {journal ? 'Günlük notunu gizle' : 'İşlem günlüğüne not ekle'}</button>
          {journal && (
            <div className="trade-grid mt">
              <label className="span2">Neden bu işlemi yapıyorum?<input value={reason} onChange={e => setReason(e.target.value)} placeholder="ör. Direnç kırılımı, güçlü bilanço…" /></label>
              <label>Duygu durumu<select value={emotion} onChange={e => setEmotion(e.target.value)}><option value="">Seçiniz</option>{EMOTIONS.map(x => <option key={x}>{x}</option>)}</select></label>
              <label>Etiket<select value={tag} onChange={e => setTag(e.target.value)}><option value="">Seçiniz</option>{TAGS.map(x => <option key={x}>{x}</option>)}</select></label>
            </div>
          )}
        </div>
      )}
      <div className="row gap wrap small">
        <span className="muted">Hızlı adet:</span>
        {[0.25, 0.5, 1].map(k => <button key={k} type="button" className="btn ghost small" onClick={() => fraction(k)} disabled={!info || p <= 0}>Alım gücünün %{k * 100}</button>)}
        {held > 0 && <button type="button" className="btn ghost small" onClick={() => setQty(String(held))}>Tümünü sat ({held.toLocaleString('tr-TR')})</button>}
        {priceTouched && info?.price && <button type="button" className="btn ghost small" onClick={() => { setPriceTouched(false); setPrice(String(+info.price!.toPrecision(8))) }}>Güncel fiyatı kullan</button>}
      </div>
      <div className="trade-total">
        <span>Tutar: <strong className="mono">{fmtMoney(q * p, info?.currency ?? 'TRY')}</strong>{rate !== 1 && <span className="muted small"> ≈ {fmtMoney(q * p * rate, 'TRY')} (kur {fmtPrice(rate)})</span>}</span>
        <span className="muted small">{settleText}{future ? ' · ileri tarihli işlem' : ''}</span>
      </div>
      {msg && <div className={msg.ok ? 'info-box' : 'error-box'}>{msg.text}</div>}
      {mode === 'stop' ? (
        <div className="trade-actions single">
          <button type="button" className="btn sell" disabled={busy || !(q > 0 && q <= held) || !(+stopPrice > 0 || +tpPrice > 0)} onClick={placeStops}>
            🛡 Emirleri ver{held > 0 ? '' : ' (önce bu varlığı almalısınız)'}</button>
        </div>
      ) : (
        <div className="trade-actions">
          <button type="button" className="btn buy" disabled={!canBuy || busy} onClick={() => submit('buy')} title={buyReason}>{mode === 'limit' ? 'LİMİT AL' : 'AL'}{q > 0 && p > 0 ? ` · ${fmtMoney(totalTry, 'TRY')}` : ''}</button>
          <button type="button" className="btn sell" disabled={!canSell || busy} onClick={() => submit('sell')} title={sellReason}>{mode === 'limit' ? 'LİMİT SAT' : 'SAT'}{q > 0 && p > 0 ? ` · ${fmtMoney(proceedsTry, 'TRY')}` : ''}</button>
        </div>
      )}
      {mode === 'limit' && <div className="muted small">Limit alış: fiyat limitinize veya altına inince; limit satış: limitinize veya üstüne çıkınca gerçekleşir. Limit alış emri, tutarı kadar alım gücünü bloke eder.</div>}
      {mode === 'stop' && <div className="muted small">Zarar durdur: fiyat bu seviyeye veya altına inerse; kâr al: bu seviyeye veya üstüne çıkarsa elinizdeki adet piyasa fiyatından satılır. İkisini birlikte girebilirsiniz.</div>}
      {(buyReason || sellReason) && q > 0 && <div className="muted small">{[buyReason && `Alış: ${buyReason}`, sellReason && `Satış: ${sellReason}`].filter(Boolean).join(' · ')}</div>}
    </div>
  )
}

/** Tablolardaki "Al/Sat" düğmesinden açılan pencere. */
export function TradeModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="row between"><h3>Al / Sat</h3><button className="btn ghost small" onClick={onClose}>✕</button></div>
        <TradePanel symbol={symbol} compact />
      </div>
    </div>
  )
}
