import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { btcUsdFixture } from '../data/btcUsdFixture'
import { AppFrame } from './AppFrame'

vi.mock('../services/instrumentService', () => ({
  getDashboard: vi.fn(async () => ({
    generatedAt: '2026-08-29T04:03:07Z',
    items: [{
      instrument: btcUsdFixture.instrument,
      snapshot: { quote: btcUsdFixture.quote, freshness: btcUsdFixture.freshness, cacheStatus: 'provider' },
      status: 'ready',
      message: null,
    }],
  })),
  searchInstruments: vi.fn(async () => []),
}))

describe('terminal application frame', () => {
  it('loads the real research universe and routes instrument selection', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    window.history.replaceState({}, '', '/market')
    render(<AppFrame onNavigate={onNavigate}><main id="main-content">Workspace</main></AppFrame>)

    const instrument = await screen.findByRole('button', { name: /BTC \/ USD Bitcoin \/ US Dollar/i })
    await user.click(instrument)

    expect(onNavigate).toHaveBeenCalledWith(`/instrument/${encodeURIComponent(btcUsdFixture.instrument.id)}`)
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()
    expect(document.querySelector('nav[aria-label="Mobile navigation"]')).toBeInTheDocument()
  })
})
