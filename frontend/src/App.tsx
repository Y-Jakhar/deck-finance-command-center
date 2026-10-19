import { useCallback, useEffect, useState } from 'react'
import { PortfolioLab } from './pages/PortfolioLab'
import { CommandCenter } from './pages/CommandCenter'
import { AppFrame } from './components/AppFrame'
import { DashboardPage } from './pages/DashboardPage'
import { InstrumentView } from './pages/InstrumentPage'
import { Watchlists } from './pages/Watchlists'
import { ResearchDesk } from './pages/ResearchDesk'
import { TodayPage } from './pages/TodayPage'
import { getBtcUsdInstrument, getInstrumentPage } from './services/instrumentService'
import type { InstrumentLoadState } from './types/market'
import { Copilot } from './components/Copilot'
import { publishCopilotSelection } from './components/copilotContext'

function InstrumentRoute({ id, onNavigate }: { id: string; onNavigate:(path:string)=>void }) {
  const [state, setState] = useState<InstrumentLoadState>({ status: 'loading' })
  useEffect(() => {
    let active = true; setState({ status: 'loading' })
    const request = id === 'btc-usd' ? getBtcUsdInstrument() : getInstrumentPage(decodeURIComponent(id))
    request.then((result) => { if (active) setState(result) })
    return () => { active = false }
  }, [id])
  const instrument = state.status === 'ready' || state.status === 'stale' ? state.data.instrument : state.status === 'unavailable' ? state.instrument : undefined
  useEffect(()=>{publishCopilotSelection({workspace:'market',symbol:instrument?.displaySymbol||''})},[instrument?.displaySymbol])
  return <><nav className="workspace-tools">{['/market/company','/banking','/quant','/portfolio'].map((path,i)=><a key={path} href={path} aria-disabled={!instrument} onClick={e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();if(instrument){localStorage.setItem('researchdesk.symbol',instrument.displaySymbol);onNavigate(path)}}}>{['Company research','Open in Valuation','Analyze in Quant Lab','Portfolio & Risk'][i]}</a>)}</nav><InstrumentView state={state} /></>
}

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  const navigate = useCallback((next: string) => { window.history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0) }, [])
  useEffect(() => {
    if (!['/banking','/quant','/journal','/portfolio','/market/company','/market/history'].includes(path) && !path.startsWith('/research/')) {
      publishCopilotSelection({ workspace: path, symbol: localStorage.getItem('researchdesk.symbol') || '' })
    }
  }, [path])
  useEffect(() => { const pop = () => setPath(window.location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [])
  useEffect(() => { document.title = 'ResearchDesk · ' + (path === '/' ? 'Finance Command Center' : path.split('/').at(-1) || 'Research') }, [path])
  const instrumentMatch = path.match(/^\/instrument\/(.+)$/)
  const researchMatch = path.match(/^\/research\/(company|valuation|strategy|journal|settings)$/)
  const section = researchMatch?.[1] || ({ '/market/company':'company', '/market/history':'prices', '/banking':'valuation', '/quant':'strategy', '/journal':'journal', '/settings':'settings' } as Record<string,string>)[path]
  const page = path === '/portfolio' ? <PortfolioLab onNavigate={navigate} /> : path === '/' ? <CommandCenter onNavigate={navigate} /> : section ? <ResearchDesk section={section} onNavigate={navigate} /> : instrumentMatch
    ? <InstrumentRoute id={instrumentMatch[1]} onNavigate={navigate} />
    : (path === '/dashboard' || path === '/market')
      ? <><DashboardPage onNavigate={navigate} /><Watchlists onNavigate={navigate} /></>
      : <TodayPage onNavigate={navigate} />
  return <><AppFrame onNavigate={navigate}>{page}</AppFrame><Copilot path={path}/></>
}
