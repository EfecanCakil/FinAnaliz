import { useEffect, useRef, useState } from 'react'
import {
  AreaSeries, CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Point } from '../api'

export const COLORS = {
  up: '#26a69a', down: '#ef5350', text: '#9aa4b2', grid: 'rgba(255,255,255,0.05)',
  blue: '#4c8dff', orange: '#ff9f43', purple: '#a66cff', yellow: '#f5c542', teal: '#2ec4b6', pink: '#ff6b9d', gray: '#8892a0',
}
export const PALETTE = [COLORS.blue, COLORS.orange, COLORS.teal, COLORS.purple, COLORS.pink, COLORS.yellow]

export type SeriesSpec =
  | { kind: 'candle'; data: Candle[]; pane?: number }
  | { kind: 'volume'; data: Candle[]; pane?: number }
  | { kind: 'line'; data: Point[]; color: string; title?: string; pane?: number; width?: number; dashed?: boolean }
  | { kind: 'area'; data: Point[]; color: string; title?: string; pane?: number }
  | { kind: 'hist'; data: Point[]; pane?: number }

export type Marker = { time: number; position: 'aboveBar' | 'belowBar' | 'inBar'; color: string; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; text?: string }
export type PriceLine = { price: number; color: string; title?: string; dashed?: boolean; width?: number }

type Props = {
  series: SeriesSpec[]
  height?: number
  paneHeights?: number[]
  levels?: { pane: number; value: number; color: string }[]
  percent?: boolean
  markers?: Marker[]
  priceLines?: PriceLine[]
  onClick?: (time: number | null, price: number | null) => void
  cursor?: string
  /** Grafik oluşturulduğunda çağrılır (resim kaydetme vb. için). */
  onChart?: (chart: IChartApi | null) => void
  /** Aynı gruptaki grafikler zaman ekseninde birlikte kaydırılır/yakınlaştırılır. */
  syncGroup?: string
}

const syncGroups = new Map<string, Set<IChartApi>>()

// Fiyat grafiği görünümü: mum, düz çizgi veya alan. Tüm grafikler için ortak tercih.
export type ChartStyle = 'candle' | 'line' | 'area'
const STYLE_KEY = 'finanaliz_chart_style'
const getStyle = (): ChartStyle => { try { return (localStorage.getItem(STYLE_KEY) as ChartStyle) || 'candle' } catch { return 'candle' } }
export function useChartStyle(): [ChartStyle, (s: ChartStyle) => void] {
  const [style, setStyle] = useState(getStyle)
  useEffect(() => {
    const h = () => setStyle(getStyle())
    window.addEventListener('finanaliz:chart-style', h)
    return () => window.removeEventListener('finanaliz:chart-style', h)
  }, [])
  return [style, (s: ChartStyle) => {
    try { localStorage.setItem(STYLE_KEY, s) } catch { /* yoksay */ }
    window.dispatchEvent(new Event('finanaliz:chart-style'))
  }]
}
export function ChartStyleToggle() {
  const [style, setStyle] = useChartStyle()
  const opts: [ChartStyle, string, string][] = [['candle', '🕯 Mum', 'Mum grafiği'], ['line', '📈 Çizgi', 'Düz çizgi grafiği (kapanış fiyatları)'], ['area', '◭ Alan', 'Alan grafiği']]
  return (
    <div className="seg" title="Grafik türü">
      {opts.map(([k, label, tip]) => <button key={k} className={style === k ? 'active' : ''} title={tip} onClick={() => setStyle(k)}>{label}</button>)}
    </div>
  )
}

const ts = (t: number) => t as UTCTimestamp

/** Açık/koyu tema değiştiğinde grafiklerin yeniden çizilmesi için. */
export function useThemeKey() {
  const [key, setKey] = useState(document.documentElement.dataset.theme ?? 'dark')
  useEffect(() => {
    const h = () => setKey(document.documentElement.dataset.theme ?? 'dark')
    window.addEventListener('finanaliz:theme', h)
    return () => window.removeEventListener('finanaliz:theme', h)
  }, [])
  return key
}

export default function Chart({ series, height = 420, paneHeights, levels = [], percent, markers, priceLines, onClick, cursor, onChart, syncGroup }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const theme = useThemeKey()
  const [style] = useChartStyle()

  useEffect(() => {
    if (!ref.current) return
    const css = getComputedStyle(document.documentElement)
    const textColor = css.getPropertyValue('--muted').trim() || COLORS.text
    const gridColor = css.getPropertyValue('--chart-grid').trim() || COLORS.grid
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' }, textColor, fontSize: 12,
        panes: { separatorColor: gridColor },
      },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { mode: 0 },
      localization: {
        locale: 'tr-TR',
        priceFormatter: (p: number) => percent ? `${p.toFixed(2)}%`
          : Math.abs(p) >= 1000 ? p.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
          : p.toLocaleString('tr-TR', { maximumFractionDigits: Math.abs(p) < 1 ? 6 : 4 }),
      },
    })
    chartRef.current = chart
    let main: ISeriesApi<any> | null = null

    for (const s of series) {
      const pane = s.pane ?? 0
      if (s.kind === 'candle' && style !== 'candle') {
        const up = s.data.length > 1 && s.data[s.data.length - 1].close >= s.data[0].close
        const color = up ? COLORS.up : COLORS.down
        const data = s.data.map(c => ({ time: ts(c.time), value: c.close }))
        main = style === 'line'
          ? chart.addSeries(LineSeries, { color: COLORS.blue, lineWidth: 2 }, pane)
          : chart.addSeries(AreaSeries, { lineColor: color, topColor: color + '55', bottomColor: color + '05', lineWidth: 2 }, pane)
        main.setData(data)
      } else if (s.kind === 'candle') {
        main = chart.addSeries(CandlestickSeries, {
          upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false,
        }, pane)
        main.setData(s.data.map(c => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
      } else if (s.kind === 'volume') {
        const v = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }, pane)
        v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
        v.setData(s.data.map(c => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' })))
      } else if (s.kind === 'line') {
        const l = chart.addSeries(LineSeries, {
          color: s.color, lineWidth: (s.width ?? 2) as 1 | 2 | 3 | 4, title: s.title ?? '', priceLineVisible: false,
          lastValueVisible: !!s.title, lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
        }, pane)
        l.setData(s.data.map(p => ({ time: ts(p.time), value: p.value })))
        main ??= l
      } else if (s.kind === 'area') {
        const a = chart.addSeries(AreaSeries, {
          lineColor: s.color, topColor: s.color + '55', bottomColor: s.color + '05', lineWidth: 2, title: s.title ?? '', priceLineVisible: false,
        }, pane)
        a.setData(s.data.map(p => ({ time: ts(p.time), value: p.value })))
        main ??= a
      } else if (s.kind === 'hist') {
        chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
          .setData(s.data.map(p => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' })))
      }
    }

    for (const l of levels) {
      const target = chart.panes()[l.pane]?.getSeries()[0]
      target?.createPriceLine({ price: l.value, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' })
    }
    if (main && priceLines) {
      for (const p of priceLines) {
        main.createPriceLine({ price: p.price, color: p.color, lineWidth: (p.width ?? 1) as 1 | 2, lineStyle: p.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: p.title ?? '' })
      }
    }
    if (main && markers?.length) {
      createSeriesMarkers(main, [...markers].sort((a, b) => a.time - b.time).map(m => ({ ...m, time: ts(m.time) })) as SeriesMarker<Time>[])
    }
    if (main) {
      const ms = main
      chart.subscribeClick(param => {
        if (!clickRef.current || !param.point) return
        const time = (param.time as number | undefined) ?? (chart.timeScale().coordinateToTime(param.point.x) as number | null)
        clickRef.current(time ?? null, ms.coordinateToPrice(param.point.y))
      })
    }

    const panes = chart.panes()
    if (paneHeights && panes.length > 1) panes.forEach((p, i) => paneHeights[i] && p.setHeight(paneHeights[i]))
    chart.timeScale().fitContent()

    let unsync = () => {}
    if (syncGroup) {
      const group = syncGroups.get(syncGroup) ?? new Set<IChartApi>()
      syncGroups.set(syncGroup, group)
      group.add(chart)
      let syncing = false
      const handler = (range: { from: Time; to: Time } | null) => {
        if (!range || syncing) return
        for (const other of group) {
          if (other === chart) continue
          try { syncing = true; other.timeScale().setVisibleRange(range) } catch { /* veri aralığı dışında */ } finally { syncing = false }
        }
      }
      chart.timeScale().subscribeVisibleTimeRangeChange(handler)
      unsync = () => { chart.timeScale().unsubscribeVisibleTimeRangeChange(handler); group.delete(chart) }
    }
    onChart?.(chart)

    return () => { unsync(); onChart?.(null); chart.remove(); chartRef.current = null }
  }, [series, height, paneHeights, levels, percent, markers, priceLines, theme, syncGroup, style])

  return <div ref={ref} className="chart" style={{ height, cursor }} />
}
