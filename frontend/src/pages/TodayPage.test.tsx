import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { btcUsdFixture } from '../data/btcUsdFixture'
import { TodayOffline, TodayPage } from './TodayPage'

const service = vi.hoisted(() => ({
  getToday: vi.fn(), refreshAll: vi.fn(), previewImport: vi.fn(), commitImport: vi.fn(),
}))

vi.mock('../services/instrumentService', () => ({
  ...service,
  runExportUrl: (id: string, format: string) => `/runs/${id}.${format}`,
}))

const today = {
  generatedAt: '2026-08-16T07:31:00Z',
  run: {
    id: 'run-12345678', startedAt: '2026-08-16T07:30:00Z', finishedAt: '2026-08-16T07:31:00Z',
    status: 'partial', trigger: 'manual', recordCounts: { quotes: 1 }, errors: [], exportPaths: {},
    providers: [{ provider: 'CoinGecko', healthState: 'healthy', startedAt: '2026-08-16T07:30:00Z', finishedAt: '2026-08-16T07:30:02Z', recordsReceived: 1, recordsWritten: 1, cacheUsed: 0, error: null }],
  },
  alerts: [{ id: 'a1', priority: 2, kind: 'provider_coverage', title: 'One instrument needs a source', observation: 'Coverage is incomplete.', rule: 'missing_snapshot', supportingValues: { quoted: 1 }, timestamp: '2026-08-16T07:31:00Z', source: 'Go-Terminal', instrumentId: null, symbol: null }],
  dashboard: { generatedAt: '2026-08-16T07:31:00Z', items: [{ instrument: btcUsdFixture.instrument, snapshot: { quote: btcUsdFixture.quote, freshness: btcUsdFixture.freshness, cacheStatus: 'provider' }, status: 'ready', message: null }] },
  news: [], events: [],
  providerProblems: [{ provider: 'FRED', status: 'disabled', detail: 'Add FRED_API_KEY', healthState: 'misconfigured', lastSuccess: null, lastError: 'FRED is disabled', nextRetryTime: null, cachedCoverage: 0 }],
}

describe('today research workspace', () => {
  beforeEach(() => service.getToday.mockReset())

  it('shows the persisted run receipt, alerts, provider exception, and exports', async () => {
    service.getToday.mockResolvedValue(today)
    render(<TodayPage onNavigate={vi.fn()} />)
    expect(await screen.findByText('What needs attention')).toBeInTheDocument()
    expect(screen.getByText('One instrument needs a source')).toBeInTheDocument()
    expect(screen.getByText('FRED')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workbook' })).toHaveAttribute('download')
  })

  it('explains the empty first-run state without inventing a receipt', async () => {
    service.getToday.mockResolvedValue({ ...today, run: null, alerts: [], providerProblems: [] })
    render(<TodayPage onNavigate={vi.fn()} />)
    expect(await screen.findByText('No attention rules fired')).toBeInTheDocument()
    expect(screen.getByText('Run a refresh to create a receipt')).toBeInTheDocument()
  })

  it('gives a recoverable offline direction', async () => {
    render(<TodayOffline message="Network error" />)
    expect(screen.getByText('Your saved research is safe, but the app is not running')).toBeInTheDocument()
    expect(screen.getByText(/morning launcher/i)).toBeInTheDocument()
  })
})
