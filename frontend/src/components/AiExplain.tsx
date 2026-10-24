// Açıklanabilir yapay zekâ (bu tahmin neden?) ve model başarı karnesi (ileriye yürüyen test).
import { useEffect, useMemo, useState } from 'react'
import { api, fmtPct, type Point } from '../api'
import Chart, { COLORS, type SeriesSpec } from './Chart'
import { Loading } from './common'

export type Explanation = {
  model: string; probability: number; baseline: number; summary: string; method: string
  top: { feature: string; value: number; contribution: number; text: string }[]
}

export function ExplainCard({ e }: { e: Explanation }) {
  const max = Math.max(...e.top.map(f => Math.abs(f.contribution)), 1)
  return (
    <div className="card">
      <h3>🔍 Bu tahmin neden böyle?</h3>
      <p className="xai-summary">{e.summary}</p>
      <div className="xai-gauge" title={`Tipik gün %${e.baseline.toFixed(0)} → bugün %${e.probability.toFixed(0)}`}>
        <span className="xai-base" style={{ left: `${e.baseline}%` }} />
        <span className={`xai-now ${e.probability >= 50 ? 'up' : 'down'}`} style={{ left: `${e.probability}%` }}>%{e.probability.toFixed(0)}</span>
      </div>
      <div className="row between small muted"><span>Düşüş</span><span>│ tipik gün %{e.baseline.toFixed(0)}</span><span>Yükseliş</span></div>
      <div className="xai-bars">
        {e.top.map(f => (
          <div key={f.feature} className="xai-row">
            <span className="xai-label">{f.text}</span>
            <div className="xai-track">
              <div className={`xai-bar ${f.contribution >= 0 ? 'up' : 'down'}`}
                style={{ width: `${Math.abs(f.contribution) / max * 50}%`, [f.contribution >= 0 ? 'left' : 'right']: '50%' }} />
            </div>
            <span className={`mono small ${f.contribution >= 0 ? 'up' : 'down'}`}>{f.contribution >= 0 ? '+' : '−'}{Math.abs(f.contribution).toFixed(1)} puan</span>
          </div>
        ))}
      </div>
      <p className="muted small">Model: {e.model}. {e.method} Yeşil çubuklar yükseliş olasılığını artıran, kırmızılar azaltan göstergelerdir.</p>
    </div>
  )
}

type CardModel = { model: string; accuracy: number; correct: number; days: number; p_value: number; confident_accuracy: number | null
  confident_days: number; strategy_return: number; monthly: { from: number; accuracy: number; days: number }[]; equity: Point[] }
type Scorecard = { days: number; retrain_every: number; grade: 'A' | 'B' | 'C'; verdict: string; best: string; method: string
  baselines: { coin: number; always_up: number; persistence: number }; buy_hold_return: number; buy_hold: Point[]; models: CardModel[] }

const GRADE_TEXT = { A: 'Anlamlı başarı', B: 'Umut verici', C: 'Zayıf' }
const p1 = (v: number) => `%${v.toFixed(1).replace('.', ',')}`

export function ScorecardCard({ symbol, period, run }: { symbol: string; period: string; run: number }) {
  const [c, setC] = useState<Scorecard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!run) return
    let alive = true
    setC(null); setErr(null); setBusy(true)
    api<Scorecard>(`/predict/${encodeURIComponent(symbol)}/scorecard?period=${period === '5y' ? '5y' : '2y'}`)
      .then(d => { if (alive) setC(d) }).catch(e => { if (alive) setErr((e as Error).message) }).finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [symbol, period, run])

  const series = useMemo<SeriesSpec[]>(() => {
    if (!c) return []
    const best = c.models.find(m => m.model === c.best)!
    return [
      { kind: 'line', data: c.buy_hold, color: COLORS.gray, title: 'Al ve tut', width: 2 },
      { kind: 'line', data: best.equity, color: COLORS.orange, title: `${best.model} stratejisi`, width: 2 },
    ]
  }, [c])

  if (!run) return null
  return (
    <div className="card">
      <div className="row between wrap gap">
        <h3>🎓 Model Başarı Karnesi <span className="muted small">· gerçek hayattaki isabet</span></h3>
        {c && <span className={`grade grade-${c.grade}`}>{c.grade} · {GRADE_TEXT[c.grade]}</span>}
      </div>
      {busy && <Loading text="Son 6 ay için modeller ay ay yeniden eğitiliyor (10 sn kadar sürebilir)…" />}
      {err && <p className="muted small">{err}</p>}
      {c && (
        <>
          <div className={`digest-verdict ${c.grade === 'A' ? 'good' : c.grade === 'B' ? 'neutral' : 'bad'}`}>{c.verdict}</div>
          <div className="table-wrap mt">
            <table className="table">
              <thead><tr><th>Model / kural</th><th className="r">Yön isabeti</th><th className="r" title="Modelin %60'tan emin olduğu günlerdeki isabet">Emin olduğu günler</th>
                <th className="r" title="Sonucun şans eseri olma olasılığı; 0,05'in altı anlamlı kabul edilir">p-değeri</th><th className="r" title="Model 'yükselir' dediği günlerde alıp diğer günlerde nakitte kalsaydı">Strateji getirisi</th></tr></thead>
              <tbody>
                {c.models.map(m => (
                  <tr key={m.model} className={m.model === c.best ? 'highlight' : ''}>
                    <td>{m.model}</td>
                    <td className="r"><div className="sim-score"><span style={{ width: `${m.accuracy}%`, background: m.accuracy > Math.max(50, c.baselines.always_up) ? 'var(--up)' : 'var(--down)' }} /></div>
                      <span className="mono">{p1(m.accuracy)}</span> <span className="muted small">({m.correct}/{m.days})</span></td>
                    <td className="r mono">{m.confident_accuracy == null ? '—' : p1(m.confident_accuracy)} <span className="muted small">{m.confident_days} gün</span></td>
                    <td className={`r mono ${m.p_value < 0.05 ? 'up' : ''}`}>{m.p_value.toFixed(3).replace('.', ',')}</td>
                    <td className={`r mono ${m.strategy_return >= 0 ? 'up' : 'down'}`}>{fmtPct(m.strategy_return)}</td>
                  </tr>
                ))}
                <tr className="muted"><td>Yazı-tura</td><td className="r mono">%50,0</td><td /><td /><td /></tr>
                <tr className="muted"><td>“Her gün yükselir” kuralı</td><td className="r mono">{p1(c.baselines.always_up)}</td><td /><td /><td className={`r mono ${c.buy_hold_return >= 0 ? 'up' : 'down'}`}>{fmtPct(c.buy_hold_return)} (al ve tut)</td></tr>
                <tr className="muted"><td>“Dün ne olduysa bugün de” kuralı</td><td className="r mono">{p1(c.baselines.persistence)}</td><td /><td /><td /></tr>
              </tbody>
            </table>
          </div>
          <div className="grid2 mt">
            <div>
              <div className="muted small">Strateji ve al-tut getirisi (%)</div>
              <Chart series={series} height={220} />
            </div>
            <div>
              <div className="muted small">{c.best}: aylık isabet</div>
              <div className="sc-months">
                {c.models.find(m => m.model === c.best)!.monthly.map(m => (
                  <div key={m.from} className="sc-month" title={`${m.days} gün`}>
                    <span style={{ height: `${m.accuracy}%`, background: m.accuracy >= 50 ? 'var(--up)' : 'var(--down)' }} />
                    <b className="mono small">%{m.accuracy.toFixed(0)}</b>
                    <small className="muted">{new Date(m.from * 1000).toLocaleDateString('tr-TR', { month: 'short' })}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="muted small">{c.method} İşlem maliyetleri dahil değildir.</p>
        </>
      )}
    </div>
  )
}
