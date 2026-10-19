import { useState } from 'react'
import { MarketHistory } from '../components/MarketHistory'
import { MarketPulseRail } from '../components/MarketPulseRail'
import { ResearchTabs } from '../components/ResearchTabs'
import { StatusBadge } from '../components/StatusBadge'
import { addToWatchlist } from '../services/instrumentService'
import type { AssetClass, InstrumentLoadState } from '../types/market'

const glyphs: Record<AssetClass, string> = { equity: 'E', etf: 'F', fund: 'F', index: 'I', bond: 'B', fx: 'X', crypto: '₿', commodity: 'C', future: 'ƒ', option: 'O', macro: 'M' }
const dateTime = (timestamp: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(timestamp)) + ' UTC'
const money = (value: number, currency: string) => currency === 'PCT' ? `${value.toFixed(3)}%` : new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: value < 10 ? 4 : 2, maximumFractionDigits: value < 10 ? 4 : 2 }).format(value)

function LoadingState() { return <main id="main-content" className="state-page" aria-busy="true" aria-live="polite"><div className="state-mark" aria-hidden="true">···</div><p className="eyebrow">Resolving instrument</p><h1>Assembling the research ledger</h1><p>Checking quote, candles, freshness, events, and source records.</p></main> }

function UnavailableState({ state }: { state: Extract<InstrumentLoadState, { status: 'unavailable' }> }) {
  const symbol = state.instrument?.displaySymbol ?? 'Instrument'
  return <main id="main-content" className={`state-page${state.instrument ? ' state-page--history' : ''}`}><div className="state-mark state-mark--error" aria-hidden="true">×</div><div role="alert"><p className="eyebrow">Current quote unavailable</p><h1>{symbol} could not be assembled</h1><p>{state.message}</p></div><dl className="state-meta"><dt>Last checked</dt><dd>{dateTime(state.lastChecked)}</dd></dl><p className="state-direction">The instrument remains registered. Check provider credentials, cached data, or use a local CSV/JSON import.</p>{state.instrument && <MarketHistory instrument={state.instrument} />}</main>
}

export function InstrumentView({ state }: { state: InstrumentLoadState }) {
  const [watchlistMessage, setWatchlistMessage] = useState('')
  if (state.status === 'loading') return <LoadingState />
  if (state.status === 'unavailable') return <UnavailableState state={state} />
  const { data } = state; const { instrument, quote } = data
  const isStale = state.status === 'stale' || data.freshness.state === 'stale'; const positive = quote.absoluteChange >= 0
  const qualityLabel = quote.quality === 'demo' ? 'Demo data' : quote.quality.replaceAll('_', ' ')
  const seriesHigh = data.candles.length ? Math.max(...data.candles.map((candle) => candle.high)) : null
  const seriesLow = data.candles.length ? Math.min(...data.candles.map((candle) => candle.low)) : null
  return <main id="main-content" className="instrument-page">
    {isStale && <div className="stale-banner" role="status"><strong>! Stale data</strong><span>{data.freshness.label}. Last market timestamp: {dateTime(quote.marketTimestamp)}.</span></div>}
    <div className="instrument-layout">
      <div className="instrument-primary">
        <section className="instrument-hero" aria-labelledby="instrument-title">
          <div className="instrument-identity page-enter page-enter--1"><div className="instrument-identity__label"><span className="asset-glyph asset-glyph--dynamic" aria-hidden="true">{glyphs[instrument.assetClass]}</span><div><p className="eyebrow">Canonical instrument / {instrument.assetClass}</p><h1 id="instrument-title">{instrument.displaySymbol}</h1><p className="instrument-name">{instrument.name}</p></div></div><div><div className="identity-tags"><span>{instrument.assetClass}</span><span><i className="market-dot" aria-hidden="true" /> {instrument.marketHoursLabel}</span><span>Quote · {instrument.quoteCurrency}</span><span>Timezone · {instrument.timezone}</span></div><button className="watchlist-button" type="button" onClick={async () => { try { await addToWatchlist(instrument.id); setWatchlistMessage('Added to watchlist') } catch (error) { setWatchlistMessage(error instanceof Error ? error.message : 'Could not update watchlist') } }}>+ Watchlist</button>{watchlistMessage && <span className="watchlist-message" role="status">{watchlistMessage}</span>}</div></div>
          <div className="quote-row page-enter page-enter--2"><div className="quote-main"><span className="eyebrow">Reference price · {quote.currency}</span><div className="quote-main__value">{money(quote.price, quote.currency)}</div><div className={`quote-change ${positive ? 'quote-change--up' : 'quote-change--down'}`}><span aria-hidden="true">{positive ? '↑' : '↓'}</span><strong>{positive ? '+' : '-'}{money(Math.abs(quote.absoluteChange), quote.currency)}</strong><span>({positive ? '+' : ''}{quote.percentageChange.toFixed(2)}%)</span><small>from provider previous close</small></div></div><dl className="quote-proof"><div><dt>Source</dt><dd>{quote.source}</dd></div><div><dt>Market time</dt><dd>{dateTime(quote.marketTimestamp)}</dd></div><div><dt>Received</dt><dd>{dateTime(quote.receivedTimestamp)}</dd></div><div><dt>Quality</dt><dd><StatusBadge freshness={data.freshness} /></dd></div></dl></div>
          <MarketHistory instrument={instrument} initial={data} />
        </section>
        <div className="page-enter page-enter--4"><ResearchTabs data={data} /><MarketPulseRail events={data.pulse} /></div>
        <aside className="disclaimer" role="note"><span aria-hidden="true">i</span><p><strong>Research context only.</strong> {qualityLabel}. Verify source records before acting.</p></aside>
      </div>
      <aside className="instrument-side-panel" aria-label="Market and source status">
        <section><h2>Market &amp; source status</h2><dl><div><dt>Asset class</dt><dd>{instrument.assetClass}</dd></div><div><dt>Quote currency</dt><dd>{quote.currency}</dd></div><div><dt>Market hours</dt><dd>{instrument.marketHoursLabel}</dd></div><div><dt>Quality</dt><dd>{qualityLabel}</dd></div></dl></section>
        <section><h2>Loaded provider series</h2><dl><div><dt>Series high</dt><dd>{seriesHigh === null ? 'Unavailable' : money(seriesHigh, quote.currency)}</dd></div><div><dt>Series low</dt><dd>{seriesLow === null ? 'Unavailable' : money(seriesLow, quote.currency)}</dd></div><div><dt>Previous close</dt><dd>{money(quote.previousClose, quote.currency)}</dd></div><div><dt>Delay</dt><dd>{quote.delaySeconds === null ? 'Not supplied' : `${quote.delaySeconds}s`}</dd></div></dl></section>
        <section><h2>Source health</h2><ol className="instrument-source-list">{data.sources.map((source) => <li key={source.id}><div><strong>{source.provider}</strong><span>{source.freshness.label}</span></div><small>{source.role}</small></li>)}</ol></section>
        <section><h2>Recent normalized records</h2><table className="recent-records"><thead><tr><th>Time</th><th>Close</th><th>Source</th></tr></thead><tbody>{data.candles.slice(-6).reverse().map((candle) => <tr key={candle.timestamp}><td>{new Date(candle.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}</td><td>{money(candle.close, quote.currency)}</td><td>{candle.source}</td></tr>)}</tbody></table></section>
      </aside>
    </div>
  </main>
}
