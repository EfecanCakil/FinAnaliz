import { useEffect, useState } from 'react'
import { api, fmtPct, fmtPrice, tone } from '../api'
import { ErrorBox } from '../components/common'
import { Skeleton } from '../components/ui'

type Pred = { id: number; week: string; symbol: string; direction: 'up' | 'down'; base_price: number; end_price: number | null; result: string | null; points: number | null }
type Card = { symbol: string; name: string; base_price: number | null; price: number | null; week_change_pct: number | null; prediction: Pred | null }
type State = { week: string; week_end: string; can_predict: boolean; cards: Card[]; history: Pred[]; points: number; accuracy: number | null
  leaderboard: { username: string; points: number; correct: number; resolved: number }[] }

const NAMES: Record<string, string> = { 'XU100.IS': 'BIST 100', 'USDTRY=X': 'Dolar/TL', 'GRAM-ALTIN': 'Gram altın', '^GSPC': 'S&P 500', 'BTC-USD': 'Bitcoin' }

export default function Game() {
  const [s, setS] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api<State>('/game').then(setS).catch(e => setError(e.message))
  useEffect(() => { load() }, [])
  const predict = (symbol: string, direction: 'up' | 'down') => api('/game/predict', { body: { symbol, direction } }).then(load).catch(e => setError(e.message))
  const fmtD = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })

  return (
    <div className="page">
      <header className="page-head"><div><h1>Haftalık Tahmin Oyunu</h1><p className="muted">Bu hafta piyasalar yükselişle mi düşüşle mi kapanacak? Tahmin edin, puan toplayın</p></div></header>
      <ErrorBox error={error} />
      {!s ? <Skeleton rows={6} /> : (
        <>
          <div className="grid4">
            <div className="card kpi"><div className="muted small">Toplam puanınız</div><div className="kpi-value">{s.points}</div></div>
            <div className="card kpi"><div className="muted small">Doğruluk oranı</div><div className="kpi-value">{s.accuracy == null ? '—' : `%${s.accuracy.toFixed(0)}`}</div></div>
            <div className="card kpi"><div className="muted small">Bu hafta</div><div className="kpi-value sm">{fmtD(s.week)} – {fmtD(s.week_end)}</div></div>
            <div className="card kpi"><div className="muted small">Tahmin durumu</div><div className={`kpi-value sm ${s.can_predict ? 'up' : 'down'}`}>{s.can_predict ? 'Tahminler açık' : 'Bu hafta kapandı'}</div></div>
          </div>
          <div className="game-grid">
            {s.cards.map(c => (
              <div key={c.symbol} className="card game-card">
                <div className="strong">{c.name}</div>
                <div className="muted small">Geçen cuma kapanışı: {fmtPrice(c.base_price)}</div>
                <div className="kpi-value sm mono">{fmtPrice(c.price)} <span className={`small ${tone(c.week_change_pct)}`}>{fmtPct(c.week_change_pct)}</span></div>
                {c.prediction ? (
                  <div className={`game-pred ${c.prediction.direction}`}>Tahmininiz: {c.prediction.direction === 'up' ? '▲ Yükseliş' : '▼ Düşüş'}
                    <div className="tiny muted">{c.week_change_pct == null ? '' : (c.prediction.direction === 'up') === (c.week_change_pct > 0) ? 'Şu an doğru gidiyor 👍' : 'Şu an ters gidiyor'}</div></div>
                ) : s.can_predict ? (
                  <div className="game-btns">
                    <button className="btn buy" onClick={() => predict(c.symbol, 'up')}>▲ Yükselir</button>
                    <button className="btn sell" onClick={() => predict(c.symbol, 'down')}>▼ Düşer</button>
                  </div>
                ) : <div className="muted small">Tahmin süresi doldu</div>}
              </div>
            ))}
          </div>
          <p className="muted small">Kurallar: Tahminler pazartesi açılır, çarşamba akşamı kapanır. Hafta sonunda cuma kapanışı, bir önceki cuma kapanışıyla karşılaştırılır. Doğru tahmin 10 puan; 5 doğru tahminde 🔮 "Kâhin" rozeti.</p>
          <div className="grid2">
            <div className="card">
              <h3>Puan Tablosu</h3>
              <table className="table"><thead><tr><th>#</th><th>Kullanıcı</th><th className="r">Puan</th><th className="r">Doğru</th></tr></thead>
                <tbody>{s.leaderboard.map((u, i) => <tr key={u.username}><td>{['🥇', '🥈', '🥉'][i] ?? i + 1}</td><td>{u.username}</td><td className="r mono strong">{u.points}</td><td className="r mono">{u.correct ?? 0} / {u.resolved ?? 0}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="card">
              <h3>Geçmiş Tahminlerim</h3>
              {s.history.length === 0 ? <p className="muted">Henüz tahmin yok.</p> : (
                <table className="table"><tbody>{s.history.map(p => (
                  <tr key={p.id}><td className="small">{fmtD(p.week)}</td><td>{NAMES[p.symbol] ?? p.symbol}</td><td>{p.direction === 'up' ? '▲' : '▼'}</td>
                    <td>{p.result == null ? <span className="pill">Bekliyor</span> : p.result === 'correct' ? <span className="pill up">Doğru +{p.points}</span> : <span className="pill down">Yanlış</span>}</td></tr>
                ))}</tbody></table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
