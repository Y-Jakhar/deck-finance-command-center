import type { MouseEvent } from 'react'
import { workspaces } from '../workspaces'
import './researchdesk.css'
import './command-center.css'

const [market, ...labs] = workspaces

function followWorkspace(event: MouseEvent<HTMLAnchorElement>, path: string, onNavigate: (path: string) => void) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(path)
}

export function CommandCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <main id="main-content" className="command-home">
    <header className="command-heading">
      <p className="command-kicker">ResearchDesk <span aria-hidden="true">/</span> Research workspaces</p>
      <h1>Finance Command Center</h1>
      <p>Start with the market record, then carry your evidence into valuation, strategy, or portfolio analysis.</p>
    </header>

    <div className="command-layout">
      <div className="command-workflow">
        <section className="command-market" aria-labelledby="command-market-title">
          <div className="command-market__intro">
            <p className="command-step">01 <span aria-hidden="true">/</span> {market.tag} <span className="command-step__type">Market status and watchlists</span></p>
            <h2 id="command-market-title">{market.name}</h2>
            <p>{market.description}</p>
            <a className="command-primary-action" aria-label={`${market.tag} ${market.name}`} href={market.path} onClick={event => followWorkspace(event, market.path, onNavigate)}>Open Market Intelligence <span aria-hidden="true">→</span></a>
          </div>
          <nav className="command-market__routes" aria-label="Market research shortcuts">
            <p>Direct routes</p>
            <a href="/today" onClick={event => followWorkspace(event, '/today', onNavigate)}>Today's research <span aria-hidden="true">↗</span></a>
            <a href="/market" onClick={event => followWorkspace(event, '/market', onNavigate)}>Universe &amp; watchlists <span aria-hidden="true">↗</span></a>
            <a href="/market/history" onClick={event => followWorkspace(event, '/market/history', onNavigate)}>Historical snapshots <span aria-hidden="true">↗</span></a>
          </nav>
        </section>

        <nav className="command-trail" aria-label="Research trail">
          <a href="/market" onClick={event => followWorkspace(event, '/market', onNavigate)}><span>01</span><strong>Observe</strong><small>Market record</small></a>
          <a href="/banking" onClick={event => followWorkspace(event, '/banking', onNavigate)}><span>02</span><strong>Analyze</strong><small>Valuation case</small></a>
          <a href="/journal" onClick={event => followWorkspace(event, '/journal', onNavigate)}><span>03</span><strong>Record</strong><small>Research journal</small></a>
        </nav>

        <section className="command-labs" aria-labelledby="command-labs-title">
          <div className="command-section-heading"><span className="command-step">02 <span aria-hidden="true">/</span> ANALYZE</span><h2 id="command-labs-title">Continue the research</h2></div>
          <div className="command-labs__list">{labs.map((workspace, index) => <a
            key={workspace.key}
            className="command-lab"
            aria-label={`${workspace.tag} ${workspace.name}`}
            href={workspace.path}
            onClick={event => followWorkspace(event, workspace.path, onNavigate)}
          >
            <span className="command-lab__index">0{index + 2}</span>
            <span className="command-lab__body"><strong>{workspace.name}</strong><span>{workspace.description}</span><small>{workspace.features}</small></span>
            <span className="command-lab__tag">{workspace.tag}</span>
            <span className="command-lab__arrow" aria-hidden="true">↗</span>
          </a>)}</div>
        </section>
      </div>

      <aside className="command-side" aria-label="Research record">
        <section className="command-evidence">
          <span className="command-step">03 <span aria-hidden="true">/</span> RECORD</span>
          <h2>Shared research journal</h2>
          <p>Link valuations, experiments, and portfolio analyses to a dated research record. Earlier revisions remain available for review.</p>
          <button type="button" onClick={() => onNavigate('/journal')}>Open research journal <span aria-hidden="true">↗</span></button>
        </section>
        <section className="command-source-note">
          <h2>Source context</h2>
          <p>Historical observations and saved analyses retain their sources and dates. Provider availability is shown inside each workspace.</p>
        </section>
      </aside>
    </div>
  </main>
}
