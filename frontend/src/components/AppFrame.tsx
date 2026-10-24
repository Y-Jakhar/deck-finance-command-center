import { useState, type MouseEvent, type ReactNode } from 'react'
import { workspaceFor } from '../workspaces'
import { UniversalSearch } from './UniversalSearch'
import { WorkspaceRail } from './WorkspaceRail'

const destinations = [
  { path: '/', title: 'Overview', icon: '▦' },
  { path: '/market', title: 'Market Intelligence', icon: '⌁' },
  { path: '/banking', title: 'Investment Banking', icon: '▥' },
  { path: '/quant', title: 'Quant & Trading', icon: '⌁' },
  { path: '/portfolio', title: 'Portfolio & Risk', icon: '◇' },
  { path: '/journal', title: 'Research Journal', icon: '▤' },
  { path: '/settings', title: 'Settings', icon: '⚙' },
]

function follow(event: MouseEvent<HTMLAnchorElement>, path: string, onNavigate: (path: string) => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(path)
}

export function AppFrame({ children, onNavigate }: { children: ReactNode; onNavigate: (path: string) => void }) {
  const path = window.location.pathname
  const workspace = workspaceFor(path)
  const active = path === '/' ? '/' : workspace?.path || (path.startsWith('/research/journal') ? '/journal' : path.startsWith('/research/settings') ? '/settings' : path)
  const title = destinations.find(item => item.path === active)?.title || 'Research workspace'
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  return <div className={`app-shell deck-light${collapsed ? ' deck-light--collapsed' : ''}${menuOpen ? ' deck-light--menu-open' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="deck-sidebar" aria-label="Primary navigation">
      <a className="deck-brand" href="/" onClick={event => follow(event, '/', onNavigate)} aria-label="FCC overview"><span className="deck-brand__mark">F</span><span className="deck-brand__name">FCC<small>Finance Command Center</small></span></a>
      <div className="deck-sidebar__label">Workspace</div>
      <nav className="deck-nav" aria-label="Primary navigation">{destinations.map(item => <a key={item.path} href={item.path} title={item.title} aria-current={active === item.path ? 'page' : undefined} onClick={event => { follow(event, item.path, onNavigate); setMenuOpen(false) }}><span className="deck-nav__icon" aria-hidden="true">{item.icon}</span><span className="deck-nav__text">{item.title}</span></a>)}</nav>
      <div className="deck-sidebar__foot"><strong>Local research node</strong><span>Source-linked workspace</span></div>
    </aside>
    <div className="deck-main">
      <header className="deck-topbar">
        <button className="deck-menu-button" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        <button className="deck-collapse-button" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>☰</button>
        <div className="deck-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
        <select className="deck-workspace-switcher" aria-label="Workspace switcher" value={active === '/' ? '' : active} onChange={event => onNavigate(event.target.value || '/')}><option value="">Overview</option>{destinations.slice(1).map(item => <option key={item.path} value={item.path}>{item.title}</option>)}</select>
        <UniversalSearch onNavigate={onNavigate} />
        <div className="deck-source-status"><span aria-hidden="true" />Local research</div>
      </header>
      <nav className="deck-legacy-links" aria-label="Additional research views"><a href="/today" onClick={event => follow(event, '/today', onNavigate)}>Today</a><a href="/dashboard" onClick={event => follow(event, '/dashboard', onNavigate)}>Dashboard</a><a href="/market/history" onClick={event => follow(event, '/market/history', onNavigate)}>Historical prices</a><a href="/market/company" onClick={event => follow(event, '/market/company', onNavigate)}>Company research</a></nav>
      {active === '/market' && <WorkspaceRail onNavigate={onNavigate} />}
      <div className="page-stage">{children}</div>
    </div>
    {menuOpen && <button className="deck-menu-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <nav className="mobile-nav" aria-label="Mobile navigation">{destinations.slice(0, 5).map(item => <a key={item.path} href={item.path} className={active === item.path ? 'active' : ''} onClick={event => follow(event, item.path, onNavigate)}><span aria-hidden="true">{item.icon}</span><span>{item.title.split(' ')[0]}</span></a>)}</nav>
  </div>
}
