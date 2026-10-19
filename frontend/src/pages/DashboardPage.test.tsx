import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { btcUsdFixture } from '../data/btcUsdFixture'
import { refreshNews } from '../services/instrumentService'
import { DashboardPage } from './DashboardPage'

vi.mock('../services/instrumentService', () => ({
  getDashboard: vi.fn(async () => ({ generatedAt: '2026-08-16T07:00:00Z', items: [
    { instrument: btcUsdFixture.instrument, snapshot: { quote: btcUsdFixture.quote, freshness: btcUsdFixture.freshness, cacheStatus: 'provider' }, status: 'ready', message: null },
    { instrument: { ...btcUsdFixture.instrument, id: 'aapl-id', displaySymbol: 'AAPL', name: 'Apple Inc.', assetClass: 'equity', providerMappings: { stooq: 'aapl.us' } }, snapshot: null, status: 'unavailable', message: 'Stooq browser verification' },
  ] })),
  getNews: vi.fn(async () => ({ generatedAt: '2026-08-16T07:00:00Z', items: [] })),
  getEvents: vi.fn(async () => ({ generatedAt: '2026-08-16T07:00:00Z', items: [] })),
  refreshNews: vi.fn(), removeFromWatchlist: vi.fn(),
  exportUrl: (format: string) => `http://127.0.0.1:8000/export.${format}`,
}))

describe('multi-asset dashboard', () => {
  it('keeps unavailable providers visible and offers both exports', async () => {
    render(<DashboardPage onNavigate={vi.fn()} />)
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Stooq browser verification')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('download')
    expect(screen.getByRole('link', { name: 'Export XLSX' })).toHaveAttribute('download')
  })
  it('reports a failed source refresh in the market screen', async () => {
    vi.mocked(refreshNews).mockRejectedValueOnce(new Error('Provider refresh failed'))
    render(<DashboardPage onNavigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh sources' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider refresh failed')
    expect(screen.getByRole('button', { name: 'Refresh sources' })).toBeEnabled()
  })
})
