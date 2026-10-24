import { useEffect, useMemo, useState } from 'react'
import { api, fmtPct, tone } from '../api'
import Chart, { COLORS, type SeriesSpec } from '../components/Chart'
import { ErrorBox, Loading } from '../components/common'
import { openStock } from '../components/StockCard'

type Profile = { key: string; label: string; real: number; vol: number; mix: string }
type Goal = {
  target: number; years: number; months: number; start: number; monthly: number; required_monthly: number; safe_monthly: number
  profile: Profile; probability: number; expected_final: number; median_final: number; p10_final: number; p90_final: number
  total_contributed: number; median_months_to_target: number | null; inflation_now: number | null; nominal_target: number | null
  verdict: { tone: 'good' | 'neutral' | 'bad'; text: string }; options: { monthly: number; probability: number }[]
  chart: { times: number[]; p10: number[]; p50: number[]; p90: number[]; contributed: number[] }; profiles: Profile[]; note: string
}
type Real = { empty: boolean; summary: string; source: string; beat: number; count: number
  totals: { cost_try: number; cost_real: number; value_try: number; nominal_pnl: number; real_pnl: number; nominal_pct: number | null; real_pct: number | null; eroded: number }
  items: { symbol: string; name: string; since: string; cost_try: number; cost_real: number; value_try: number; nominal_pnl: number; nominal_pct: number | null; real_pnl: number; real_pct: number | null; inflation_pct: number }[] }

const TL = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 })
const tl = (v: number | null | undefined) => v == null || Number.isNaN(v) ? '—' : TL.format(v)
const parse = (s: string) => { const v = Number(s.replace(/\./g, '').replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null }
const fmtIn = (v: number) => Math.round(v).toLocaleString('tr-TR')

function GoalPlanner() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [target, setTarget] = useState('500.000')
  const [years, setYears] = useState(3)
  const [start, setStart] = useState('')
  const [monthly, setMonthly] = useState('')
  const [profile, setProfile] = useState('dengeli')
  const [g, setG] = useState<Goal | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ equity: number; profiles: Profile[] }>('/planner/start').then(d => { setProfiles(d.profiles); setStart(fmtIn(d.equity)) }).catch(() => {})
  }, [])

  const calc = async (m: string = monthly) => {
    const t = parse(target)
    if (!t) { setErr('Geçerli bir hedef tutar girin.'); return }
    setBusy(true); setErr(null)
    try {
      setG(await api<Goal>('/planner/goal', { body: { target: t, years, monthly: parse(m), start: parse(start), profile } }))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const series = useMemo<SeriesSpec[]>(() => {
    if (!g) return []
    const pts = (arr: number[]) => g.chart.times.map((t, i) => ({ time: t, value: arr[i] }))
    return [
      { kind: 'line', data: pts(g.chart.p90), color: COLORS.up, title: 'İyi senaryo (%90)', width: 1 },
      { kind: 'line', data: pts(g.chart.p50), color: COLORS.orange, title: 'Ortanca', width: 2 },
      { kind: 'line', data: pts(g.chart.p10), color: COLORS.down, title: 'Kötü senaryo (%10)', width: 1 },
      { kind: 'line', data: pts(g.chart.contributed), color: COLORS.gray, title: 'Yatırılan', width: 1 },
    ]
  }, [g])

  return (
    <div className="card">
      <h3>🎯 Hedef Planlayıcı</h3>
      <p className="muted small">Bir hedef belirleyin; ne kadar biriktirmeniz gerektiğini ve hedefe ulaşma olasılığınızı 3.000 farklı piyasa senaryosuyla hesaplayalım. Tutarlar bugünkü alım gücüyledir.</p>
      <div className="goal-form">
        <label>Hedef tutar (bugünkü TL ile)<input inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)} /></label>
        <label>Süre: <b>{years} yıl</b><input type="range" min={1} max={30} value={years} onChange={e => setYears(+e.target.value)} /></label>
        <label>Başlangıç birikimi<input inputMode="numeric" value={start} onChange={e => setStart(e.target.value)} placeholder="0" /></label>
        <label>Aylık birikim <span className="muted small">(boş bırakırsanız hesaplanır)</span><input inputMode="numeric" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="otomatik" /></label>
      </div>
      <div className="seg wrap mt">
        {profiles.map(p => (
          <button key={p.key} className={profile === p.key ? 'active' : ''} onClick={() => setProfile(p.key)}
            title={`${p.mix}. Varsayım: yıllık reel getiri %${(p.real * 100).toFixed(0)}, oynaklık %${(p.vol * 100).toFixed(0)}`}>
            {p.label} <span className="muted small">· reel %{(p.real * 100).toFixed(0)}/yıl</span>
          </button>
        ))}
      </div>
      <div className="row gap mt"><button className="btn primary" onClick={() => calc()} disabled={busy}>{busy ? 'Hesaplanıyor…' : 'Planı hesapla'}</button></div>
      <ErrorBox error={err} />
      {g && (
        <div className="goal-result">
          <div className="grid4 mt">
            <div className="card kpi"><div className="muted small">Hedefe ulaşma olasılığı</div>
              <div className={`kpi-value ${g.probability >= 75 ? 'up' : g.probability >= 45 ? 'warn' : 'down'}`}>%{g.probability.toFixed(0)}</div>
              <div className="prob neutral"><div style={{ width: `${g.probability}%` }} /></div></div>
            <div className="card kpi"><div className="muted small">Aylık birikim</div><div className="kpi-value">{tl(g.monthly)}</div>
              <div className="muted small">%75 olasılık için {tl(g.safe_monthly)}</div></div>
            <div className="card kpi"><div className="muted small">{g.years} yıl sonra (ortanca)</div><div className="kpi-value">{tl(g.median_final)}</div>
              <div className="muted small">{tl(g.p10_final)} – {tl(g.p90_final)}</div></div>
            <div className="card kpi"><div className="muted small">Toplam yatırılan</div><div className="kpi-value">{tl(g.total_contributed)}</div>
              <div className="muted small">{g.median_months_to_target != null ? `Senaryoların yarısında ${(Math.ceil(g.median_months_to_target / 12 * 10) / 10).toLocaleString('tr-TR')} yılda hedefte` : 'Senaryoların yarısı süre içinde hedefe ulaşamıyor'}</div></div>
          </div>
          <div className={`digest-verdict ${g.verdict.tone} mt`}>{g.verdict.text}</div>
          <Chart series={series} height={280} />
          <div className="mt">
            <div className="muted small">Aylık birikime göre olasılık (tıklayıp deneyin)</div>
            <div className="chips">
              {g.options.map(o => (
                <button key={o.monthly} className={`chip ${Math.abs(o.monthly - g.monthly) < 10 ? 'active' : ''}`} onClick={() => { const v = fmtIn(o.monthly); setMonthly(v); calc(v) }}>
                  {tl(o.monthly)}/ay → %{o.probability.toFixed(0)}
                </button>
              ))}
            </div>
          </div>
          {g.nominal_target && g.inflation_now != null && (
            <p className="info-box small mt">Bugünkü yıllık enflasyon (%{g.inflation_now.toFixed(1).replace('.', ',')}) sürerse, bugünkü {tl(g.target)} ile aynı alım gücü için {g.years} yıl sonra yaklaşık <b>{tl(g.nominal_target)}</b> gerekir.</p>
          )}
          <p className="muted small">{g.note} Seçilen profil: {g.profile.label} ({g.profile.mix}).</p>
        </div>
      )}
    </div>
  )
}

function RealReturn() {
  const [r, setR] = useState<Real | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<Real>('/portfolio/real').then(setR).catch(e => setErr((e as Error).message)) }, [])
  return (
    <div className="card">
      <h3>💸 Enflasyona Göre Gerçek Kazancım</h3>
      <p className="muted small">Her alımınızın maliyeti, alış tarihinden bugüne TÜFE ile güncellenir. Böylece paranızın alım gücü olarak gerçekten büyüyüp büyümediğini görürsünüz.</p>
      <ErrorBox error={err} />
      {!r && !err && <Loading text="Enflasyon verisi işleniyor…" />}
      {r?.empty && <p className="muted">Portföyünüzde açık pozisyon yok.</p>}
      {r && !r.empty && (
        <>
          <div className="grid4">
            <div className="card kpi"><div className="muted small">Nominal kâr/zarar</div><div className={`kpi-value ${tone(r.totals.nominal_pnl)}`}>{tl(r.totals.nominal_pnl)}</div><div className={`small ${tone(r.totals.nominal_pct)}`}>{fmtPct(r.totals.nominal_pct)}</div></div>
            <div className="card kpi"><div className="muted small">Gerçek (reel) kâr/zarar</div><div className={`kpi-value ${tone(r.totals.real_pnl)}`}>{tl(r.totals.real_pnl)}</div><div className={`small ${tone(r.totals.real_pct)}`}>{fmtPct(r.totals.real_pct)}</div></div>
            <div className="card kpi"><div className="muted small">Enflasyonun aşındırdığı</div><div className="kpi-value down">{tl(r.totals.eroded)}</div><div className="muted small">maliyetinizin bugünkü karşılığı {tl(r.totals.cost_real)}</div></div>
            <div className="card kpi"><div className="muted small">Enflasyonu yenen</div><div className="kpi-value">{r.beat} / {r.count}</div><div className="muted small">pozisyon</div></div>
          </div>
          <div className={`digest-verdict ${r.totals.real_pnl >= 0 ? 'good' : 'bad'}`}>{r.summary}</div>
          <div className="table-wrap mt">
            <table className="table">
              <thead><tr><th>Varlık</th><th>İlk alış</th><th className="r">Maliyet</th><th className="r">Enflasyonla maliyet</th><th className="r">Güncel değer</th><th className="r">Nominal</th><th className="r">Reel</th></tr></thead>
              <tbody>{r.items.map(i => (
                <tr key={i.symbol} className="clickable" onClick={() => openStock(i.symbol)}>
                  <td><span className="sym">{i.symbol.replace('.IS', '')}</span> <span className="muted small">{i.name}</span></td>
                  <td className="small">{new Date(i.since).toLocaleDateString('tr-TR')}</td>
                  <td className="r mono">{tl(i.cost_try)}</td>
                  <td className="r mono" title={`Bu sürede enflasyon %${i.inflation_pct.toFixed(1)}`}>{tl(i.cost_real)}</td>
                  <td className="r mono">{tl(i.value_try)}</td>
                  <td className={`r mono ${tone(i.nominal_pct)}`}>{fmtPct(i.nominal_pct)}</td>
                  <td className={`r mono ${tone(i.real_pct)}`}><b>{fmtPct(i.real_pct)}</b></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="muted small">{r.source} Döviz cinsinden varlıklar alış ve bugünkü kurla TL'ye çevrilir.</p>
        </>
      )}
    </div>
  )
}

export default function Goals() {
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Hedefler ve Gerçek Getiri</h1><p className="muted">Birikim hedefinizi planlayın ve kazancınızın enflasyonu yenip yenmediğini görün</p></div>
      </header>
      <RealReturn />
      <GoalPlanner />
      <p className="disclaimer">Hesaplamalar eğitim amaçlıdır; varsayımlara dayanır ve yatırım tavsiyesi değildir.</p>
    </div>
  )
}
