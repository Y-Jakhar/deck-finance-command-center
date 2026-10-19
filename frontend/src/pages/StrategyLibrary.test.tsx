import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { StrategyLibrary } from './StrategyLibrary'

afterEach(() => vi.unstubAllGlobals())

it('runs every compatible rule on the selected dataset and reports incompatible rules', async () => {
  const names = ['moving_average', 'sma_long_cash', 'donchian_breakout', 'mean_reversion', 'rsi_reversal', 'rate_of_change', 'macd_trend', 'keltner_breakout']
  const catalog = names.map((name, index) => ({ name, family: 'Research', description: name,
    version: '1.0', source_hash: `${index}`, parameters: index < 2 ? { fast: 10, slow: 30 } : { lookback: 20 },
    minimum_bars: 30, compatible: name !== 'keltner_breakout',
    reason: name === 'keltner_breakout' ? 'Needs at least 24 valid bars; dataset has 20.' : null }))
  const posted: Array<{ dataset_id: string; strategy_name: string; mode: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/strategies')) return { ok: true, json: async () => catalog }
    if (url.includes('/buy-hold')) return { ok: true, json: async () => ({ price_return: .12, definition: 'Close to close', adjustment_policy: 'unknown', dataset_hash: 'abc' }) }
    const body = JSON.parse(String(options?.body))
    posted.push(body)
    return { ok: true, json: async () => ({ id: `${posted.length}`, summary: { run_id: `${posted.length}` },
      config: { strategy: body.strategy_name, mode: body.mode, parameters: body.parameters, costs: {} },
      result: { baseline: { metrics: { net_return: .01 } }, out_of_sample: { metrics: {} } } }) }
  }))
  const onSaved = vi.fn(async () => {})
  render(<StrategyLibrary datasetId="same-dataset" settings={{ fee_bps: 5, slippage_bps: 5, fixed_fee: 0,
    initial_capital: 100000, is_ratio: .6, walk_forward_windows: 3 }} contract="[]" experiments={[]} onSaved={onSaved} />)
  expect(await screen.findByText(/Needs at least 24 valid bars/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Run all 7 compatible strategies' }))
  expect(await screen.findByText('7 exploratory runs saved.')).toBeInTheDocument()
  expect(posted.map(item => item.strategy_name)).toEqual(names.slice(0, 7))
  expect(posted.every(item => item.dataset_id === 'same-dataset' && item.mode === 'exploratory')).toBe(true)
  expect(onSaved).toHaveBeenCalledTimes(1)
})
