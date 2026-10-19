import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchDesk } from './ResearchDesk'

describe('connected research workflow', () => {
  it('ignores blank CSV lines instead of doubling observations and showing NaN prices', async()=>{
    const user=userEvent.setup()
    const csv='timestamp,open,high,low,close,volume\r\n\r\n'+Array.from({length:20},(_,i)=>`2025-01-${String(i+1).padStart(2,'0')}T00:00:00Z,100,101,99,100,100`).join('\r\n\r\n')
    const d={id:'d',symbol:'AAPL',csv_text:csv,source:'Engineering fixture only',currency:'USD',exchange:'TEST',frequency:'1d',adjustment_policy:'Fixture',timestamp_policy:'UTC',availability:'Test fixture',identity:{issues:[]}}
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/technicals?')?{definition:'Engineering fixture',observations:[]}:url.includes('/datasets')?[d]:[]})))
    render(<ResearchDesk section="prices" onNavigate={vi.fn()}/>);
    await screen.findByRole('option',{name:/Engineering fixture/})
    await user.selectOptions(screen.getByRole('combobox',{name:/Saved datasets/}),'d')
    expect(screen.getByText(/AAPL historical close · 20 observations/)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => []})))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows missing source data and blocks an incomplete valuation', async () => {
    render(<ResearchDesk section="company" onNavigate={vi.fn()} />)
    expect(await screen.findByText(/No statements imported/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Calculate & save case'})).toBeDisabled()
    expect(screen.getByLabelText('Research instrument')).toHaveValue('AAPL')
  })

  it('creates a journal entry with selected saved evidence references', async () => {
    const user = userEvent.setup()
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : null
      const data = url.endsWith('/valuations?symbol=AAPL') ? [{id:'valuation-1',case:'base',created_at:'2026-10-11',symbol:'AAPL'}]
        : url.endsWith('/experiments?symbol=AAPL') ? [{id:'experiment-1',symbol:'AAPL',summary:{run_id:'run-1'}}]
        : options?.method === 'POST' ? {...body,id:'entry-1',version:1,created_at:'2026-10-11',updated_at:'2026-10-11'} : []
      return {ok:true,json:async()=>data}
    })
    vi.stubGlobal('fetch',fetcher)
    render(<ResearchDesk section="journal" onNavigate={vi.fn()} />)
    await screen.findByRole('option',{name:/base/})
    await user.type(screen.getByLabelText('Title'),'AAPL research')
    await user.type(screen.getByLabelText('thesis'),'A testable thesis')
    await user.selectOptions(screen.getByLabelText('Saved valuation'),'valuation-1')
    await user.selectOptions(screen.getByLabelText('Saved strategy experiment'),'experiment-1')
    await user.click(screen.getByRole('button',{name:'Save research revision'}))
    expect(await screen.findByText('Research saved; earlier revisions retained')).toBeInTheDocument()
    const call=fetcher.mock.calls.find(([,options])=>options?.method==='POST')
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({symbol:'AAPL',valuation_id:'valuation-1',experiment_id:'experiment-1',thesis:'A testable thesis'})
  })

  it('shows validation errors without reporting a saved result', async () => {
    const user=userEvent.setup()
    vi.stubGlobal('fetch',vi.fn(async (url: string)=>({ok:!url.includes('/company/'),json:async()=>url.includes('/company/')?{detail:'Set SEC_USER_AGENT before SEC prefill'}:[]})))
    render(<ResearchDesk section="company" onNavigate={vi.fn()} />)
    await user.click(screen.getByRole('button',{name:'Fetch SEC draft'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Set SEC_USER_AGENT')
    expect(screen.queryByText('Saved valuation')).not.toBeInTheDocument()
  })
})
