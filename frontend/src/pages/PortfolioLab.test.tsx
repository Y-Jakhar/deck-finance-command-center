import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioLab } from './PortfolioLab'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('portfolio provenance display', () => {
  it('shows adjustment policies, benchmark source and excluded bars for a saved analysis', async () => {
    const portfolio = {
      id: 'portfolio-1', symbol: 'AAPL', name: 'Sourced fixture', notes: 'Price-only fixture', created_at: '2026-10-18',
      result: {
        aligned_bars: 3, start: '2025-01-01', end: '2025-01-03',
        metrics: { price_return: 0.01, sharpe: 0.2 },
        holdings: [{ symbol: 'AAPL', dataset_id: 'data-a', initial_weight: 1, ending_weight: 1, units: 10, source: 'Archived source', adjustment_policy: 'Raw OHLC, dividends excluded' }],
        correlation: [[1]], equity_curve: [{ equity: 1000, drawdown: 0 }, { equity: 1010, drawdown: 0 }, { equity: 1010, drawdown: 0 }],
        benchmark: { symbol: 'SPY', dataset_id: 'data-b', source: 'Benchmark archive', price_return: 0.02, excess_price_return: -0.01, equity_curve: [1000, 1010, 1020] },
        dropped_observations: [{ dataset_id: 'data-a', excluded_bars: 1 }, { dataset_id: 'data-b', excluded_bars: 2 }],
        limitations: ['No dividend accounting.'],
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const result = path.endsWith('/portfolios') ? [portfolio] : path.endsWith('/datasets') || path.endsWith('/valuation-cases-v2') || path.endsWith('/experiments') ? [] :
        { result: { status: 'unavailable', reason: 'Fixture' }, integration: { reason: 'Historical only', usable_as_current: false } }
      return { ok: true, json: async () => result }
    }))
    render(<PortfolioLab onNavigate={vi.fn()} />)
    await userEvent.selectOptions(await screen.findByLabelText('Open saved portfolio'), 'portfolio-1')
    expect(screen.getByText('Raw OHLC, dividends excluded')).toBeInTheDocument()
    expect(screen.getByText(/Benchmark archive · dataset data-b/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Exact-timestamp alignment losses'))
    expect(screen.getByText('Dataset data-a: 1 excluded bars')).toBeInTheDocument()
    expect(screen.getByText('Dataset data-b: 2 excluded bars')).toBeInTheDocument()
  })
})
