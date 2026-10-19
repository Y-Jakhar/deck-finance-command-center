import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Copilot } from './Copilot'
import { CopilotMarkdown } from './CopilotMarkdown'
import { publishCopilotSelection } from './copilotContext'

let bodies: Array<Record<string, unknown>> = []
let chatEvents: unknown[]
let cancelled=false
let keepOpen=false

beforeEach(()=>{
  localStorage.clear();bodies=[];cancelled=false;keepOpen=false
  chatEvents=[{type:'meta',provider:'openrouter',model:'fixture/model',context_attached:false,tools_enabled:false,estimated_ceiling_usd:.005},{type:'delta',text:'**Synthetic answer** with uncertainty.'},{type:'done',usage:[{completion_tokens:9}],actual_cost_usd:.001,finish:'stop',accounting:'Actual reported cost'}]
  publishCopilotSelection({workspace:'/banking',symbol:'TEST',valuation_id:'v1',experiment_id:'e1'})
  Element.prototype.scrollIntoView=vi.fn()
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})))
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):null
    if(url.endsWith('/chat')){
      bodies.push(body)
      const stream=new ReadableStream({start(controller){
        const text=chatEvents.map(e=>JSON.stringify(e)+'\n').join('')
        controller.enqueue(new TextEncoder().encode(text.slice(0,70)))
        controller.enqueue(new TextEncoder().encode(text.slice(70)))
        if(!keepOpen)controller.close()
        init?.signal?.addEventListener('abort',()=>{cancelled=true;controller.error(new DOMException('Cancelled','AbortError'))})
      }})
      return {ok:true,body:stream}
    }
    const data=url.endsWith('/settings')?{configured:{openrouter:true},max_output_tokens:4096,requests_per_day:100,daily_usd:1}:
      url.includes('/models')?{models:[{id:'fixture/model',name:'Fixture Model',tools:true,pricing:{prompt:'.0000001'}}]}:
      url.endsWith('/cases')?{cases:[{id:'a',symbol:'ASML',title:'ASML frozen V1',version:3},{id:'m',symbol:'MSFT',title:'Microsoft completed',version:6}]}:
      url.endsWith('/test')?{ok:false,message:'Invalid configured key.'}:
      url.endsWith('/context')?{historical_only:true,records:{}}:{}
    return {ok:true,json:async()=>data}
  }))
})
afterEach(()=>vi.unstubAllGlobals())

async function openAndSelect(){
  const user=userEvent.setup()
  await user.click(screen.getByRole('button',{name:'Open AI Research Copilot'}))
  await user.type(screen.getByRole('combobox',{name:'Model'}),'fixture/model')
  return user
}

describe('AI Research Copilot',()=>{
  it('streams, copies, persists across navigation and opens/closes all workspaces',async()=>{
    const view=render(<Copilot path="/banking"/>),user=await openAndSelect()
    await user.type(screen.getByLabelText('Message to Copilot'),'Explain valuation uncertainty')
    await user.click(screen.getByRole('button',{name:'Send message'}))
    expect(await screen.findByText('Synthetic answer')).toBeInTheDocument()
    await waitFor(()=>expect(screen.getByRole('button',{name:'Send message'})).toBeInTheDocument())
    expect(bodies[0].use_context).toBe(false);expect(bodies[0].selection).toBeNull()
    expect(localStorage.getItem('researchdesk.ai.chat')).toBeNull()
    for(const path of ['/market','/quant','/portfolio','/banking']){
      view.rerender(<Copilot path={path}/>)
      expect(screen.getByText('Synthetic answer')).toBeInTheDocument()
      await user.click(screen.getByRole('button',{name:'Close AI Research Copilot'}))
      expect(screen.queryByRole('complementary',{name:'AI Research Copilot'})).not.toBeInTheDocument()
      await user.click(screen.getByRole('button',{name:'Open AI Research Copilot'}))
    }
    await user.click(screen.getByRole('button',{name:'Copy response'}))
    expect(await screen.findByText('Response copied')).toBeInTheDocument()
    const separator=screen.getByRole('separator')
    separator.focus();await user.keyboard('{ArrowLeft}')
    expect(separator).toHaveAttribute('aria-valuenow','440')
  })

  it('attaches two cases, then excludes contextual history when sharing is disabled',async()=>{
    render(<Copilot path="/banking"/>);const user=await openAndSelect()
    await user.click(screen.getByRole('checkbox',{name:'Use Current Workspace Context'}))
    await screen.findByRole('option',{name:/ASML frozen/})
    await user.selectOptions(screen.getByLabelText('Attached comparison cases'),['a','m'])
    await user.type(screen.getByLabelText('Message to Copilot'),'Compare these decisions')
    chatEvents=[{type:'delta',text:'PRIVATE_CONTEXT_ANSWER'},{type:'done',usage:[],actual_cost_usd:0,accounting:'Actual'}]
    await user.click(screen.getByRole('button',{name:'Send message'}))
    await screen.findByText('PRIVATE_CONTEXT_ANSWER')
    await waitFor(()=>expect(screen.getByRole('button',{name:'Send message'})).toBeInTheDocument())
    expect(bodies[0].selection).toMatchObject({journal_ids:['a','m'],valuation_id:'v1'})
    await user.click(screen.getByRole('checkbox',{name:'Use Current Workspace Context'}))
    await user.type(screen.getByLabelText('Message to Copilot'),'General question')
    await user.click(screen.getByRole('button',{name:'Send message'}))
    await waitFor(()=>expect(bodies).toHaveLength(2))
    expect(JSON.stringify(bodies[1])).not.toContain('PRIVATE_CONTEXT_ANSWER')
    expect(JSON.stringify(bodies[1])).not.toContain('Compare these decisions')
    expect(bodies[1].selection).toBeNull()
  })

  it('cancels generation, labels partial output and prevents cancelled turns from reuse',async()=>{
    render(<Copilot path="/quant"/>);const user=await openAndSelect()
    keepOpen=true;chatEvents=[{type:'delta',text:'Partial fixture answer'}]
    await user.type(screen.getByLabelText('Message to Copilot'),'Long response')
    await user.click(screen.getByRole('button',{name:'Send message'}))
    await screen.findByText('Partial fixture answer')
    await user.click(screen.getByRole('button',{name:'Stop generation'}))
    expect(cancelled).toBe(true)
    expect(screen.getByText('Incomplete response')).toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'Clear chat'}))
    expect(screen.queryByText('Partial fixture answer')).not.toBeInTheDocument()
  })

  it('restarts with history only after explicit persistence and removes the saved copy when disabled',async()=>{
    const view=render(<Copilot path="/journal"/>),user=await openAndSelect()
    await user.click(screen.getByRole('button',{name:'AI Settings'}))
    await user.click(screen.getByRole('checkbox',{name:'Save chat history on this browser'}))
    await user.type(screen.getByLabelText('Message to Copilot'),'Remember this question')
    await user.click(screen.getByRole('button',{name:'Send message'}))
    await screen.findByText('Synthetic answer')
    view.unmount();render(<Copilot path="/portfolio"/>)
    await user.click(screen.getByRole('button',{name:'Open AI Research Copilot'}))
    expect(screen.getByText('Remember this question')).toBeInTheDocument()
    expect(screen.getByRole('checkbox',{name:'Use Current Workspace Context'})).not.toBeChecked()
    await user.click(screen.getByRole('button',{name:'AI Settings'}))
    await user.click(screen.getByRole('checkbox',{name:'Save chat history on this browser'}))
    expect(localStorage.getItem('researchdesk.ai.chat')).toBeNull()
  })

  it('handles provider changes, non-stream preference and failed connection truthfully',async()=>{
    render(<Copilot path="/market"/>);const user=await openAndSelect()
    await user.click(screen.getByRole('button',{name:'AI Settings'}))
    await user.click(screen.getByRole('checkbox',{name:'Stream responses'}))
    await user.selectOptions(screen.getByRole('combobox',{name:'Provider'}),'gemini')
    expect(screen.getByRole('combobox',{name:'Model'})).toHaveValue('')
    await user.type(screen.getByRole('combobox',{name:'Model'}),'fixture/model')
    await user.click(screen.getByRole('button',{name:'Test Connection'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid configured key.')
    expect(screen.queryByText(/completed a live/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Message to Copilot'),'General fixture')
    await user.click(screen.getByRole('button',{name:'Send message'}))
    await waitFor(()=>expect(bodies).toHaveLength(1))
    expect(bodies[0].stream).toBe(false);expect(bodies[0].provider).toBe('gemini')
  })

  it('renders Markdown and code without interpreting HTML or unsafe links',()=>{
    render(<CopilotMarkdown text={'# Heading\n**Bold**\n[unsafe](javascript:alert)\n<script>danger()</script>\n```python\nprint(1)\n```\n| A | B |\n| --- | --- |\n| one | two |'}/>)
    expect(screen.getByRole('heading',{name:'Heading'})).toBeInTheDocument()
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.queryByRole('link',{name:'unsafe'})).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('print(1)').tagName).toBe('CODE')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
