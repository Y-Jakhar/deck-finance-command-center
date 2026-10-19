import { useId, useState } from 'react'
import type { Candle } from '../types/market'

interface CandlestickChartProps {
  candles: Candle[]
  symbol: string
  currency: string
  interval: string
  mode?: 'candles' | 'line'
  showVolume?: boolean
  logScale?: boolean
  zoom?: number
}

const formatPrice = (value: number, currency: string) => {
  if (currency === 'PCT') return `${value.toFixed(2)}%`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: value < 10 ? 4 : 2 }).format(value)
}

export function CandlestickChart({ candles, symbol, currency, interval, mode = 'candles', showVolume = false, logScale = false, zoom = 2 }: CandlestickChartProps) {
  const gradientId = useId().replaceAll(':', '')
  const [hovered, setHovered] = useState<number | null>(null)
  if (candles.length === 0) {
    return <div className="chart-wrap chart-empty" role="status">No candle data is available for this range.</div>
  }
  const width = Math.max(960, Math.min(10000, candles.length * zoom + 80))
  const height = 330
  const plotTop = 24
  const plotBottom = 282
  const plotLeft = 48
  const plotRight = width - 30
  const high = Math.max(...candles.map((candle) => candle.high))
  const low = Math.min(...candles.map((candle) => candle.low))
  const range = high - low || 1
  const xStep = (plotRight - plotLeft) / candles.length
  const bodyWidth = Math.min(24, Math.max(1, xStep * 0.6))
  const log = logScale && low > 0
  const y = (price: number) => plotTop + (log ? (Math.log(high) - Math.log(price)) / (Math.log(high) - Math.log(low) || 1) : (high - price) / range) * (plotBottom - plotTop)
  const gridValues = Array.from({ length: 5 }, (_, index) => log ? Math.exp(Math.log(high) - (Math.log(high) - Math.log(low)) * index / 4) : high - (range * index) / 4)
  const maxVolume = Math.max(...candles.map(candle => candle.volume))
  const closePath = candles
    .map((candle, index) => {
      const x = plotLeft + xStep * index + xStep / 2
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y(candle.close).toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="chart-wrap">
      <svg
        className="price-chart"
        style={{ width: `${width}px`, maxWidth: 'none' }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${gradientId}-title ${gradientId}-desc`}
      >
        <title id={`${gradientId}-title`}>{symbol} {interval} candlestick chart</title>
        <desc id={`${gradientId}-desc`}>
          Chart with {candles.length} candles. High {formatPrice(high, currency)} and low {formatPrice(low, currency)}.
        </desc>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#36c2b4" stopOpacity="0.16" />
            <stop offset="1" stopColor="#36c2b4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridValues.map((price) => (
          <g key={price}>
            <line x1={plotLeft} x2={plotRight} y1={y(price)} y2={y(price)} className="chart-grid" />
            <text x="2" y={y(price) + 4} className="chart-axis">{formatPrice(price, currency)}</text>
          </g>
        ))}
        {mode === 'line' && <path d={`${closePath} L ${plotRight} ${plotBottom} L ${plotLeft + xStep / 2} ${plotBottom} Z`} fill={`url(#${gradientId})`} />}
        <path d={closePath} className="chart-close-line" opacity={mode === 'line' ? 1 : 0.35} />
        {candles.map((candle, index) => {
          const x = plotLeft + xStep * index + xStep / 2
          const rising = candle.close >= candle.open
          const bodyTop = y(Math.max(candle.open, candle.close))
          const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)))
          return (
            <g key={candle.timestamp} className={rising ? 'candle candle--up' : 'candle candle--down'} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
              {mode === 'candles' && <><line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} /></>}
              {mode === 'line' && <rect x={x - xStep / 2} y={plotTop} width={xStep} height={plotBottom - plotTop} fill="transparent" />}
              <title>{candle.timestamp} · O {candle.open} H {candle.high} L {candle.low} C {candle.close} · Volume {candle.volume}</title>
            </g>
          )
        })}
        {hovered !== null && <line x1={plotLeft + xStep * hovered + xStep / 2} x2={plotLeft + xStep * hovered + xStep / 2} y1={plotTop} y2={plotBottom} stroke="var(--od-accent, #86a5ff)" strokeDasharray="4 4" pointerEvents="none" />}
        {showVolume && maxVolume > 0 && candles.map((candle, index) => <rect key={`volume-${candle.timestamp}`} x={plotLeft + xStep * index + xStep / 2 - bodyWidth / 2} y={plotBottom - candle.volume / maxVolume * 44} width={bodyWidth} height={candle.volume / maxVolume * 44} fill="var(--od-muted, #7f8a9a)" opacity="0.35" pointerEvents="none" />)}
        <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="chart-baseline" />
        <text x={plotLeft} y="316" className="chart-time">{new Date(candles[0].timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</text>
        <text x={plotRight} y="316" textAnchor="end" className="chart-time">{new Date(candles.at(-1)!.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })} UTC</text>
      </svg>
      {hovered !== null && <p className="chart-readout" role="status">{candles[hovered].timestamp} · Open {formatPrice(candles[hovered].open, currency)} · High {formatPrice(candles[hovered].high, currency)} · Low {formatPrice(candles[hovered].low, currency)} · Close {formatPrice(candles[hovered].close, currency)} · Volume {candles[hovered].volume.toLocaleString()}</p>}
      <div className="sr-only">
        <table>
          <caption>{symbol} {interval} candles</caption>
          <thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th></tr></thead>
          <tbody>
            {candles.map((candle) => (
              <tr key={candle.timestamp}>
                <td>{candle.timestamp}</td><td>{candle.open}</td><td>{candle.high}</td><td>{candle.low}</td><td>{candle.close}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
