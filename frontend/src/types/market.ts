export type AssetClass =
  | 'equity' | 'etf' | 'fund' | 'index' | 'bond' | 'fx'
  | 'crypto' | 'commodity' | 'future' | 'option' | 'macro'

export type QuoteQuality = 'real_time' | 'delayed' | 'end_of_day' | 'indicative' | 'demo'
export type FreshnessState = 'fresh' | 'stale' | 'unavailable' | 'demo'

export interface DataFreshness {
  state: FreshnessState
  label: string
  ageSeconds: number | null
  checkedAt: string
}

export interface Instrument {
  id: string
  assetClass: AssetClass
  displaySymbol: string
  name: string
  mic: string | null
  baseCurrency: string
  quoteCurrency: string
  timezone: string
  identifiers: Record<string, string>
  providerMappings: Record<string, string>
  marketHoursLabel: string
  contractMetadata: Record<string, unknown>
}

export interface Quote {
  instrumentId: string
  price: number
  previousClose: number
  absoluteChange: number
  percentageChange: number
  currency: string
  marketTimestamp: string
  receivedTimestamp: string
  source: string
  delaySeconds: number
  quality: QuoteQuality
}

export interface Candle {
  instrumentId: string
  timestamp: string
  interval: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjustmentStatus: string
  source: string
}

export interface DatedEvent { timestamp: string; title: string; source: string }
export interface SourcedHeadline extends DatedEvent { url: string | null }

export interface ResearchBrief {
  generatedAt: string
  methodology: 'deterministic'
  verifiedFacts: string[]
  observations: string[]
  warnings: string[]
  events: DatedEvent[]
  headlines: SourcedHeadline[]
}

export interface SourceRecord {
  id: string
  label: string
  role: string
  provider: string
  retrievedAt: string
  freshness: DataFreshness
}

export interface PulseEvent {
  id: string
  timestamp: string
  type: 'quote' | 'news' | 'freshness' | 'event'
  title: string
  detail: string
  source: string
  status: 'confirmed' | 'attention' | 'stale'
}

export interface InstrumentPageData {
  instrument: Instrument
  quote: Quote
  candles: Candle[]
  candleInterval: string
  research: ResearchBrief
  sources: SourceRecord[]
  pulse: PulseEvent[]
  freshness: DataFreshness
}

export type InstrumentLoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: InstrumentPageData }
  | { status: 'stale'; data: InstrumentPageData }
  | { status: 'unavailable'; message: string; lastChecked: string; instrument?: Instrument }

export interface DashboardItem {
  instrument: Instrument
  snapshot: { quote: Quote; freshness: DataFreshness; cacheStatus: string } | null
  status: string
  message: string | null
}

export interface DashboardResponse { generatedAt: string; items: DashboardItem[] }

export interface NewsItem {
  id: string
  title: string
  source: string
  url: string
  publishedAt: string
  summary: string
  assetClasses: AssetClass[]
  symbols: string[]
}

export interface NewsResponse { generatedAt: string; items: NewsItem[] }

export interface MarketEvent {
  id: string
  title: string
  eventType: string
  timestamp: string
  status: string
  source: string
  url: string | null
  symbols: string[]
}

export interface EventsResponse { generatedAt: string; items: MarketEvent[] }

export type ProviderHealthState =
  | 'healthy' | 'degraded' | 'rate_limited' | 'blocked' | 'misconfigured' | 'offline'

export interface ProviderStatus {
  provider: string
  status: string
  detail: string
  healthState: ProviderHealthState
  lastSuccess: string | null
  lastError: string | null
  nextRetryTime: string | null
  cachedCoverage: number
}

export interface ProviderRunResult {
  provider: string
  healthState: ProviderHealthState
  startedAt: string
  finishedAt: string
  recordsReceived: number
  recordsWritten: number
  cacheUsed: number
  error: string | null
}

export interface RefreshRun {
  id: string
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'success' | 'partial' | 'failed'
  trigger: string
  providers: ProviderRunResult[]
  recordCounts: Record<string, number>
  errors: string[]
  exportPaths: Record<string, string>
}

export interface ResearchAlert {
  id: string
  priority: number
  kind: string
  title: string
  observation: string
  rule: string
  supportingValues: Record<string, unknown>
  timestamp: string
  source: string
  instrumentId: string | null
  symbol: string | null
}

export interface TodayResearchResponse {
  generatedAt: string
  run: RefreshRun | null
  alerts: ResearchAlert[]
  dashboard: DashboardResponse
  news: NewsItem[]
  events: MarketEvent[]
  providerProblems: ProviderStatus[]
}

export interface ImportRowError { row: number; field: string; message: string }
export interface ImportPreview {
  token: string | null
  valid: boolean
  format: string
  totalRows: number
  typeCounts: Record<string, number>
  duplicateRows: number
  errors: ImportRowError[]
  expiresAt: string | null
}
export interface ImportCommitResponse {
  token: string
  committedAt: string
  typeCounts: Record<string, number>
  skippedExisting: number
}
