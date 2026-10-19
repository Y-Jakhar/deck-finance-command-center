import type { Candle } from '../types/market'

export const chartRanges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const
export type ChartRange = (typeof chartRanges)[number]

function cutoffFor(latest: Date, range: ChartRange): number | null {
  if (range === 'MAX') return null
  if (range === 'YTD') return Date.UTC(latest.getUTCFullYear(), 0, 1)
  const date = new Date(latest)
  if (range === '1D') date.setUTCDate(date.getUTCDate() - 1)
  else if (range === '1W') date.setUTCDate(date.getUTCDate() - 7)
  else if (range.endsWith('M')) date.setUTCMonth(date.getUTCMonth() - Number(range.slice(0, -1)))
  else date.setUTCFullYear(date.getUTCFullYear() - Number(range.slice(0, -1)))
  return date.getTime()
}

export function selectChartHistory(candles: Candle[], range: ChartRange) {
  const sorted = candles.filter(c => Number.isFinite(Date.parse(c.timestamp)))
    .slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (!sorted.length) return { visible: [], returnPct: null, coverage: 'No historical candles are available.' }
  const latest = new Date(sorted.at(-1)!.timestamp)
  const cutoff = cutoffFor(latest, range)
  const daily = sorted.every(c => c.interval === '1d' || c.interval === '1w')
  const visible = range === '1D' && daily ? sorted.slice(-1)
    : cutoff === null ? sorted : sorted.filter(c => Date.parse(c.timestamp) >= cutoff)
  const previous = range === '1D' && daily ? sorted.at(-2) : undefined
  const first = previous || visible[0]
  const last = visible.at(-1)
  const returnPct = first && last && first !== last && first.close > 0
    ? (last.close / first.close - 1) * 100 : null
  const firstTime = Date.parse(sorted[0].timestamp)
  const slack = daily ? 4 * 86400000 : 0
  const coverage = cutoff !== null && range !== '1D' && firstTime > cutoff + slack
    ? `Partial ${range} coverage: history begins ${sorted[0].timestamp.slice(0, 10)}; no earlier observations were supplied.`
    : range === '1D' && daily && !previous
      ? 'Only one daily candle is available; prior close return is unavailable.'
      : visible.length === 0 ? `No candles fall in the selected ${range} window.` : null
  return { visible, returnPct, coverage }
}

export function parseSavedCandles(csvText: string, instrumentId: string, source: string, interval: string): Candle[] {
  const lines = csvText.trim().split(/\r?\n/)
  const columns = lines.shift()?.trim().toLowerCase()
  if (columns !== 'timestamp,open,high,low,close,volume') throw new Error('Saved dataset has an unsupported OHLCV column layout.')
  return lines.filter(Boolean).map(line => {
    const [timestamp, open, high, low, close, volume] = line.split(',')
    const numbers = [open, high, low, close, volume].map(Number)
    if (!Number.isFinite(Date.parse(timestamp)) || numbers.some(value => !Number.isFinite(value))) throw new Error('Saved dataset contains an invalid candle.')
    return { instrumentId, timestamp, interval, open: numbers[0], high: numbers[1], low: numbers[2], close: numbers[3], volume: numbers[4], adjustmentStatus: 'See saved dataset policy', source }
  })
}
