import type { MouseEvent, ReactNode } from 'react'
import { workspaces, workspaceFor } from '../workspaces'
import '../pages/command-center.css'
import { UniversalSearch } from './UniversalSearch'
import { WorkspaceRail } from './WorkspaceRail'

type IconName = 'today' | 'universe' | 'watchlist' | 'news' | 'events'

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    today: <><rect x="4" y="5" width="16" height="15" /><path d="M8 3v4m8-4v4M4 9h16" /></>,
    universe: <path d="M4 20V11m5 9V4m6 16v-7m5 7V7" />,
    watchlist: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
    news: <><rect x="5" y="4" width="14" height="16" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    events: <><rect x="5" y="5" width="14" height="15" /><path d="M8 3v4m8-4v4M8 11h3m2 0h3m-8 4h3m2 0h3" /></>,
  }
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string, onNavigate: (path: string) => void) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(path)
}

export function AppFrame({ children, onNavigate }: { children: ReactNode; onNavigate: (path: string) => void }) {
  const path = window.location.pathname
  const workspace = workspaceFor(path)
  const links = [['/', 'Home'], ...workspaces.map(w => [w.path,w.name]), ['/journal','Research journal'], ['/settings','Settings']]
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to terminal content</a>
      <a className="wordmark" href="/" onClick={(event) => navigate(event, '/', onNavigate)} aria-label="Finance Command Center home">
        <span className="wordmark__mark" aria-hidden="true">R<span>D</span></span>
        <span>ResearchDesk</span>
      </a>
      <header className="topbar">
        <UniversalSearch onNavigate={onNavigate} />
        <div className="provider-status" aria-label="Terminal mode">
          <span>Local research node</span><strong>Source-linked · No trade execution</strong><i className="market-dot" aria-hidden="true" />
        </div>
      </header>
      <nav className="primary-rail" aria-label="Primary navigation">
        {links.map(([url,title]) => <a key={url} aria-label={title} title={title} aria-current={path === url || workspace?.path === url ? 'page' : undefined} className={path === url || workspace?.path === url ? 'active' : ''} href={url} onClick={event=>navigate(event,url,onNavigate)}><NavIcon name={url==='/'?'today':url==='/journal'?'news':url==='/settings'?'events':url==='/portfolio'?'watchlist':'universe'}/><span>{title}</span></a>)}
        <div className="primary-rail__status"><span className="market-dot" aria-hidden="true" /><strong>Local API</strong><small>Research mode</small></div>
      </nav>
      <WorkspaceRail onNavigate={onNavigate} />
      <div className="page-stage"><nav className="command-breadcrumb" aria-label="Breadcrumb"><a href="/" onClick={e=>navigate(e,'/',onNavigate)}>Home</a><span aria-hidden="true">/</span><span>{workspace?.name || (path.includes('journal') ? 'Research journal' : path.includes('settings') ? 'Shared settings' : 'Command Center')}</span><select aria-label="Workspace switcher" value={workspace?.path || ''} onChange={e=>onNavigate(e.target.value || '/')}><option value="">Command Center</option>{workspaces.map(w=><option key={w.key} value={w.path}>{w.name}</option>)}</select></nav>{workspace?.key==='market'&&<nav className="workspace-tools" aria-label="Market workspace"><a href="/today" onClick={e=>navigate(e,'/today',onNavigate)}>Today</a><a href="/market" onClick={e=>navigate(e,'/market',onNavigate)}>Universe & watchlists</a><a href="/market/history" onClick={e=>navigate(e,'/market/history',onNavigate)}>Historical snapshots</a><a href="/market/company" onClick={e=>navigate(e,'/market/company',onNavigate)}>Company research</a></nav>}{children}</div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[['/','Home'],['/market','Markets'],['/banking','Banking'],['/quant','Quant'],['/portfolio','Risk']].map(([url,title])=><a key={url} className={path===url||workspace?.path===url?'active':''} href={url} onClick={e=>navigate(e,url,onNavigate)}><NavIcon name="universe"/><span>{title}</span></a>)}
      </nav>
    </div>
  )
}
