import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { ResearchDesk } from './ResearchDesk'
import { PortfolioLab } from './PortfolioLab'

vi.mock('../services/instrumentService',()=>({getDashboard:vi.fn(async()=>({items:[]})),getNews:vi.fn(async()=>{throw new Error('Market integration unavailable')}),getEvents:vi.fn(async()=>{throw new Error('Market integration unavailable')}),searchInstruments:vi.fn(async()=>[]),getCandleSeries:vi.fn(async()=>{throw new Error('Provider blocked')}),getInstrumentPage:vi.fn(async()=>({status:'unavailable',message:'Provider blocked',lastChecked:'2026-10-11',instrument:{id:'apple',displaySymbol:'AAPL',name:'Apple Inc.'}}))}))
beforeEach(()=>{window.history.replaceState({},'','/');localStorage.clear();vi.stubGlobal('scrollTo',vi.fn());vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:!url.includes('/volatility/'),json:async()=>url.includes('/api/v1/search')?{items:[]}:url.includes('/volatility/')?{detail:'Snapshot unavailable'}:[]})))})
afterEach(()=>vi.unstubAllGlobals())

describe('Command Center',()=>{
  it('keeps Markets mounted when the optional market API returns 503',async()=>{
    window.history.replaceState({},'','/market')
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:!url.includes('/api/v1/search'),json:async()=>url.includes('/api/v1/search')?{detail:'Market integration unavailable'}:[]})))
    render(<App />)
    expect(await screen.findByRole('heading',{name:'Research watchlists'})).toBeInTheDocument()
    expect(await screen.findByText('Market instrument universe unavailable')).toBeInTheDocument()
  })
  it('carries the registered symbol to valuation even when market prices are unavailable',async()=>{
    window.history.replaceState({},'','/instrument/apple');localStorage.setItem('researchdesk.symbol','SPY')
    const user=userEvent.setup();render(<App />)
    await screen.findByRole('heading',{name:'AAPL could not be assembled'})
    await user.click(screen.getByRole('link',{name:'Open in Valuation'}))
    expect(window.location.pathname).toBe('/banking')
    expect(screen.getByLabelText('Research instrument')).toHaveValue('AAPL')
  })
  it('opens the four research workspaces and returns home with the switcher',async()=>{
    const user=userEvent.setup();render(<App />)
    for(const [path,label,heading] of [['/market','Market Intelligence','Market integration unavailable'],['/banking','Investment Banking','Valuation cases'],['/quant','Quant & Trading','Strategy Lab'],['/portfolio','Portfolio & Risk','Holdings, history & risk']] as const){
      await user.click(screen.getByRole('navigation',{name:'Primary navigation'}).querySelector(`a[href="${path}"]`)!)
      expect(window.location.pathname).toBe(path)
      expect(await screen.findByRole('heading',{name:heading})).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('Workspace switcher'),'')
      expect(screen.getByRole('heading',{name:'FCC'})).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button',{name:'Open journal'}))
    expect(screen.getByRole('heading',{name:'Research journal'})).toBeInTheDocument()
  })

  it('opens the existing Copilot from the shared launcher',async()=>{
    const user=userEvent.setup();render(<App />)
    await user.click(screen.getByRole('button',{name:'Open AI Research Copilot'}))
    expect(document.getElementById('ai-copilot')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Open AI Research Copilot'})).toHaveAttribute('aria-expanded','true')
  })

  it('attaches an existing portfolio while retaining valuation and experiment links',async()=>{
    const user=userEvent.setup()
    const fetcher=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='POST'?{...JSON.parse(String(options.body)),id:'j',version:1}:
      url.includes('/portfolios?')?[{id:'p',name:'Saved portfolio'}]:url.includes('/valuations?')?[{id:'v',case:'base',created_at:'today'}]:url.includes('/experiments?')?[{id:'e',summary:{run_id:'run'}}]:[]}))
    vi.stubGlobal('fetch',fetcher);render(<ResearchDesk section="journal" onNavigate={vi.fn()} />)
    await screen.findByRole('option',{name:'Saved portfolio'})
    await user.type(screen.getByLabelText('Title'),'Linked case');await user.type(screen.getByLabelText('thesis'),'Testable thesis')
    await user.selectOptions(screen.getByLabelText('Saved valuation'),'v');await user.selectOptions(screen.getByLabelText('Saved strategy experiment'),'e');await user.selectOptions(screen.getByLabelText('Saved portfolio analysis'),'p')
    await user.click(screen.getByRole('button',{name:'Save research revision'}))
    expect(await screen.findByText('Research saved; earlier revisions retained')).toBeInTheDocument()
    expect(JSON.parse(String(fetcher.mock.calls.find(([,o])=>o?.method==='POST')?.[1]?.body))).toMatchObject({valuation_id:'v',experiment_id:'e',portfolio_id:'p'})
  })

  it('shows portfolio calculation errors without inventing performance',async()=>{
    const user=userEvent.setup()
    vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>({ok:!options&&!url.includes('/volatility/'),json:async()=>options?{detail:'Initial weights must sum to 1'}:url.includes('/volatility/')?{detail:'Forecast unavailable'}:url.endsWith('/datasets')?[{id:'d',symbol:'AAPL',currency:'USD',frequency:'1d'}]:[]})))
    render(<PortfolioLab onNavigate={vi.fn()} />)
    await screen.findByRole('option',{name:'AAPL · USD · 1d · d'})
    await user.selectOptions(screen.getByLabelText('Holding 1 dataset'),'d')
    await user.type(screen.getByLabelText('Portfolio name'),'Test');await user.type(screen.getByLabelText('Allocation rationale and source limitations'),'Test only')
    await user.click(screen.getByRole('button',{name:'Calculate & save portfolio'}))
    expect(await screen.findByText('Initial weights must sum to 1')).toBeInTheDocument()
    expect(screen.queryByRole('img',{name:'Historical hypothetical portfolio equity'})).not.toBeInTheDocument()
  })
})

