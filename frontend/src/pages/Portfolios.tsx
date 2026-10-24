import { useEffect, useMemo, useState } from 'react'
import { activePortfolio, api, fmtPct, tone } from '../api'
import Chart, { type SeriesSpec } from '../components/Chart'
import { ErrorBox, Loading } from '../components/common'
import type { PortfolioItem } from '../components/PortfolioTools'

type Compare = { items: PortfolioItem[]; max: number; best: string | null
  series: { id: number; name: string; points: { day: string; value: number; pct: number | null }[] }[] }

const TL0 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 })
const tl = (v: number | null | undefined) => v == null ? '—' : TL0.format(v)
const PALETTE = ['#14b8a6', '#f59e0b', '#6366f1', '#ef4444', '#22c55e', '#ec4899', '#0ea5e9', '#a3a3a3']

export default function Portfolios() {
  const [d, setD] = useState<Compare | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [initial, setInitial] = useState('100.000')
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const load = () => api<Compare>('/portfolios/compare').then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const active = activePortfolio.get() ?? d?.items.find(i => i.main)?.id

  const create = async () => {
    setErr(null)
    const v = Number(initial.replace(/\./g, '').replace(',', '.'))
    try {
      const r = await api<{ id: number }>('/portfolios', { body: { name: name.trim(), initial: v } })
      setName(''); activePortfolio.switchTo(r.id)
    } catch (e) { setErr((e as Error).message) }
  }
  const open = (it: PortfolioItem) => activePortfolio.switchTo(it.main ? null : it.id)
  const rename = async () => {
    if (!renaming) return
    try { await api(`/portfolios/${renaming.id}`, { method: 'PATCH', body: { name: renaming.name } }); setRenaming(null); load() } catch (e) { setErr((e as Error).message) }
  }
  const remove = async (it: PortfolioItem) => {
    if (!confirm(`"${it.name}" portföyü ve içindeki tüm işlemler silinsin mi? Bu işlem geri alınamaz.`)) return
    try {
      await api(`/portfolios/${it.id}`, { method: 'DELETE' })
      if (activePortfolio.get() === it.id) activePortfolio.set(null)
      load()
    } catch (e) { setErr((e as Error).message) }
  }

  const series = useMemo<SeriesSpec[]>(() => (d?.series ?? []).filter(s => s.points.length > 1).map((s, i) => ({
    kind: 'line', title: s.name, color: PALETTE[i % PALETTE.length], width: 2,
    data: s.points.filter(p => p.pct != null).map(p => ({ time: Math.floor(new Date(p.day + 'T12:00:00').getTime() / 1000), value: p.pct as number })),
  })), [d])

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Portföylerim</h1><p className="muted">Ayrı bakiyeli portföyler oluşturun (ör. “Uzun vade”, “Deneme”, “Kripto”) ve performanslarını karşılaştırın</p></div>
      </header>
      <ErrorBox error={err} />
      {!d ? <Loading /> : (
        <>
          <div className="pf-grid">
            {d.items.map((it, i) => (
              <div key={it.id} className={`card pf-card ${it.id === active ? 'active' : ''}`} style={{ borderTopColor: PALETTE[i % PALETTE.length] }}>
                <div className="row between">
                  {renaming?.id === it.id ? (
                    <div className="row gap"><input value={renaming.name} maxLength={30} onChange={e => setRenaming({ ...renaming, name: e.target.value })} autoFocus />
                      <button className="btn primary small" onClick={rename}>Kaydet</button></div>
                  ) : <h3>{it.name} {it.main && <span className="pill">ana</span>} {it.id === active && <span className="pill up">açık</span>}</h3>}
                </div>
                <div className="pf-equity">{tl(it.equity)}</div>
                <div className={`small ${tone(it.return_pct)}`}>{fmtPct(it.return_pct)} <span className="muted">başlangıçtan beri</span></div>
                <div className="muted small">{it.positions} varlık · nakit {tl(it.cash)}</div>
                <div className="row gap mt wrap">
                  {it.id !== active && <button className="btn primary small" onClick={() => open(it)}>Aç</button>}
                  <button className="btn ghost small" onClick={() => setRenaming({ id: it.id, name: it.name })}>Yeniden adlandır</button>
                  {!it.main && <button className="btn ghost small danger" onClick={() => remove(it)}>Sil</button>}
                </div>
              </div>
            ))}
            {d.items.length < d.max && (
              <div className="card pf-card new">
                <h3>＋ Yeni portföy</h3>
                <label className="small">Ad<input value={name} maxLength={30} placeholder="ör. Uzun vade" onChange={e => setName(e.target.value)} /></label>
                <label className="small">Başlangıç sanal bakiyesi (TL)<input inputMode="numeric" value={initial} onChange={e => setInitial(e.target.value)} /></label>
                <button className="btn primary small mt" disabled={!name.trim()} onClick={create}>Oluştur ve aç</button>
              </div>
            )}
          </div>
          <div className="card">
            <h3>📈 Performans karşılaştırması {d.best && <span className="muted small">· en iyi: {d.best}</span>}</h3>
            {series.length ? <Chart series={series} height={280} /> : <p className="muted">Karşılaştırma grafiği, portföylerin günlük değerleri kaydedildikçe (her gün otomatik) oluşur.</p>}
            <p className="muted small">Getiri, her portföye yatırılan toplam tutara göre hesaplanır. Favoriler, alarmlar ve bildirimler tüm portföylerde ortaktır; bakiye, işlemler, emirler ve botlar portföye özeldir.</p>
          </div>
        </>
      )}
    </div>
  )
}
