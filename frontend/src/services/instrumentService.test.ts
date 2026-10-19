import { afterEach, describe, expect, it, vi } from 'vitest'
import { btcUsdFixture } from '../data/btcUsdFixture'
import { getBtcUsdInstrument } from './instrumentService'

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
}) as Response

describe('instrument API service', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('assembles the page model from normalized API endpoints', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v1/search')) return jsonResponse({ items: [btcUsdFixture.instrument] })
      if (url.endsWith(`/instruments/${btcUsdFixture.instrument.id}`)) return jsonResponse(btcUsdFixture.instrument)
      if (url.endsWith('/snapshot')) {
        return jsonResponse({ quote: btcUsdFixture.quote, freshness: btcUsdFixture.freshness, cacheStatus: 'provider' })
      }
      if (url.includes('/candles?interval=1h')) {
        return jsonResponse({
          candles: btcUsdFixture.candles,
          freshness: btcUsdFixture.freshness,
          source: btcUsdFixture.quote.source,
          interval: '1h',
          cacheStatus: 'provider',
        })
      }
      if (url.endsWith('/research')) {
        return jsonResponse({
          generatedAt: btcUsdFixture.research.generatedAt,
          methodology: 'deterministic',
          verifiedPriceFacts: btcUsdFixture.research.verifiedFacts,
          scheduledEvents: [],
          sourcedHeadlines: [],
          ruleGeneratedObservations: btcUsdFixture.research.observations,
          missingOrStaleWarnings: btcUsdFixture.research.warnings,
          sources: btcUsdFixture.sources,
        })
      }
      return jsonResponse({ detail: 'not found' }, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const state = await getBtcUsdInstrument()

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw new Error('Expected ready state')
    expect(state.data.instrument.displaySymbol).toBe('BTC / USD')
    expect(state.data.quote.source).toContain('CoinGecko-compatible')
    expect(state.data.pulse.length).toBeGreaterThan(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('turns API failures into a directed unavailable state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'CoinGecko rate limit reached' }, false)))

    const state = await getBtcUsdInstrument()

    expect(state.status).toBe('unavailable')
    if (state.status !== 'unavailable') throw new Error('Expected unavailable state')
    expect(state.message).toBe('CoinGecko rate limit reached')
    expect(state.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
