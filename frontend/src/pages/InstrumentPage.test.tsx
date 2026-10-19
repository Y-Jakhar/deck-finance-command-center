import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDemoInstrumentSync } from '../test/fixtures'
import { InstrumentView } from './InstrumentPage'

describe('BTC/USD instrument page', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))
  afterEach(() => vi.unstubAllGlobals())
  function getRangedInstrument() {
    const data = getDemoInstrumentSync()
    const latest = Date.parse('2026-08-15T12:00:00.000Z')
    const offsetsInHours = [9600, 4800, 480, 72, 12, 0.5, 0]
    data.candles = offsetsInHours.map((hours, index) => ({
      ...data.candles[0],
      timestamp: new Date(latest - hours * 60 * 60 * 1000).toISOString(),
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
    }))
    return data
  }

  it('labels every fixture context as demo data', () => {
    render(<InstrumentView state={{ status: 'ready', data: getDemoInstrumentSync() }} />)
    expect(screen.getAllByText(/Demo data/i).length).toBeGreaterThan(1)
    expect(screen.getAllByLabelText(/Data status: Demo data/i).length).toBeGreaterThan(0)
  })

  it('shows the source and market timestamp beside the quote', () => {
    render(<InstrumentView state={{ status: 'ready', data: getDemoInstrumentSync() }} />)
    expect(screen.getAllByText(/CoinGecko-compatible schema/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/15 Aug 2026, 12:44:08 UTC/i)).toBeInTheDocument()
    expect(screen.getByText(/Reference price · USD/i, { selector: '.quote-main .eyebrow' })).toBeInTheDocument()
  })

  it('requests daily candles when moving beyond the one-day hourly view', async () => {
    const user = userEvent.setup()
    const daily = getRangedInstrument().candles.map(c => ({ ...c, interval: '1d' }))
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/api/desk/datasets') ? [] : { candles: daily, interval: '1d', source: 'Test provider', cacheStatus: 'provider', freshness: { label: 'Test', state: 'fresh' } } }))
    vi.stubGlobal('fetch', fetcher)
    render(<InstrumentView state={{ status: 'ready', data: getRangedInstrument() }} />)
    const chartTable = screen.getByRole('table', { name: /candles/i })
    const oneDay = screen.getByRole('button', { name: '1D' })
    expect(oneDay).toHaveAttribute('aria-pressed', 'true')
    expect(within(chartTable).getAllByRole('row')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: '1W' }))
    expect(await screen.findByText(/1W · 4 visible candles/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/candles?interval=1d'), expect.anything())
    await user.click(oneDay)
    expect(oneDay).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(screen.getByRole('table', { name: /candles/i })).getAllByRole('row')).toHaveLength(4))
  })

  it('discloses partial long-range history instead of implying full coverage', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/datasets') ? [] : { candles: getDemoInstrumentSync().candles.map(c => ({ ...c, interval: '1d' })), interval: '1d', source: 'Test provider', cacheStatus: 'provider', freshness: { label: 'Test', state: 'fresh' } } })))
    render(<InstrumentView state={{ status: 'ready', data: getDemoInstrumentSync() }} />)
    await user.click(screen.getByRole('button', { name: '5Y' }))
    expect(await screen.findByText(/Partial 5Y coverage/)).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: /candles/i })).getAllByRole('row')).toHaveLength(25)
  })

  it('shows an explicit empty chart state', () => {
    const data = getDemoInstrumentSync()
    data.candles = []
    render(<InstrumentView state={{ status: 'ready', data }} />)
    expect(screen.getByText('No candle data is available for this range.')).toBeInTheDocument()
  })

  it('moves between research tabs with arrow keys', async () => {
    const user = userEvent.setup()
    render(<InstrumentView state={{ status: 'ready', data: getDemoInstrumentSync() }} />)
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a non-color stale warning', () => {
    const data = getDemoInstrumentSync()
    data.freshness = { state: 'stale', label: 'Stale · 38 min old', ageSeconds: 2280, checkedAt: data.freshness.checkedAt }
    render(<InstrumentView state={{ status: 'stale', data }} />)
    expect(screen.getAllByRole('status').some(item => item.textContent?.includes('Stale data'))).toBe(true)
    expect(screen.getAllByText(/Stale · 38 min old/i).length).toBeGreaterThan(0)
  })

  it('gives direction when provider data is unavailable', () => {
    render(<InstrumentView state={{ status: 'unavailable', message: 'No configured provider covers this instrument.', lastChecked: '2026-08-15T12:44:17.000Z' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Current quote unavailable')
    expect(screen.getByText(/local CSV\/JSON import/)).toBeInTheDocument()
  })
})
