import { useCallback, useEffect, useState } from 'react'
import { exportUrl, getDashboard, getEvents, getNews, refreshNews, removeFromWatchlist } from '../services/instrumentService'
import type { DashboardResponse, EventsResponse, NewsResponse } from '../types/market'

interface DashboardState {
  dashboard?: DashboardResponse
  news?: NewsResponse
  events?: EventsResponse
  error?: string
}

const time = (value: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
}).format(new Date(value)) + ' UTC'

const money = (value: number, currency: string) => new Intl.NumberFormat('en-US', {
  style: currency === 'PCT' ? 'decimal' : 'currency', currency: currency === 'PCT' ? 'USD' : currency,
  maximumFractionDigits: value < 10 ? 4 : 2,
}).format(value) + (currency === 'PCT' ? '%' : '')

export function DashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [state, setState] = useState<DashboardState>({})
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    try {
      const [dashboard, news, events] = await Promise.all([getDashboard(), getNews(), getEvents()])
      setState({ dashboard, news, events })
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Terminal API unavailable' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (state.error) return (
    <main id="main-content" className="state-page" role="alert">
      <div className="state-mark state-mark--error" aria-hidden="true">×</div>
      <p className="eyebrow">Market data unavailable</p><h1>{state.error?.includes('Market integration unavailable') ? 'Market integration unavailable' : 'The local research API could not be reached'}</h1><p>{state.error}</p>
      <p className="state-direction">If ResearchDesk is running, configure the optional market integration to load provider-backed views.</p>
    </main>
  )
  if (!state.dashboard || !state.news || !state.events) return (
    <main id="main-content" className="state-page" aria-busy="true">
      <div className="state-mark" aria-hidden="true">···</div><p className="eyebrow">Loading universe</p><h1>Reconciling markets and sources</h1>
    </main>
  )

  const ready = state.dashboard.items.filter((item) => item.snapshot)
  const assetClasses = Array.from(new Set(state.dashboard.items.map((item) => item.instrument.assetClass)))
  return (
    <main id="main-content" className="dashboard-page">
      <section className="dashboard-intro page-enter page-enter--1">
        <div><p className="eyebrow">Universal multi-market ledger</p><h1>One research surface.<br />Every registered instrument.</h1></div>
        <p>Search by ticker, FIGI, macro series, or market. Every quote carries its provider, timestamp, quality, and fallback state.</p>
      </section>

      <section className="universe-strip page-enter page-enter--2" aria-label="Registered asset universe">
        {assetClasses.map((assetClass) => {
          const items = state.dashboard!.items.filter((item) => item.instrument.assetClass === assetClass)
          return <div key={assetClass}><span>{assetClass}</span><strong>{items.length}</strong><small>{items.some((item) => item.snapshot) ? 'provider or cache ready' : 'mapping registered'}</small></div>
        })}
      </section>

      <section id="watchlist" className="dashboard-section page-enter page-enter--3" aria-labelledby="watchlist-title">
        <div className="section-heading dashboard-heading">
          <div><p className="eyebrow">Watchlist / {ready.length} of {state.dashboard.items.length} quoted</p><h2 id="watchlist-title">Cross-asset monitor</h2></div>
          <div className="export-actions" aria-label="Export watchlist">
            <a href={exportUrl('csv')} download>Export CSV</a><a href={exportUrl('xlsx')} download>Export XLSX</a>
          </div>
        </div>
        {actionError && <p role="alert">{actionError}</p>}
        <div className="watchlist-ledger">
          {state.dashboard.items.map((item) => {
            const snapshot = item.snapshot
            return (
              <article className={`watchlist-row ${snapshot ? '' : 'watchlist-row--unavailable'}`} key={item.instrument.id}>
                <button className="instrument-link" type="button" onClick={() => onNavigate(`/instrument/${encodeURIComponent(item.instrument.id)}`)}>
                  <strong>{item.instrument.displaySymbol}</strong><span>{item.instrument.name}</span>
                </button>
                <span className="asset-pill">{item.instrument.assetClass}</span>
                {snapshot ? <>
                  <div className="ledger-price"><strong>{money(snapshot.quote.price, snapshot.quote.currency)}</strong><span className={snapshot.quote.absoluteChange >= 0 ? 'positive' : 'negative'}>{snapshot.quote.percentageChange >= 0 ? '+' : ''}{snapshot.quote.percentageChange.toFixed(2)}%</span></div>
                  <div className="ledger-source"><strong>{snapshot.quote.source}</strong><span>{snapshot.freshness.label}</span></div>
                </> : <div className="ledger-unavailable"><strong>Provider unavailable</strong><span>{item.message}</span></div>}
                <button className="row-action" type="button" aria-label={`Remove ${item.instrument.displaySymbol} from watchlist`} onClick={async () => { if (!window.confirm(`Remove ${item.instrument.displaySymbol} from the watchlist?`)) return; setActionError(''); try { await removeFromWatchlist(item.instrument.id); await load() } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not remove instrument') } }}>×</button>
              </article>
            )
          })}
        </div>
        <p className="manual-export-note">Google Sheets is an optional destination: download XLSX here and import it when a workbook handoff is useful.</p>
      </section>

      <div className="information-grid page-enter page-enter--4">
        <section id="news" className="dashboard-section" aria-labelledby="news-title">
          <div className="section-heading dashboard-heading"><div><p className="eyebrow">Local collection / source links preserved</p><h2 id="news-title">Sourced news</h2></div>
            <button type="button" className="refresh-button" disabled={refreshing} onClick={async () => { setRefreshing(true); setActionError(''); try { await refreshNews(); await load() } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not refresh sources') } finally { setRefreshing(false) } }}>{refreshing ? 'Refreshing…' : 'Refresh sources'}</button>
          </div>
          <ol className="news-ledger">{state.news.items.map((item) => <li key={item.id}><time dateTime={item.publishedAt}>{time(item.publishedAt)}</time><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><small>{item.source}{item.assetClasses.length ? ` · ${item.assetClasses.join(', ')}` : ''}</small></li>)}</ol>
        </section>
        <section id="events" className="dashboard-section" aria-labelledby="events-title">
          <div className="section-heading dashboard-heading"><div><p className="eyebrow">Economic + earnings ledger</p><h2 id="events-title">Dated events</h2></div></div>
          {state.events.items.length ? <ol className="event-ledger">{state.events.items.map((item) => <li key={item.id}><span className="asset-pill">{item.eventType}</span><div><strong>{item.title}</strong><time dateTime={item.timestamp}>{time(item.timestamp)} · {item.source}</time></div></li>)}</ol> : <div className="empty-ledger"><strong>No dated events collected yet</strong><p>Refresh local news sources to derive reported economic and earnings events.</p></div>}
        </section>
      </div>

      <aside className="disclaimer" role="note"><span aria-hidden="true">i</span><p><strong>Research context only.</strong> Provider failures stay visible; no unavailable market is silently replaced with fabricated data.</p></aside>
    </main>
  )
}
