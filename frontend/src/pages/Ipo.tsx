import { useEffect, useMemo, useState } from 'react'
import { api, fmtPct, fmtPrice, tone } from '../api'
import { EmptyState, ErrorBox, Loading } from '../components/common'
import { openStock } from '../components/StockCard'
import Term from '../components/Term'

type Ipo = { id: number; bulletin: string; date: string | null; company: string; capital_current: number | null; capital_new: number | null
  increase: number | null; sale_existing: number | null; sale_extra: number | null; price: number | null; price_max: number | null; notes: string | null
  size_try: number | null; float_pct: number | null; symbol: string | null; current_price: number | null; adj_price: number | null
  return_pct: number | null; split_adjusted: boolean }
type Cap = { id: number; bulletin: string; date: string | null; company: string; capital_current: number | null; capital_new: number | null
  bedelli: number | null; bedelsiz_ic: number | null; bedelsiz_kar: number | null; sale_type: string | null
  bedelli_pct: number | null; bedelsiz_pct: number | null; symbol: string | null; mine: boolean }
type Pending = { company: string; applied: string; first_seen: string; waiting_days: number | null; is_new: boolean }
type Removed = { company: string; applied: string; last_seen: string; approved: boolean }
type Kap = { id: number; time: number | null; title: string; summary: string | null; company: string; codes: string[]; url: string }
type Prefs = { approvals: boolean; applications: boolean; capital: boolean; us: boolean }
type UsRow = { deal_id: string; ticker: string | null; company: string; exchange: string | null; status: string; price: number | null
  price_low: number | null; price_high: number | null; shares: number | null; offer_amount: number | null; filed_date: string | null
  expected_date: string | null; priced_date: string | null; withdrawn_date: string | null; spac: boolean
  current_price?: number | null; return_pct?: number | null; waiting_days?: number | null }
type UsData = { upcoming: UsRow[]; priced: UsRow[]; filed: UsRow[]; withdrawn: UsRow[]; prices_loading: boolean
  stats: { upcoming: number; filed: number; priced_year: number; raised_year: number; avg_return: number | null; positive_share: number | null } }
type Res = { ipos: Ipo[]; capital: Cap[]; pending: Pending[]; removed: Removed[]; kap: Kap[]; prefs: Prefs; kap_loading: boolean; us: UsData
  stats: { pending: number; approved_year: number; approved_total: number; avg_return: number | null; positive_share: number | null; last_ipo: Ipo | null }
  sync: { last_sync: number | null; running: boolean; error: string | null } }
type Tab = 'new' | 'pending' | 'history' | 'capital' | 'kap'

const dateTR = (d: string | null) => d ? new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
const big = (v: number | null) => v == null ? '—' : v >= 1e9 ? `${(v / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyar TL` : `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon TL`
const lots = (v: number | null) => v == null ? '—' : `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyon adet`
const waited = (d: number | null) => d == null ? '—' : d < 60 ? `${d} gün` : `${Math.floor(d / 30)} ay`
const short = (s: string | null) => s ? s.replace('.IS', '') : null
const bulletinUrl = 'https://spk.gov.tr/spk-bultenleri'

export default function IpoPage() {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('finanaliz_ipo_tab') as Tab) || 'new' } catch { return 'new' } })
  const [q, setQ] = useState('')
  const [capFilter, setCapFilter] = useState<'all' | 'bedelli' | 'bedelsiz' | 'mine'>('all')
  const [busy, setBusy] = useState(false)
  // Pazar: Türkiye (SPK) veya ABD (Nasdaq takvimi). Bildirimden gelinirse ?pazar=abd ile ABD açılır.
  const [mkt, setMktState] = useState<'tr' | 'us'>(() => {
    if (new URLSearchParams(window.location.search).get('pazar') === 'abd') return 'us'
    try { return (localStorage.getItem('finanaliz_ipo_market') as 'tr' | 'us') || 'tr' } catch { return 'tr' }
  })
  const setMkt = (m: 'tr' | 'us') => { setMktState(m); try { localStorage.setItem('finanaliz_ipo_market', m) } catch { /* yoksay */ } }

  const load = () => api<Res>('/ipo').then(d => { setData(d); setError(null) }).catch(e => setError(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => {  // KAP duyuruları arka planda hazırlanırken sekme açıksa kendiliğinden güncellensin
    if (tab !== 'kap' || !data?.kap_loading) return
    const id = setTimeout(load, 5000)
    return () => clearTimeout(id)
  }, [tab, data])
  useEffect(() => { try { localStorage.setItem('finanaliz_ipo_tab', tab) } catch { /* yoksay */ } setQ('') }, [tab])
  const refresh = async () => {
    setBusy(true)
    try { await api('/ipo/refresh', { body: {} }); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const setPref = async (k: keyof Prefs, v: boolean) => {
    if (!data) return
    setData({ ...data, prefs: { ...data.prefs, [k]: v } })
    try { await api('/ipo/prefs', { method: 'PUT', body: { [k]: v } }) } catch (e) { setError((e as Error).message) }
  }

  const term = q.trim().toLocaleLowerCase('tr')
  const recent = useMemo(() => (data?.ipos ?? []).filter(i => i.date && (Date.now() - new Date(i.date).getTime()) / 864e5 <= 120), [data])
  const caps = useMemo(() => (data?.capital ?? []).filter(c =>
    (capFilter === 'all' ? (c.bedelli_pct || c.bedelsiz_pct) : capFilter === 'bedelli' ? c.bedelli_pct : capFilter === 'bedelsiz' ? c.bedelsiz_pct : c.mine)
    && (!term || c.company.toLocaleLowerCase('tr').includes(term) || (c.symbol ?? '').toLowerCase().includes(term))), [data, capFilter, term])

  if (error && !data) return <div className="page"><ErrorBox error={error} /></div>
  if (!data) return <div className="page"><Loading text="SPK verileri hazırlanıyor…" /></div>
  const s = data.stats
  const lastSync = data.sync.last_sync ? new Date(data.sync.last_sync * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Halka Arz{mkt === 'tr' ? ' & Sermaye Artırımları' : ' · ABD'}</h1>
          {mkt === 'us'
            ? <p className="muted">Nasdaq halka arz takviminden: fiyatlanması yaklaşan halka arzlar, SEC'e yapılan yeni başvurular ve son bir yılda borsaya gelen şirketlerin bugünkü getirileri.</p>
            : <p className="muted">SPK'nın resmi başvuru listesi ve haftalık bültenlerinden: onaylanan ve onay bekleyen halka arzlar, geçmiş halka arzların performansı, <Term k="bedelli">bedelli</Term> ve <Term k="bedelsiz">bedelsiz</Term> sermaye artırımları.</p>}
        </div>
        <div className="row gap">
          <span className="muted small">{data.sync.running ? 'Kaynaklar kontrol ediliyor…' : lastSync ? `Son kontrol ${lastSync}` : ''}</span>
          <button className="btn ghost" onClick={refresh} disabled={busy}>{busy ? 'Kontrol ediliyor…' : '↻ Güncelle'}</button>
        </div>
      </header>
      <div className="seg market-seg">
        <button className={mkt === 'tr' ? 'active' : ''} onClick={() => setMkt('tr')}>🏛 Borsa İstanbul</button>
        <button className={mkt === 'us' ? 'active' : ''} onClick={() => setMkt('us')}>🗽 ABD (Nasdaq & NYSE){data.us.stats.upcoming ? ` · ${data.us.stats.upcoming} yaklaşan` : ''}</button>
      </div>
      {error && <ErrorBox error={error} />}

      {mkt === 'us' ? <UsIpoView us={data.us} prefs={data.prefs} setPref={setPref} /> : (<>
      <div className="grid4">
        <div className="card kpi clickable" onClick={() => setTab('pending')}><div className="muted small">Onay bekleyen başvuru</div><div className="kpi-value">{s.pending}</div><div className="muted small">SPK inceleme listesinde</div></div>
        <div className="card kpi clickable" onClick={() => setTab('new')}><div className="muted small">Bu yıl onaylanan halka arz</div><div className="kpi-value">{s.approved_year}</div><div className="muted small">{s.last_ipo ? `Son: ${s.last_ipo.company.split(' ').slice(0, 2).join(' ')} · ${dateTR(s.last_ipo.date)}` : ''}</div></div>
        <div className="card kpi clickable" onClick={() => setTab('history')}><div className="muted small">Geçmiş halka arzların ortalama getirisi</div><div className={`kpi-value ${tone(s.avg_return)}`}>{fmtPct(s.avg_return)}</div><div className="muted small">{s.positive_share != null ? `%${s.positive_share.toFixed(0)}'i halka arz fiyatının üzerinde` : 'hesaplanıyor'}</div></div>
        <div className="card kpi">
          <div className="muted small">🔔 Bildirimler</div>
          <label className="toggle-row small"><input type="checkbox" checked={data.prefs.approvals} onChange={e => setPref('approvals', e.target.checked)} />SPK halka arz onayı</label>
          <label className="toggle-row small"><input type="checkbox" checked={data.prefs.capital} onChange={e => setPref('capital', e.target.checked)} />Hisselerimde sermaye artırımı</label>
          <label className="toggle-row small"><input type="checkbox" checked={data.prefs.applications} onChange={e => setPref('applications', e.target.checked)} />Yeni halka arz başvurusu</label>
          <label className="toggle-row small"><input type="checkbox" checked={data.prefs.us} onChange={e => setPref('us', e.target.checked)} />ABD halka arzları</label>
        </div>
      </div>

      <div className="card">
        <div className="row between wrap gap">
          <div className="seg">
            <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>🚀 Yeni Onaylananlar ({recent.length})</button>
            <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>⏳ Onay Bekleyenler ({data.pending.length})</button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>📜 Geçmiş Halka Arzlar</button>
            <button className={tab === 'capital' ? 'active' : ''} onClick={() => setTab('capital')}>📈 Sermaye Artırımları</button>
            <button className={tab === 'kap' ? 'active' : ''} onClick={() => setTab('kap')}>📢 KAP Duyuruları</button>
          </div>
          {(tab === 'pending' || tab === 'history' || tab === 'capital') && <input className="screener-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Şirket ara…" />}
        </div>

        {tab === 'new' && (recent.length === 0
          ? <EmptyState icon="🚀" title="Son 4 ayda onaylanan halka arz yok" text="SPK yeni bir halka arzı onayladığında burada görünür ve size bildirim gelir." />
          : <div className="ipo-grid">{recent.map(i => <IpoCard key={i.id} i={i} />)}</div>)}

        {tab === 'pending' && (
          <>
            <p className="muted small mt">SPK'ya halka arz için başvurmuş ve incelemesi süren şirketler (başvuru tarihine göre). Onaylananlar listeden çıkar ve "Yeni Onaylananlar"da görünür.</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>#</th><th>Şirket</th><th>Başvuru tarihi</th><th className="r">Bekleme süresi</th></tr></thead>
              <tbody>{data.pending.filter(p => !term || p.company.toLocaleLowerCase('tr').includes(term)).map((p, i) => (
                <tr key={p.company}>
                  <td className="muted">{i + 1}</td>
                  <td>{p.company} {p.is_new && <span className="pill up">Yeni başvuru</span>}</td>
                  <td>{dateTR(p.applied)}</td>
                  <td className="r">{waited(p.waiting_days)}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {data.removed.length > 0 && (
              <details className="mt"><summary className="small muted">Listeden yakın zamanda çıkan başvurular ({data.removed.length})</summary>
                <ul className="small">{data.removed.map(r => <li key={r.company}>{r.company} — {r.approved ? <span className="up">SPK onayladı</span> : <span className="muted">listeden çıktı (geri çekilmiş veya onaylanmış olabilir)</span>}</li>)}</ul>
              </details>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <p className="muted small mt">SPK bültenleriyle onaylanan halka arzlar ve bugünkü fiyatlarına göre getirileri. Halka arzdan sonra yapılan bedelsiz sermaye artırımları fiyatı böldüğü için halka arz fiyatı aynı oranda düzeltilmiştir.</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Onay</th><th>Şirket</th><th className="r">Halka arz fiyatı</th><th className="r">Büyüklük</th><th className="r">Güncel fiyat</th><th className="r">Getiri</th></tr></thead>
              <tbody>{data.ipos.filter(i => !term || i.company.toLocaleLowerCase('tr').includes(term) || (i.symbol ?? '').toLowerCase().includes(term)).map(i => (
                <tr key={i.id} className={i.symbol ? 'clickable' : ''} onClick={() => i.symbol && openStock(i.symbol)}>
                  <td className="nowrap">{dateTR(i.date)}</td>
                  <td>{i.symbol && <span className="sym">{short(i.symbol)} </span>}<span className={i.symbol ? 'muted small' : ''}>{i.company}</span></td>
                  <td className="r mono">{i.price ? `${fmtPrice(i.price)} TL` : '—'}{i.split_adjusted && <div className="muted small" title="Bedelsiz sermaye artırımlarına göre düzeltilmiş fiyat">düz.: {fmtPrice(i.adj_price)}</div>}</td>
                  <td className="r small">{big(i.size_try)}</td>
                  <td className="r mono">{i.current_price ? fmtPrice(i.current_price) : <span className="muted small">{i.symbol ? '—' : 'henüz işlem görmüyor'}</span>}</td>
                  <td className={`r mono ${tone(i.return_pct)}`}>{fmtPct(i.return_pct)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}

        {tab === 'capital' && (
          <>
            <div className="row gap wrap mt">
              <div className="seg">
                {([['all', 'Tümü'], ['bedelli', 'Bedelli'], ['bedelsiz', 'Bedelsiz'], ['mine', 'Hisselerim']] as const).map(([k, l]) => (
                  <button key={k} className={capFilter === k ? 'active' : ''} onClick={() => setCapFilter(k)}>{l}</button>
                ))}
              </div>
              <span className="muted small"><b>Bedelli:</b> ortaklar yeni payları (genelde 1 TL'den) parayla alır. <b>Bedelsiz:</b> şirket kendi kaynağından ücretsiz pay dağıtır; hisse fiyatı aynı oranda bölünür.</span>
            </div>
            {caps.length === 0 ? <EmptyState icon="📈" title="Bu filtreye uyan sermaye artırımı yok" /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>SPK onayı</th><th>Şirket</th><th className="r">Mevcut sermaye</th><th className="r">Yeni sermaye</th><th className="r">Bedelli</th><th className="r">Bedelsiz</th></tr></thead>
                <tbody>{caps.map(c => (
                  <tr key={c.id} className={c.symbol ? 'clickable' : ''} onClick={() => c.symbol && openStock(c.symbol)}>
                    <td className="nowrap">{dateTR(c.date)}</td>
                    <td>{c.symbol && <span className="sym">{short(c.symbol)} </span>}<span className={c.symbol ? 'muted small' : ''}>{c.company}</span> {c.mine && <span className="pill up">Portföy / favori</span>}</td>
                    <td className="r mono small">{big(c.capital_current)}</td>
                    <td className="r mono small">{big(c.capital_new)}</td>
                    <td className="r">{c.bedelli_pct ? <span className="pill down" title="Ortaklar bu oranda yeni pay alma hakkına sahip olur">%{c.bedelli_pct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</span> : '—'}</td>
                    <td className="r">{c.bedelsiz_pct ? <span className="pill up" title="Her 100 paya bu kadar ücretsiz pay">%{c.bedelsiz_pct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</span> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="muted small">SPK onayı sonrası hak kullanım ve dağıtım tarihleri şirket tarafından KAP'ta duyurulur ("KAP Duyuruları" sekmesi).</p>
          </>
        )}

        {tab === 'kap' && (data.kap.length === 0
          ? (data.kap_loading ? <Loading text="KAP duyuruları getiriliyor…" /> : <EmptyState icon="📢" title="Son 7 günde ilgili KAP duyurusu yok" text="Halka arz, sermaye artırımı, pay alma hakkı ve izahname duyuruları burada listelenir." />)
          : <ul className="kap-ipo-list">{data.kap.map(k => (
              <li key={k.id}>
                <div className="row between wrap gap">
                  <a href={k.url} target="_blank" rel="noreferrer"><b>{k.title}</b></a>
                  <span className="muted small">{k.time ? new Date(k.time * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <div className="small">{k.codes?.slice(0, 3).map(c => <button key={c} className="code-link" onClick={() => openStock(`${c}.IS`)}>{c}</button>)} <span className="muted">{k.company}</span></div>
                {k.summary && <div className="muted small">{k.summary}</div>}
              </li>
            ))}</ul>)}
      </div>
      </>)}
      {mkt === 'us'
        ? <p className="disclaimer">Kaynak: Nasdaq halka arz takvimi (SEC kayıtları). Fiyatlar Yahoo Finance'ten alınır, birkaç dakika gecikmeli olabilir. Yatırım tavsiyesi değildir.</p>
        : <p className="disclaimer">Kaynak: SPK İlk Halka Arz Başvuruları listesi, <a href={bulletinUrl} target="_blank" rel="noreferrer">SPK Bültenleri</a> ve KAP. Veriler bilgilendirme amaçlıdır; halka arz katılımı için aracı kurumunuzun ve izahnamenin güncel bilgilerini esas alın. Yatırım tavsiyesi değildir.</p>}
    </div>
  )
}

function IpoCard({ i }: { i: Ipo }) {
  const sold = (i.increase ?? 0) + (i.sale_existing ?? 0) + (i.sale_extra ?? 0)
  return (
    <div className="ipo-card">
      <div className="row between gap"><span className="pill up">SPK onaylı</span><span className="muted small">{dateTR(i.date)} · Bülten {i.bulletin}</span></div>
      <h3>{i.company}</h3>
      <div className="ipo-price">
        <div><span className="muted small">Satış fiyatı</span><b className="mono">{i.price ? `${fmtPrice(i.price)}${i.price_max ? ` – ${fmtPrice(i.price_max)}` : ''} TL` : 'Belirtilmedi'}</b></div>
        <div><span className="muted small">Halka arz büyüklüğü</span><b>{big(i.size_try)}</b></div>
      </div>
      <div className="fact-grid">
        <div><span className="muted small">Satışa sunulan pay</span><b className="small">{lots(sold || null)}</b></div>
        <div><span className="muted small">Halka açıklık</span><b className="small">{i.float_pct ? `%${i.float_pct.toFixed(1)}` : '—'}</b></div>
        <div><span className="muted small">Sermaye artırımı</span><b className="small">{lots(i.increase)}</b></div>
        <div><span className="muted small">Ortak satışı</span><b className="small">{lots((i.sale_existing ?? 0) + (i.sale_extra ?? 0) || null)}</b></div>
      </div>
      {i.notes && <details><summary className="small muted">SPK bülteni dipnotları</summary><p className="small muted">{i.notes}</p></details>}
      {i.symbol ? <button className="btn ghost small" onClick={() => openStock(i.symbol!)}>📈 {short(i.symbol)} hisse kartını aç</button>
        : <span className="muted small">Talep toplama tarihleri ve işlem kodu KAP'ta duyurulur.</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ ABD halka arzları */
type UsTab = 'upcoming' | 'filed' | 'priced' | 'withdrawn'
const usd = (v: number | null | undefined) => v == null || v === 0 ? '—' : v >= 1e9 ? `${(v / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyar $` : `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} milyon $`
const daysTo = (d: string | null) => { if (!d) return ''; const n = Math.round((new Date(d).getTime() - Date.now()) / 864e5); return n <= 0 ? 'bugün/yarın' : `${n} gün sonra` }

function UsIpoView({ us, prefs, setPref }: { us: UsData; prefs: Prefs; setPref: (k: keyof Prefs, v: boolean) => void }) {
  const [tab, setTab] = useState<UsTab>(us.upcoming.length ? 'upcoming' : 'priced')
  const [hideSpac, setHideSpac] = useState(true)
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const keep = (r: UsRow) => (!hideSpac || !r.spac) && (!term || r.company.toLowerCase().includes(term) || (r.ticker ?? '').toLowerCase().includes(term))
  const st = us.stats
  return (
    <>
      <div className="grid4">
        <div className="card kpi clickable" onClick={() => setTab('upcoming')}><div className="muted small">Fiyatlanması yaklaşan</div><div className="kpi-value">{st.upcoming}</div><div className="muted small">bu ve önümüzdeki ay</div></div>
        <div className="card kpi clickable" onClick={() => setTab('priced')}><div className="muted small">Bu yıl borsaya gelen</div><div className="kpi-value">{st.priced_year}</div><div className="muted small">toplam {usd(st.raised_year)} toplandı</div></div>
        <div className="card kpi clickable" onClick={() => setTab('priced')}><div className="muted small">Son 1 yıldaki halka arzların ort. getirisi</div><div className={`kpi-value ${tone(st.avg_return)}`}>{us.prices_loading && st.avg_return == null ? '…' : fmtPct(st.avg_return)}</div>
          <div className="muted small">{st.positive_share != null ? `%${st.positive_share.toFixed(0)}'i halka arz fiyatının üzerinde` : us.prices_loading ? 'fiyatlar getiriliyor' : 'SPAC\'lar hariç'}</div></div>
        <div className="card kpi">
          <div className="muted small">🔔 Bildirimler</div>
          <label className="toggle-row small"><input type="checkbox" checked={prefs.us} onChange={e => setPref('us', e.target.checked)} />ABD halka arzları</label>
          <label className="toggle-row small"><input type="checkbox" checked={prefs.approvals} disabled={!prefs.us} onChange={e => setPref('approvals', e.target.checked)} />Yaklaşan ve fiyatlanan</label>
          <label className="toggle-row small"><input type="checkbox" checked={prefs.applications} disabled={!prefs.us} onChange={e => setPref('applications', e.target.checked)} />Yeni SEC başvurusu</label>
        </div>
      </div>
      <div className="card">
        <div className="row between wrap gap">
          <div className="seg">
            <button className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>🗓 Yaklaşanlar ({us.upcoming.length})</button>
            <button className={tab === 'filed' ? 'active' : ''} onClick={() => setTab('filed')}>📝 Yeni Başvurular</button>
            <button className={tab === 'priced' ? 'active' : ''} onClick={() => setTab('priced')}>📜 Geçmiş Halka Arzlar</button>
            <button className={tab === 'withdrawn' ? 'active' : ''} onClick={() => setTab('withdrawn')}>↩ Geri Çekilenler</button>
          </div>
          <div className="row gap">
            <label className="toggle-row small" title="SPAC: ticari faaliyeti olmayan, ileride bir şirketle birleşmek için kurulan 'açık çek' şirketleri"><input type="checkbox" checked={hideSpac} onChange={e => setHideSpac(e.target.checked)} />SPAC'ları gizle</label>
            {tab !== 'upcoming' && <input className="screener-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Şirket veya kod ara…" />}
          </div>
        </div>

        {tab === 'upcoming' && (us.upcoming.filter(keep).length === 0
          ? <EmptyState icon="🗓" title="Şu an fiyatlanması beklenen halka arz yok" text="Bir şirket fiyat aralığını açıklayıp takvime girdiğinde burada görünür ve size bildirim gelir." />
          : <div className="ipo-grid">{us.upcoming.filter(keep).map(r => (
              <div key={r.deal_id} className="ipo-card">
                <div className="row between gap"><span className="pill up">Fiyatlanma: {daysTo(r.expected_date)}</span><span className="muted small">{dateTR(r.expected_date)}</span></div>
                <h3>{r.company} {r.ticker && <span className="sym">({r.ticker})</span>}</h3>
                <div className="ipo-price">
                  <div><span className="muted small">Fiyat aralığı</span><b className="mono">{r.price_low ? `${r.price_low.toFixed(2)}${r.price_high && r.price_high !== r.price_low ? `–${r.price_high.toFixed(2)}` : ''} $` : '—'}</b></div>
                  <div><span className="muted small">Halka arz büyüklüğü</span><b>{usd(r.offer_amount)}</b></div>
                </div>
                <div className="fact-grid">
                  <div><span className="muted small">Borsa</span><b className="small">{r.exchange ?? '—'}</b></div>
                  <div><span className="muted small">Satılacak pay</span><b className="small">{r.shares ? `${(r.shares / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} milyon` : '—'}</b></div>
                </div>
                {r.spac && <span className="muted small">SPAC (birleşme amaçlı şirket)</span>}
              </div>
            ))}</div>)}

        {tab === 'filed' && (
          <>
            <p className="muted small mt">Son bir yılda ABD Menkul Kıymetler Komisyonu'na (SEC) halka arz kaydı için başvuran ve henüz fiyatlanmamış şirketler.</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Başvuru</th><th>Şirket</th><th className="r">Planlanan büyüklük</th><th className="r">Bekleme</th></tr></thead>
              <tbody>{us.filed.filter(keep).map(r => (
                <tr key={r.deal_id}><td className="nowrap">{dateTR(r.filed_date)}</td>
                  <td>{r.ticker && <span className="sym">{r.ticker} </span>}<span className={r.ticker ? 'muted small' : ''}>{r.company}</span> {r.spac && <span className="pill">SPAC</span>}</td>
                  <td className="r small">{usd(r.offer_amount)}</td><td className="r small">{waited(r.waiting_days ?? null)}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}

        {tab === 'priced' && (
          <>
            <p className="muted small mt">Son bir yılda fiyatlanıp borsada işlem görmeye başlayan şirketler ve halka arz fiyatına göre bugünkü getirileri. Hisseye tıklayınca özet kartı açılır. Küçük şirketlerde sonradan yapılan pay birleştirmeleri (ters bölünme) getiriyi olduğundan farklı gösterebilir.</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Tarih</th><th>Şirket</th><th className="r">Halka arz fiyatı</th><th className="r">Büyüklük</th><th className="r">Güncel fiyat</th><th className="r">Getiri</th></tr></thead>
              <tbody>{us.priced.filter(keep).map(r => (
                <tr key={r.deal_id} className={r.ticker && !r.spac ? 'clickable' : ''} onClick={() => r.ticker && !r.spac && openStock(r.ticker)}>
                  <td className="nowrap">{dateTR(r.priced_date)}</td>
                  <td>{r.ticker && <span className="sym">{r.ticker} </span>}<span className="muted small">{r.company}</span> {r.spac && <span className="pill">SPAC</span>}</td>
                  <td className="r mono">{r.price ? `${r.price.toFixed(2)} $` : '—'}</td>
                  <td className="r small">{usd(r.offer_amount)}</td>
                  <td className="r mono">{r.current_price ? `${fmtPrice(r.current_price)} $` : <span className="muted small">{us.prices_loading ? '…' : '—'}</span>}</td>
                  <td className={`r mono ${tone(r.return_pct)}`}>{fmtPct(r.return_pct)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}

        {tab === 'withdrawn' && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Geri çekilme</th><th>Şirket</th><th>Başvuru</th><th className="r">Planlanan büyüklük</th></tr></thead>
            <tbody>{us.withdrawn.filter(keep).map(r => (
              <tr key={r.deal_id}><td className="nowrap">{dateTR(r.withdrawn_date)}</td><td>{r.company} {r.spac && <span className="pill">SPAC</span>}</td>
                <td className="nowrap muted small">{dateTR(r.filed_date)}</td><td className="r small">{usd(r.offer_amount)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  )
}
