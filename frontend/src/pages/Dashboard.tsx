import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtPct, fmtPrice, marketStatus, tone, type Quote } from '../api'
import { Disclaimer, ErrorBox, Sparkline } from '../components/common'
import { LivePrice, Skeleton, Treemap } from '../components/ui'
import { useAutoRefresh } from '../refresh'

type Overview = { names: Record<string, string>; markets: Record<string, Quote[]> }

const HEADLINE = ['XU100.IS', '^GSPC', '^IXIC', 'USDTRY=X', 'EURTRY=X', 'GRAM-ALTIN', 'BZ=F', 'BTC-USD']
const ROUTES: Record<string, string> = { bist: '/piyasa/bist', us: '/piyasa/abd', fx: '/piyasa/doviz', crypto: '/piyasa/kripto' }
const ICONS: Record<string, string> = { bist: '🏛', us: '🗽', fx: '💱', crypto: '₿' }

// Ana ekran kartları: sıra ve görünürlük kullanıcı tarafından düzenlenebilir
const SECTIONS: { id: string; title: string; size: 'full' | 'half' }[] = [
  { id: 'headline', title: 'Öne çıkan göstergeler', size: 'full' },
  { id: 'favorites', title: 'Favorilerim', size: 'half' },
  { id: 'bulletin', title: 'Günün bülteni', size: 'half' },
  { id: 'markets', title: 'Piyasa kartları', size: 'full' },
  { id: 'treemap', title: 'Borsa İstanbul ısı haritası', size: 'full' },
  { id: 'gainers', title: 'En çok yükselenler', size: 'half' },
  { id: 'losers', title: 'En çok düşenler', size: 'half' },
  { id: 'volume', title: 'Olağandışı hacim', size: 'half' },
  { id: 'highs', title: '52 haftanın zirvesine en yakın', size: 'half' },
]
const LAYOUT_KEY = 'finanaliz_dashboard_layout'
type Layout = { order: string[]; hidden: string[] }

function loadLayout(): Layout {
  try {
    const l = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '') as Layout
    const known = SECTIONS.map(s => s.id)
    return { order: [...l.order.filter(i => known.includes(i)), ...known.filter(i => !l.order.includes(i))], hidden: l.hidden.filter(i => known.includes(i)) }
  } catch { return { order: SECTIONS.map(s => s.id), hidden: [] } }
}

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)
  const [favs, setFavs] = useState<Quote[] | null>(null)
  const [bulletin, setBulletin] = useState<{ date: string; text: string; source: string } | null>(null)
  const [layout, setLayoutState] = useState<Layout>(loadLayout)
  const [edit, setEdit] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const nav = useNavigate()

  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) } catch { /* yoksay */ } }
  const move = (id: string, delta: number) => {
    const o = [...layout.order]; const i = o.indexOf(id); const j = i + delta
    if (j < 0 || j >= o.length) return
    ;[o[i], o[j]] = [o[j], o[i]]; setLayout({ ...layout, order: o })
  }
  const toggle = (id: string) => setLayout({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] })
  const dropOn = (target: string) => {
    if (!dragId || dragId === target) return
    const o = layout.order.filter(x => x !== dragId); o.splice(o.indexOf(target), 0, dragId); setLayout({ ...layout, order: o }); setDragId(null)
  }

  const [busy, setBusy] = useState(false)
  const load = (fresh = false) => {
    setBusy(true)
    const q = fresh ? '?fresh=true' : ''
    Promise.all([
      api<Overview>(`/overview${q}`).then(d => { setData(d); setUpdated(new Date()); setError(null) }).catch(e => setError(e.message)),
      api<Quote[]>(`/watchlist${q}`).then(setFavs).catch(() => setFavs([])),
    ]).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])
  useAutoRefresh(() => load())
  useEffect(() => { api('/bulletin').then(setBulletin).catch(() => {}) }, [])
  const removeFav = (s: string) => api(`/watchlist/${encodeURIComponent(s)}`, { method: 'DELETE' }).then(() => setFavs(f => f?.filter(q => q.symbol !== s) ?? null))

  const all = data ? Object.values(data.markets).flat().filter(q => q.change_pct !== null) : []
  const open = (s: string) => nav(`/analiz?s=${encodeURIComponent(s)}`)
  const headline = HEADLINE.map(s => all.find(q => q.symbol === s)).filter(Boolean) as Quote[]
  const tradable = all.filter(q => !q.is_index)
  const sorted = [...tradable].sort((a, b) => b.change_pct! - a.change_pct!)
  const volumeLeaders = tradable.filter(q => q.volume && q.volume_avg && q.market !== 'fx')
    .map(q => ({ q, ratio: q.volume! / q.volume_avg! })).sort((a, b) => b.ratio - a.ratio).slice(0, 5)
  const nearHigh = tradable.filter(q => q.high_52w && q.price).map(q => ({ q, gap: (q.price! / q.high_52w! - 1) * 100 }))
    .sort((a, b) => b.gap - a.gap).slice(0, 5)
  const bist = (data?.markets.bist ?? []).filter(q => !q.is_index && q.price && q.volume)
  const tmGroups = Object.entries(bist.reduce<Record<string, Quote[]>>((acc, q) => { (acc[q.sector ?? 'Diğer'] ??= []).push(q); return acc }, {}))
    .map(([name, qs]) => ({ name, nodes: qs.map(q => ({ key: q.symbol, label: q.symbol.replace('.IS', ''), sub: q.name, value: (q.price ?? 0) * (q.volume ?? 0), change: q.change_pct, onClick: () => open(q.symbol) })) }))

  const render: Record<string, () => ReactNode> = {
    headline: () => (
      <div className="ticker">
        {headline.map(q => (
          <div key={q.symbol} className="ticker-item clickable" onClick={() => open(q.symbol)}>
            <div className="muted small">{q.name}</div>
            <div className="row gap"><LivePrice value={q.price} className="strong" /><span className={`small ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span></div>
            <Sparkline data={q.spark} width={130} height={26} />
          </div>
        ))}
      </div>
    ),
    favorites: () => (
      <div className="card">
        <div className="row between"><h3>★ Favorilerim</h3><Link to="/izleme" className="small">Düzenle →</Link></div>
        {!favs ? <Skeleton rows={3} /> : favs.length === 0 ? <p className="muted">Henüz favori yok. Piyasa sayfalarındaki ☆ simgesine tıklayarak ekleyebilirsiniz.</p> : (
          <div className="movers">
            {favs.map(q => (
              <div key={q.symbol} className="mover clickable" onClick={() => open(q.symbol)}>
                <div><span className="sym">{q.symbol.replace('.IS', '')}</span> <span className="muted small">{q.name}</span></div>
                <div className="row gap">
                  <Sparkline data={q.spark} width={70} height={22} />
                  <LivePrice value={q.price} />
                  <span className={`pill ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span>
                  <button className="star on" title="Favorilerden çıkar" onClick={e => { e.stopPropagation(); removeFav(q.symbol) }}>★</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    bulletin: () => (
      <div className="card">
        <div className="row between"><h3>📝 Günün Bülteni</h3><Link to="/bulten" className="small">Tamamını oku →</Link></div>
        {!bulletin ? <Skeleton rows={4} text="Bülten hazırlanıyor…" /> : (
          <>
            <div className="muted small">{bulletin.date} · {bulletin.source === 'llm' ? 'Yapay zekâ ile yazıldı' : 'Şablon tabanlı'}</div>
            {bulletin.text.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('_')).slice(0, 4).map((l, i) => (
              <p key={i} className="small clamp">{l.replace(/\*\*/g, '').replace(/^- /, '• ')}</p>
            ))}
          </>
        )}
      </div>
    ),
    markets: () => data && (
      <div className="grid-markets">
        {Object.entries(data.markets).map(([m, list]) => {
          const st = marketStatus(m)
          const items = list.filter(q => !q.is_index && q.change_pct !== null)
          const up = items.filter(q => q.change_pct! > 0).length
          const best = [...items].sort((a, b) => b.change_pct! - a.change_pct!)
          const idx = list.find(q => q.is_index) ?? list[0]
          return (
            <Link key={m} to={ROUTES[m]} className="card market-card">
              <div className="row between">
                <h3>{ICONS[m]} {data.names[m]}</h3>
                <span className={`status ${st.open ? 'on' : ''}`}><span className="status-dot" />{st.open ? 'Açık' : 'Kapalı'}</span>
              </div>
              <div className="row between">
                <div>
                  <div className="muted small">{idx.name}</div>
                  <div className="kpi-value sm"><LivePrice value={idx.price} /> <span className={`small ${tone(idx.change_pct)}`}>{fmtPct(idx.change_pct)}</span></div>
                </div>
                <Sparkline data={idx.spark} width={110} height={34} />
              </div>
              <div className="breadth mt"><div className="up-bar" style={{ flex: up || 0.0001 }} /><div className="down-bar" style={{ flex: items.length - up || 0.0001 }} /></div>
              <div className="row between small"><span className="up">▲ {up}</span><span className="down">▼ {items.length - up}</span></div>
              <div className="mini-movers">
                {best.slice(0, 2).concat(best.slice(-1)).map(q => (
                  <div key={q.symbol} className="row between small">
                    <span>{q.symbol.replace('.IS', '').replace('-USD', '')} <span className="muted">{q.name}</span></span>
                    <span className={tone(q.change_pct)}>{fmtPct(q.change_pct)}</span>
                  </div>
                ))}
              </div>
              <div className="link-more">Tümünü gör →</div>
            </Link>
          )
        })}
      </div>
    ),
    treemap: () => (
      <div className="card">
        <div className="row between"><h3>🗺 Borsa İstanbul Isı Haritası</h3><Link to="/piyasa/bist" className="small">Piyasaya git →</Link></div>
        <p className="muted small">Kutu büyüklüğü günlük işlem hacmini (TL), renk günlük değişimi gösterir. Sektörlere göre gruplanmıştır.</p>
        {tmGroups.length ? <Treemap groups={tmGroups} height={380} /> : <Skeleton rows={4} />}
      </div>
    ),
    gainers: () => <div className="card"><h3>En Çok Yükselenler (tüm piyasalar)</h3><MoverList items={sorted.slice(0, 6)} onPick={open} /></div>,
    losers: () => <div className="card"><h3>En Çok Düşenler (tüm piyasalar)</h3><MoverList items={sorted.slice(-6).reverse()} onPick={open} /></div>,
    volume: () => (
      <div className="card">
        <h3>Olağandışı Hacim</h3>
        <p className="muted small">Bugünkü işlem hacmi 20 günlük ortalamasının en çok üzerinde olanlar</p>
        <div className="movers">
          {volumeLeaders.map(({ q, ratio }) => (
            <div key={q.symbol} className="mover clickable" onClick={() => open(q.symbol)}>
              <div><span className="sym">{q.symbol.replace('.IS', '')}</span> <span className="muted small">{q.name}</span></div>
              <div className="row gap"><span className={`small ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span><span className="pill">{ratio.toFixed(1)}× hacim</span></div>
            </div>
          ))}
        </div>
      </div>
    ),
    highs: () => (
      <div className="card">
        <h3>52 Haftanın Zirvesine En Yakın</h3>
        <p className="muted small">Son bir yılın en yüksek fiyatına en yakın işlem görenler</p>
        <div className="movers">
          {nearHigh.map(({ q, gap }) => (
            <div key={q.symbol} className="mover clickable" onClick={() => open(q.symbol)}>
              <div><span className="sym">{q.symbol.replace('.IS', '')}</span> <span className="muted small">{q.name}</span></div>
              <div className="row gap"><LivePrice value={q.price} /><span className="pill up">{gap >= -0.05 ? 'zirvede' : `zirveye ${fmtPct(-gap, false)}`}</span></div>
            </div>
          ))}
        </div>
      </div>
    ),
  }

  const visible = layout.order.filter(id => edit || !layout.hidden.includes(id))
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Piyasa Özeti</h1><p className="muted">Türkiye, ABD, döviz ve kripto piyasalarının genel görünümü</p></div>
        <div className="row gap">
          {updated && <span className="muted small">Son güncelleme: {updated.toLocaleTimeString('tr-TR')}</span>}
          <button className="btn ghost" onClick={() => load(true)} disabled={busy}>{busy ? 'Yenileniyor…' : '↻ Yenile'}</button>
          <button className={`btn ${edit ? 'primary' : 'ghost'}`} onClick={() => setEdit(!edit)}>{edit ? '✓ Bitti' : '✎ Düzenle'}</button>
        </div>
      </header>
      {edit && <div className="info-box small">Kartları tutup sürükleyerek veya ↑ ↓ düğmeleriyle sıralayın; 👁 ile gizleyip gösterin.
        <button className="btn ghost small ml" onClick={() => setLayout({ order: SECTIONS.map(s => s.id), hidden: [] })}>Varsayılana dön</button></div>}
      <ErrorBox error={error} />
      {!data && !error ? <Skeleton rows={8} text="Piyasa verileri çekiliyor…" /> : (
        <div className="dash-grid">
          {visible.map(id => {
            const meta = SECTIONS.find(s => s.id === id)!
            const hidden = layout.hidden.includes(id)
            return (
              <section key={id} className={`dash-item ${meta.size} ${edit ? 'editing' : ''} ${hidden ? 'is-hidden' : ''} ${dragId === id ? 'dragging' : ''}`}
                draggable={edit} onDragStart={() => setDragId(id)} onDragOver={e => edit && e.preventDefault()} onDrop={() => dropOn(id)} onDragEnd={() => setDragId(null)}>
                {edit && (
                  <div className="dash-edit">
                    <span className="drag-handle">⠿</span><span className="strong small">{meta.title}</span>
                    <div className="row gap">
                      <button className="btn ghost small" onClick={() => move(id, -1)}>↑</button>
                      <button className="btn ghost small" onClick={() => move(id, 1)}>↓</button>
                      <button className="btn ghost small" onClick={() => toggle(id)}>{hidden ? '👁 Göster' : '🙈 Gizle'}</button>
                    </div>
                  </div>
                )}
                {!hidden && render[id]()}
              </section>
            )
          })}
        </div>
      )}
      <Disclaimer />
    </div>
  )
}

function MoverList({ items, onPick }: { items: Quote[]; onPick: (s: string) => void }) {
  return (
    <div className="movers">
      {items.map(q => (
        <div key={q.symbol} className="mover clickable" onClick={() => onPick(q.symbol)}>
          <div><span className="sym">{q.symbol.replace('.IS', '')}</span> <span className="muted small">{q.name}</span></div>
          <div className="row gap"><LivePrice value={q.price} /><span className={`pill ${tone(q.change_pct)}`}>{fmtPct(q.change_pct)}</span></div>
        </div>
      ))}
    </div>
  )
}
