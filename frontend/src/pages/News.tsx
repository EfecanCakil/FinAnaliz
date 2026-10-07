import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Disclaimer, ErrorBox, Loading, SymbolPicker } from '../components/common'
import { NewsList, SentimentGauge, type NewsRes } from '../components/extras'

const QUICK = ['XU100.IS', 'THYAO.IS', 'ASELS.IS', 'USDTRY=X', 'GRAM-ALTIN', 'AAPL', 'NVDA', 'TSLA', 'BTC-USD', 'ETH-USD']

export default function News() {
  const [params, setParams] = useSearchParams()
  const symbol = params.get('s') || ''
  const [data, setData] = useState<NewsRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'tümü' | 'olumlu' | 'olumsuz' | 'nötr'>('tümü')

  useEffect(() => {
    setData(null); setError(null); setFilter('tümü')
    api<NewsRes>(`/news${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`).then(setData).catch(e => setError(e.message))
  }, [symbol])

  const items = data?.items.filter(i => filter === 'tümü' || i.sentiment === filter) ?? []

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Haberler & Duygu Analizi</h1><p className="muted">Son 7 günün haber başlıkları ve yapay zekâ / sözlük tabanlı duygu analizi</p></div>
        <div className="row gap">
          <SymbolPicker value={symbol} onChange={s => setParams({ s })} placeholder="Varlık seç (boş: genel piyasa)" />
          {symbol && <button className="btn ghost" onClick={() => setParams({})}>Genel piyasa</button>}
        </div>
      </header>
      <div className="chips">
        {QUICK.map(s => <button key={s} className={`chip ${symbol === s ? 'on' : ''}`} onClick={() => setParams({ s })}>{s.replace('.IS', '')}</button>)}
      </div>
      <ErrorBox error={error || data?.error || null} />
      {!data && !error && <Loading text="Haberler çekiliyor ve analiz ediliyor…" />}
      {data && !data.error && (
        <div className="grid-news">
          <div className="card">
            <h3>{data.name}</h3>
            {data.summary ? <SentimentGauge summary={data.summary} /> : <p className="muted">Haber yok.</p>}
            <div className="stats mt">
              <div className="stat"><div className="stat-label">Haber sayısı</div><div className="stat-value">{data.summary?.count ?? 0}</div></div>
              <div className="stat"><div className="stat-label">Yöntem</div><div className="stat-value sm">{data.method}</div></div>
            </div>
            <p className="muted small">
              Duygu analizi yalnızca başlıklar üzerinden yapılır. Ayarlar sayfasında LLM anahtarı tanımlıysa her başlık yapay zekâ ile
              olumlu / olumsuz / nötr olarak sınıflandırılır. Anahtar yoksa Türkçe ve İngilizce finans sözlüğüne dayalı
              kural tabanlı yöntem kullanılır. Haber kaynağı: Google Haberler.
            </p>
          </div>
          <div className="card">
            <div className="row between">
              <h3>Başlıklar</h3>
              <div className="seg">
                {(['tümü', 'olumlu', 'nötr', 'olumsuz'] as const).map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}
              </div>
            </div>
            <NewsList items={items} />
          </div>
        </div>
      )}
      <Disclaimer />
    </div>
  )
}
