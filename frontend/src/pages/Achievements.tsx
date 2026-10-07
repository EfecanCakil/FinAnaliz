import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, fmtPct, tone } from '../api'
import Chart, { COLORS, type SeriesSpec } from '../components/Chart'
import { Skeleton } from '../components/ui'
import Markdown from '../components/Markdown'

type Badge = { key: string; name: string; icon: string; description: string; earned: boolean; earned_at: string | null }
type Month = { month: string; trades: number; buys: number; sells: number; realized: number; wins: number; win_rate: number | null
  best: { symbol: string; pnl: number } | null; worst: { symbol: string; pnl: number } | null; equity_change_pct: number | null; equity_end: number | null }
type Group = { label: string; count: number; pnl: number; wins: number; win_rate: number }
type Journal = { by_emotion: Group[]; by_tag: Group[]; closed_trades: number; total_realized: number }

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const monthName = (m: string) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`
const grade = (m: Month) => {
  const score = (m.equity_change_pct ?? 0) * 2 + (m.win_rate ?? 50) / 10 + Math.min(m.trades, 10) / 2
  return score >= 15 ? 'A' : score >= 8 ? 'B' : score >= 3 ? 'C' : 'D'
}

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted small">Henüz kapanmış işlem yok.</p> : (
        <table className="table"><thead><tr><th>Grup</th><th className="r">İşlem</th><th className="r">Başarı</th><th className="r">K/Z</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.label}><td>{r.label}</td><td className="r mono">{r.count}</td><td className="r mono">%{r.win_rate.toFixed(0)}</td>
            <td className={`r mono ${tone(r.pnl)}`}>{fmtMoney(r.pnl, 'TRY')}</td></tr>)}</tbody></table>
      )}
    </div>
  )
}

export default function Achievements() {
  const [badges, setBadges] = useState<Badge[] | null>(null)
  const [months, setMonths] = useState<Month[] | null>(null)
  const [eq, setEq] = useState<{ day: string; equity: number }[]>([])
  const [journal, setJournal] = useState<Journal | null>(null)
  const [weekly, setWeekly] = useState<{ text: string; source: string; created_at: string } | null>(null)
  const [wMsg, setWMsg] = useState<string | null>(null)
  const loadWeekly = (refresh = false) => api<{ text: string; source: string; created_at: string }>(`/report/weekly${refresh ? '?refresh=true' : ''}`).then(setWeekly).catch(() => {})
  const toTelegram = () => api('/report/weekly/telegram', { method: 'POST' }).then(() => setWMsg('Rapor Telegram\'a gönderildi.')).catch(e => setWMsg(e.message))
  useEffect(() => {
    api<Badge[]>('/badges').then(b => { setBadges(b); api<{ day: string; equity: number }[]>('/equity/history').then(setEq) }).catch(() => setBadges([]))
    api<Month[]>('/report/monthly').then(setMonths).catch(() => setMonths([]))
    api<Journal>('/journal/stats').then(setJournal).catch(() => {})
    loadWeekly()
  }, [])
  const series = useMemo<SeriesSpec[]>(() => eq.length ? [{ kind: 'area', color: COLORS.blue, title: 'Hesap değeri',
    data: eq.map(e => ({ time: Math.floor(new Date(e.day + 'T12:00:00').getTime() / 1000), value: e.equity })) }] : [], [eq])
  const earned = badges?.filter(b => b.earned).length ?? 0

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Başarılar & Karne</h1><p className="muted">Rozetleriniz, aylık performans karneniz ve işlem günlüğü istatistikleriniz</p></div>
      </header>
      <div className="card">
        <div className="row between wrap gap">
          <h3>📊 Haftalık Kişisel Rapor</h3>
          <div className="row gap"><button className="btn ghost small" onClick={() => loadWeekly(true)}>↻ Yeniden oluştur</button>
            <button className="btn ghost small" onClick={toTelegram}>📨 Telegram'a gönder</button></div>
        </div>
        {wMsg && <div className="info-box small" onClick={() => setWMsg(null)}>{wMsg}</div>}
        {!weekly ? <Skeleton rows={4} /> : <Markdown text={weekly.text} />}
        <p className="muted small">Rapor her pazartesi otomatik hazırlanır, bildirim olarak gelir ve Telegram ayarlıysa telefonunuza gönderilir.</p>
      </div>

      <div className="card">
        <div className="row between"><h3>Rozetler</h3>{badges && <span className="muted">{earned} / {badges.length} kazanıldı</span>}</div>
        {badges && <div className="prob neutral mb"><div style={{ width: `${earned / badges.length * 100}%` }} /></div>}
        {!badges ? <Skeleton rows={3} /> : (
          <div className="badge-grid">
            {badges.map(b => (
              <div key={b.key} className={`badge ${b.earned ? 'earned' : ''}`} title={b.description}>
                <div className="badge-icon">{b.icon}</div>
                <div className="strong">{b.name}</div>
                <div className="muted small">{b.description}</div>
                {b.earned_at && <div className="tiny muted">{b.earned_at.slice(0, 10)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Aylık Karne</h3>
        {!months ? <Skeleton rows={4} /> : months.length === 0 ? <p className="muted">Henüz işlem yok.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ay</th><th className="c">Not</th><th className="r">İşlem</th><th className="r">Gerçekleşen K/Z</th><th className="r">Başarı oranı</th>
              <th className="r">Hesap değeri değişimi</th><th>En iyi</th><th>En kötü</th></tr></thead>
            <tbody>{months.map(m => (
              <tr key={m.month}>
                <td className="strong">{monthName(m.month)}</td>
                <td className="c"><span className={`grade g${grade(m)}`}>{grade(m)}</span></td>
                <td className="r mono">{m.trades} <span className="muted small">({m.buys} al / {m.sells} sat)</span></td>
                <td className={`r mono ${tone(m.realized)}`}>{fmtMoney(m.realized, 'TRY')}</td>
                <td className="r mono">{m.win_rate == null ? '—' : `%${m.win_rate.toFixed(0)}`}</td>
                <td className={`r mono ${tone(m.equity_change_pct)}`}>{fmtPct(m.equity_change_pct)}</td>
                <td className="small">{m.best ? <>{m.best.symbol.replace('.IS', '')} <span className={tone(m.best.pnl)}>{fmtMoney(m.best.pnl, 'TRY')}</span></> : '—'}</td>
                <td className="small">{m.worst ? <>{m.worst.symbol.replace('.IS', '')} <span className={tone(m.worst.pnl)}>{fmtMoney(m.worst.pnl, 'TRY')}</span></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="muted small">Not; hesap değeri değişimi, başarı oranı ve işlem sayısının birleşiminden hesaplanan basit bir göstergedir.</p>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Hesap Değeri Geçmişi</h3>
          {series.length > 1 ? <Chart series={series} height={260} /> : <p className="muted">Hesap değeriniz her gün otomatik kaydedilir; grafik birkaç gün sonra oluşur.</p>}
        </div>
        <div className="card">
          <h3>İşlem Günlüğü Analizi</h3>
          {!journal ? <Skeleton rows={3} /> : (
            <>
              <p className="muted small">{journal.closed_trades} kapanmış işlem · toplam gerçekleşen K/Z <span className={tone(journal.total_realized)}>{fmtMoney(journal.total_realized, 'TRY')}</span>.
                İşlemlere "neden aldım", duygu durumu ve etiket ekledikçe hangi yaklaşımın daha çok kazandırdığı burada görünür.</p>
              <div className="grid2"><GroupTable title="Duygu durumuna göre" rows={journal.by_emotion} /><GroupTable title="Etikete göre" rows={journal.by_tag} /></div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
