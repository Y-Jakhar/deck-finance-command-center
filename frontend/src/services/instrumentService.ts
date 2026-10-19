import type {
  AssetClass, Candle, DashboardResponse, DataFreshness, EventsResponse, Instrument,
  InstrumentLoadState, InstrumentPageData, NewsResponse, PulseEvent, Quote,
  RefreshRun, ResearchBrief, SourceRecord, TodayResearchResponse, ImportPreview,
  ImportCommitResponse,
} from '../types/market'

interface SearchResponse { items: Instrument[] }
interface SnapshotResponse { quote: Quote; freshness: DataFreshness; cacheStatus: string }
interface CandleSeriesResponse {
  candles: Candle[]; freshness: DataFreshness; source: string; interval: string; cacheStatus: string
}
interface ApiDatedEvent { timestamp: string; title: string; source: string }
interface ApiHeadline extends ApiDatedEvent { url: string | null }
interface ResearchResponse {
  generatedAt: string
  methodology: 'deterministic'
  verifiedPriceFacts: string[]
  scheduledEvents: ApiDatedEvent[]
  sourcedHeadlines: ApiHeadline[]
  ruleGeneratedObservations: string[]
  missingOrStaleWarnings: string[]
  sources: SourceRecord[]
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: 'Market data service unavailable' }))
    throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Market data service unavailable')
  }
  return response.json() as Promise<T>
}

async function requestNoContent(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Request failed')
  }
}

export async function searchInstruments(query: string, assetClass?: AssetClass): Promise<Instrument[]> {
  const params = new URLSearchParams({ q: query })
  if (assetClass) params.set('asset_class', assetClass)
  return (await fetchJson<SearchResponse>(`/api/v1/search?${params}`)).items
}

export const getDashboard = () => fetchJson<DashboardResponse>('/api/v1/dashboard')
export const getCandleSeries = (instrumentId: string, interval: '1h' | '1d') =>
  fetchJson<CandleSeriesResponse>(`/api/v1/instruments/${encodeURIComponent(instrumentId)}/candles?interval=${interval}`)
export const getNews = (limit = 12) => fetchJson<NewsResponse>(`/api/v1/news?limit=${limit}`)
export const getEvents = (limit = 12) => fetchJson<EventsResponse>(`/api/v1/events?limit=${limit}`)
export const refreshNews = () => fetchJson<{ collected: number }>('/api/v1/news/refresh', { method: 'POST' })
export const addToWatchlist = (instrumentId: string) => requestNoContent('/api/v1/watchlist', {
  method: 'POST', body: JSON.stringify({ instrumentId }),
})
export const removeFromWatchlist = (instrumentId: string) => requestNoContent(
  `/api/v1/watchlist/${encodeURIComponent(instrumentId)}`, { method: 'DELETE' },
)
export const exportUrl = (format: 'csv' | 'xlsx') => `${API_BASE_URL}/api/v1/export/watchlist.${format}`
export const getToday = () => fetchJson<TodayResearchResponse>('/api/v1/research/today')
export const refreshAll = () => fetchJson<RefreshRun>('/api/v1/refresh', { method: 'POST' })
export const runExportUrl = (runId: string, format: 'csv' | 'xlsx') =>
  `${API_BASE_URL}/api/v1/runs/${encodeURIComponent(runId)}/export.${format}`

export async function previewImport(file: File): Promise<ImportPreview> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`${API_BASE_URL}/api/v1/import/preview`, {
    method: 'POST', body, headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: 'Import preview failed' }))
    throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Import preview failed')
  }
  return response.json() as Promise<ImportPreview>
}

export const commitImport = (token: string) => fetchJson<ImportCommitResponse>(
  '/api/v1/import/commit', { method: 'POST', body: JSON.stringify({ token }) },
)

function checkpoints(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index)
  return Array.from(new Set(Array.from({ length: count }, (_, index) =>
    Math.round((index * (length - 1)) / (count - 1)))))
}

function buildPulse(
  candles: Candle[], quote: Quote, quoteFreshness: DataFreshness,
  candleFreshness: DataFreshness, research: ResearchResponse, cacheStatus: string,
): PulseEvent[] {
  const priceEvents: PulseEvent[] = checkpoints(candles.length, 5).map((index) => ({
    id: `quote-${candles[index].timestamp}`,
    timestamp: candles[index].timestamp,
    type: 'quote',
    title: `${quote.currency} ${candles[index].close.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
    detail: `${candles[index].interval} close recorded`,
    source: candles[index].source,
    status: candleFreshness.state === 'stale' ? 'stale' : 'confirmed',
  }))
  const newsEvents: PulseEvent[] = research.sourcedHeadlines.slice(0, 2).map((item, index) => ({
    id: `news-${index}-${item.timestamp}`, timestamp: item.timestamp, type: 'news', title: item.title,
    detail: 'Sourced context; excluded from price calculations', source: item.source, status: 'attention',
  }))
  const datedEvents: PulseEvent[] = research.scheduledEvents.slice(0, 2).map((item, index) => ({
    id: `event-${index}-${item.timestamp}`, timestamp: item.timestamp, type: 'event', title: item.title,
    detail: 'Dated market event', source: item.source, status: 'attention',
  }))
  const providerEvent: PulseEvent = {
    id: `freshness-${quoteFreshness.checkedAt}`, timestamp: quoteFreshness.checkedAt, type: 'freshness',
    title: quoteFreshness.state === 'stale' ? 'Stale source record' : 'Freshness checked',
    detail: quoteFreshness.label, source: `Go-Terminal · ${cacheStatus.replaceAll('_', ' ')}`,
    status: quoteFreshness.state === 'stale' ? 'stale' : 'confirmed',
  }
  return [...priceEvents, ...newsEvents, ...datedEvents, providerEvent]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).slice(-9)
}

export async function getInstrumentPage(instrumentId: string): Promise<InstrumentLoadState> {
  const lastChecked = new Date().toISOString()
  let instrument: Instrument | undefined
  try {
    const encodedId = encodeURIComponent(instrumentId)
    instrument = await fetchJson<Instrument>(`/api/v1/instruments/${encodedId}`)
    const interval = instrument.assetClass === 'crypto' ? '1h' : '1d'
    const [snapshot, candleSeries, researchResponse] = await Promise.all([
      fetchJson<SnapshotResponse>(`/api/v1/instruments/${encodedId}/snapshot`),
      fetchJson<CandleSeriesResponse>(`/api/v1/instruments/${encodedId}/candles?interval=${interval}`),
      fetchJson<ResearchResponse>(`/api/v1/instruments/${encodedId}/research`),
    ])
    const research: ResearchBrief = {
      generatedAt: researchResponse.generatedAt, methodology: researchResponse.methodology,
      verifiedFacts: researchResponse.verifiedPriceFacts,
      observations: researchResponse.ruleGeneratedObservations,
      warnings: researchResponse.missingOrStaleWarnings,
      events: researchResponse.scheduledEvents,
      headlines: researchResponse.sourcedHeadlines,
    }
    const data: InstrumentPageData = {
      instrument, quote: snapshot.quote, candles: candleSeries.candles, candleInterval: candleSeries.interval,
      research, sources: researchResponse.sources,
      pulse: buildPulse(candleSeries.candles, snapshot.quote, snapshot.freshness,
        candleSeries.freshness, researchResponse, candleSeries.cacheStatus),
      freshness: snapshot.freshness,
    }
    return { status: snapshot.freshness.state === 'stale' ? 'stale' : 'ready', data }
  } catch (error) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'Market data unavailable.', lastChecked, instrument }
  }
}

export async function getBtcUsdInstrument(): Promise<InstrumentLoadState> {
  try {
    const instruments = await searchInstruments('BTC / USD', 'crypto')
    const btc = instruments.find((item) => item.displaySymbol === 'BTC / USD') ?? instruments[0]
    if (!btc) return { status: 'unavailable', message: 'The canonical BTC/USD instrument is not registered.', lastChecked: new Date().toISOString() }
    return getInstrumentPage(btc.id)
  } catch (error) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'Market data unavailable.', lastChecked: new Date().toISOString() }
  }
}
