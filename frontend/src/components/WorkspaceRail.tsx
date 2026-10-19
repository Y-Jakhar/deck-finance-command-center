import { useEffect, useState } from 'react'
import { getDashboard } from '../services/instrumentService'
import type { DashboardResponse } from '../types/market'

const formatPrice = (value: number, currency: string) => currency === 'PCT'
  ? `${value.toFixed(3)}%`
  : new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value)

export function WorkspaceRail({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    getDashboard().then(
      (data) => { if (active) setDashboard(data) },
      () => { if (active) setError(true) },
    )
    return () => { active = false }
  }, [])

  return (
    <aside className="workspace-rail" aria-label="Research universe">
      <div className="workspace-rail__heading">
        <div><span className="eyebrow">Registered instruments</span><h2>Research universe</h2></div>
        <span aria-hidden="true">•••</span>
      </div>
      <div className="workspace-rail__columns" aria-hidden="true"><span>Instrument</span><span>Last</span><span>Change</span></div>
      <div className="workspace-rail__items">
        {!dashboard && !error && <p className="workspace-rail__state" role="status">Loading local universe…</p>}
        {error && <p className="workspace-rail__state workspace-rail__state--error" role="status">Universe unavailable</p>}
        {dashboard?.items.map((item) => {
          const quote = item.snapshot?.quote
          const activeInstrument = window.location.pathname.includes(item.instrument.id)
            || (window.location.pathname.endsWith('/btc-usd') && item.instrument.displaySymbol === 'BTC / USD')
          return (
            <button
              className={activeInstrument ? 'workspace-instrument workspace-instrument--active' : 'workspace-instrument'}
              key={item.instrument.id}
              type="button"
              onClick={() => onNavigate(`/instrument/${encodeURIComponent(item.instrument.id)}`)}
            >
              <span className="workspace-instrument__name"><strong>{item.instrument.displaySymbol}</strong><small title={item.instrument.name}>{item.instrument.name}</small></span>
              <span className="workspace-instrument__price">{quote ? formatPrice(quote.price, quote.currency) : '—'}</span>
              <span className={quote ? (quote.absoluteChange >= 0 ? 'workspace-instrument__change positive' : 'workspace-instrument__change negative') : 'workspace-instrument__change workspace-instrument__change--missing'}>
                {quote ? `${quote.percentageChange >= 0 ? '+' : ''}${quote.percentageChange.toFixed(2)}%` : item.status}
              </span>
            </button>
          )
        })}
      </div>
      <div className="workspace-rail__foot"><span className="market-dot" aria-hidden="true" /> {error ? 'Local API unavailable' : dashboard ? 'Registered universe loaded' : 'Checking local universe'}</div>
    </aside>
  )
}
