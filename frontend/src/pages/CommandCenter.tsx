import { useEffect, useState } from 'react'
import { workspaces } from '../workspaces'
import { deskApi } from './deskUtils'
import './command-center.css'

type RecordSummary = { id: string; title?: string; name?: string; symbol?: string; case?: string; created_at?: string; summary?: { run_id?: string } }
type OverviewState = { status: 'loading' | 'ready' | 'error'; valuations: RecordSummary[]; experiments: RecordSummary[]; journal: RecordSummary[]; message?: string }

const areas = [
  { path: '/banking', title: 'Valuation cases', description: 'Versioned research models', empty: 'No valuation cases yet', action: 'New valuation' },
  { path: '/quant', title: 'Strategy experiments', description: 'Validated datasets and tests', empty: 'No strategy experiments yet', action: 'New strategy' },
  { path: '/journal', title: 'Saved research', description: 'Theses and retained revisions', empty: 'No research notes yet', action: 'New entry' },
] as const

export function CommandCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [data, setData] = useState<OverviewState>({ status: 'loading', valuations: [], experiments: [], journal: [] })
  useEffect(() => {
    let live = true
    Promise.all([deskApi('/valuations'), deskApi('/experiments'), deskApi('/journal')])
      .then(([valuations, experiments, journal]) => { if (live) setData({ status: 'ready', valuations, experiments, journal }) })
      .catch(error => { if (live) setData({ status: 'error', valuations: [], experiments: [], journal: [], message: error instanceof Error ? error.message : 'Research records are unavailable' }) })
    return () => { live = false }
  }, [])
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(path) }
  return <main id="main-content" className="deck-overview">
    <header className="deck-page-heading"><div><p className="deck-kicker">Command center</p><h1>Deck</h1><p>Your financial research workspace.</p></div><button className="deck-action deck-action--primary" onClick={() => onNavigate('/banking')}>New valuation</button></header>
    <section className="deck-welcome"><div><h2>Start with a question. Keep the evidence.</h2><p>Move from market context to models, experiments, and a retained research record.</p></div><div className="deck-welcome__actions"><button onClick={() => onNavigate('/banking')}>Import financials</button><button onClick={() => onNavigate('/quant')}>New strategy</button><button onClick={() => onNavigate('/journal')}>Open journal</button></div></section>
    <section className="deck-section" aria-labelledby="research-overview"><div className="deck-section__head"><h2 id="research-overview">Research overview</h2><span>Saved local records</span></div>
      {data.status === 'error' && <div className="deck-notice" role="alert">Could not load research records: {data.message}. Check the local API and refresh.</div>}
      <div className="deck-summary-grid">{areas.map((area, index) => { const records = [data.valuations, data.experiments, data.journal][index]; return <article className="deck-summary" key={area.path}><div className="deck-summary__head"><h3>{area.title}</h3><p>{area.description}</p></div>{data.status === 'loading' ? <p className="deck-summary__empty" role="status">Loading saved records…</p> : data.status === 'error' ? <p className="deck-summary__empty">Records unavailable</p> : records.length ? <ul>{records.slice(0, 4).map(record => <li key={record.id}><a href={area.path} onClick={event => navigate(event, area.path)}><strong>{record.title || record.name || record.case || record.summary?.run_id || record.symbol || 'Saved record'}</strong><small>{record.symbol || record.created_at || 'Open workspace'}</small></a></li>)}</ul> : <div className="deck-summary__empty"><strong>{area.empty}</strong><p>{area.description} will appear here after you save them.</p><button onClick={() => onNavigate(area.path)}>{area.action}</button></div>}</article> })}</div>
    </section>
    <section className="deck-section" aria-labelledby="explore-workspaces"><div className="deck-section__head"><h2 id="explore-workspaces">Explore workspaces</h2><span>Four connected research disciplines</span></div><div className="deck-workspace-grid">{workspaces.map((area, index) => <a key={area.key} href={area.path} onClick={event => navigate(event, area.path)}><span className="deck-workspace-grid__icon" aria-hidden="true">{['⌁', '▥', '⌁', '◇'][index]}</span><span aria-hidden="true">↗</span><h3>{area.name.replace(' Lab', '')}</h3><p>{area.description}</p></a>)}</div></section>
    <section className="deck-section" aria-labelledby="provider-status"><div className="deck-section__head"><h2 id="provider-status">Provider status</h2><span>Availability is separate from data freshness</span></div><div className="deck-provider-note"><strong>Local research workspace</strong><p>Market quotes and optional engines show their own source and availability status inside each workspace. No trade execution is connected.</p><button onClick={() => onNavigate('/settings')}>View settings →</button></div></section>
  </main>
}
