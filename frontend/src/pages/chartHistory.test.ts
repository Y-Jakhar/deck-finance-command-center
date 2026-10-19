import { describe, expect, it } from 'vitest'
import { chartRanges, parseSavedCandles, selectChartHistory } from './chartHistory'
import type { Candle } from '../types/market'

const day = 86400000
const first = Date.parse('2020-01-01T00:00:00Z')
const last = Date.parse('2026-10-16T00:00:00Z')
const candles: Candle[] = Array.from({ length: Math.round((last - first) / day) + 1 }, (_, index) => ({
  instrumentId: 'test', timestamp: new Date(first + index * day).toISOString(), interval: '1d',
  open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1,
  adjustmentStatus: 'synthetic test fixture', source: 'Synthetic test fixture',
}))

describe('historical chart windows (synthetic fixture)', () => {
  it('selects actual UTC date boundaries for all ten controls', () => {
    const starts = ['2026-10-16', '2026-10-09', '2026-09-16', '2026-07-16', '2026-04-16',
      '2026-01-01', '2025-10-16', '2023-10-16', '2021-10-16', '2020-01-01']
    chartRanges.forEach((range, index) => {
      const result = selectChartHistory(candles, range)
      expect(result.visible[0].timestamp.slice(0, 10)).toBe(starts[index])
      expect(result.visible.at(-1)?.timestamp.slice(0, 10)).toBe('2026-10-16')
      expect(result.coverage).toBeNull()
    })
    expect(selectChartHistory(candles, '1D').returnPct).toBeCloseTo((candles.at(-1)!.close / candles.at(-2)!.close - 1) * 100)
  })

  it('labels inadequate history and rejects invalid saved values', () => {
    expect(selectChartHistory(candles.slice(-20), '5Y').coverage).toMatch(/Partial 5Y coverage/)
    expect(() => parseSavedCandles('timestamp,open,high,low,close,volume\ninvalid,1,2,0,1,1', 'x', 'fixture', '1d')).toThrow(/invalid candle/)
  })
})
