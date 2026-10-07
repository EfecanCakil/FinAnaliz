import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, fmtPct, fmtPrice, type Point } from '../api'
import Chart, { COLORS, type SeriesSpec } from '../components/Chart'
import { ErrorBox, SymbolPicker } from '../components/common'
import { CountMoney, confetti } from '../components/fx'
import { Skeleton } from '../components/ui'

type Res = {
  symbol: string; name: string; currency: string; start_date: string; start_price: number; end_price: number; shares: number
  amount: number; final: number; return_pct: number; cagr_pct: number; max_value: number; min_value: number; max_drawdown_pct: number; years: number
  series: Point[]; alternatives?: Record<string, number>
}
const PRESETS = [
  { s: 'THYAO.IS', d: '2020-03-23', l: 'THY, pandemi dibinde' }, { s: 'ASELS.IS', d: '2021-01-04', l: 'Aselsan, 2021 başında' },
  { s: 'NVDA', d: '2022-10-14', l: 'NVIDIA, yapay zekâ öncesi' }, { s: 'BTC-USD', d: '2020-01-01', l: 'Bitcoin, 2020 başında' },
  { s: 'GRAM-ALTIN', d: '2019-01-02', l: 'Gram altın, 2019 başında' }, { s: 'USDTRY=X', d: '2018-01-02', l: 'Dolar, 2018 başında' },
]

export default function TimeTravel() {
  const [symbol, setSymbol] = useState('THYAO.IS')
  const [date, setDate] = useState('2020-03-23')
  const [amount, setAmount] = useState('10000')
  const [res, setRes] = useState<Res | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reveal, setReveal] = useState(0)

  const run = (s = symbol, d = date) => {
    setBusy(true); setError(null); setRes(null)
    api<Res>(`/timetravel?symbol=${encodeURIComponent(s)}&start=${d}&amount=${+amount || 10000}`)
      .then(r => { setRes(r); setReveal(0); if (r.return_pct > 100) setTimeout(() => confetti(), 1600) })
      .catch(e => setError(e.message)).finally(() => setBusy(false))
  }
  useEffect(() => { run() }, [])
  // Grafiği soldan sağa "çizerek" göster
  useEffect(() => {
    if (!res) return
    if (document.hidden) { setReveal(res.series.length); return }
    const id = setInterval(() => setReveal(r => { if (r >= res.series.length) { clearInterval(id); return r } return Math.min(res.series.length, r + Math.ceil(res.series.length / 60)) }), 25)
    return () => clearInterval(id)
  }, [res])
  const series = useMemo<SeriesSpec[]>(() => res ? [{ kind: 'area', data: res.series.slice(0, Math.max(2, reveal)), color: res.return_pct >= 0 ? COLORS.up : COLORS.down, title: 'Yatırım değeri' }] : [], [res, reveal])
  const cur = res?.currency === 'TRY' ? 'TRY' : 'USD'

  return (
    <div className="page">
      <header className="page-head"><div><h1>Geçmişe Yolculuk</h1><p className="muted">"O gün şu kadar yatırsaydım bugün ne olurdu?" sorusunun cevabı</p></div></header>
      <div className="card">
        <div className="tt-form">
          <label>Varlık<SymbolPicker value={symbol} onChange={setSymbol} /></label>
          <label>Yatırım tarihi<input type="date" value={date} max={new Date().toLocaleDateString('sv-SE')} onChange={e => setDate(e.target.value)} /></label>
          <label>Tutar ({symbol.endsWith('.IS') || symbol.includes('TRY') || symbol.startsWith('GRAM') ? 'TL' : 'USD'})<input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <button className="btn primary" onClick={() => run()} disabled={busy}>{busy ? 'Hesaplanıyor…' : '⏳ Zamanda yolculuk yap'}</button>
        </div>
        <div className="chips mt">{PRESETS.map(p => <button key={p.l} className="chip" onClick={() => { setSymbol(p.s); setDate(p.d); run(p.s, p.d) }}>{p.l}</button>)}</div>
      </div>
      <ErrorBox error={error} />
      {busy && <Skeleton rows={5} />}
      {res && (
        <>
          <div className="card tt-hero">
            <div className="muted">{new Date(res.start_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} tarihinde {res.name} için yatırılan</div>
            <div className="tt-line"><span className="mono">{fmtMoney(res.amount, cur)}</span><span className="tt-arrow">→</span>
              <span className={`tt-final ${res.return_pct >= 0 ? 'up' : 'down'}`}><CountMoney value={res.final} currency={cur} /></span></div>
            <div className="row gap wrap center-row">
              <span className={`pill ${res.return_pct >= 0 ? 'up' : 'down'}`}>Toplam {fmtPct(res.return_pct)}</span>
              <span className="pill">Yıllık ortalama {fmtPct(res.cagr_pct)}</span>
              <span className="pill">{res.years.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} yıl</span>
              <span className="pill down">En büyük düşüş {fmtPct(res.max_drawdown_pct)}</span>
            </div>
            <div className="muted small">{res.shares.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} adet × {fmtPrice(res.start_price)} → bugün {fmtPrice(res.end_price)}</div>
          </div>
          <div className="grid-trade">
            <div className="card"><h3>Yatırımın Değeri</h3><Chart series={series} height={320} /></div>
            <div className="card">
              <h3>Aynı Para Başka Yere Yatırılsaydı</h3>
              {res.alternatives ? (
                <div className="bars">
                  {[[res.name, res.final] as [string, number], ...Object.entries(res.alternatives)].sort((a, b) => b[1] - a[1]).map(([k, v], i) => {
                    const max = Math.max(res.final, ...Object.values(res.alternatives!))
                    return (
                      <div key={k} className="tt-alt">
                        <div className="row between small"><span className={k === res.name ? 'strong' : ''}>{i === 0 ? '🏆 ' : ''}{k}</span><span className="mono">{fmtMoney(v, 'TRY')}</span></div>
                        <div className="bar"><div style={{ width: `${v / max * 100}%`, background: k === res.name ? 'var(--accent)' : k.startsWith('Enflasyon') ? 'var(--down)' : 'var(--muted)' }} /></div>
                      </div>
                    )
                  })}
                  <p className="muted small mt">"Enflasyon" satırı, paranın aynı alım gücünü koruması için bugün ulaşması gereken tutardır (TÜFE).</p>
                </div>
              ) : <p className="muted">Karşılaştırma TL bazlı varlıklar için gösterilir.</p>}
            </div>
          </div>
          <p className="disclaimer">Geçmiş getiriler geleceğin göstergesi değildir. Hesaplamaya temettüler ve işlem maliyetleri dahil değildir.</p>
        </>
      )}
    </div>
  )
}
