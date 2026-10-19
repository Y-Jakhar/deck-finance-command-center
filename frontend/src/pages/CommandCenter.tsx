import { workspaces } from '../workspaces'
import './researchdesk.css'
import './command-center.css'

export function CommandCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <main id="main-content" className="command-home">
    <header className="command-heading"><p className="desk-eyebrow">RESEARCHDESK / LOCAL RESEARCH NODE</p><h1>Finance<br />Command Center</h1><p>One research record. Four ways to investigate it.</p></header>
    <div className="workspace-cards">{workspaces.map(w => <a key={w.key} className={'workspace-card workspace-card--' + w.key} href={w.path} onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); onNavigate(w.path) } }}><span className="desk-eyebrow">{w.tag}</span><h2>{w.name}</h2><p>{w.description}</p><small>{w.features}</small><strong>Open workspace <span aria-hidden="true">↗</span></strong></a>)}</div>
    <section className="command-ledger"><div><h2>Shared research journal</h2><p>Link valuations, experiments and portfolio analyses. Keep the original thesis through every review.</p></div><button onClick={() => onNavigate('/journal')}>Open research journal</button></section>
    <p className="command-foot">Historical observations and saved analyses retain their sources and dates. Provider availability is shown inside each workspace.</p>
  </main>
}
