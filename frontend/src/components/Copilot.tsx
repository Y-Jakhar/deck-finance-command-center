import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { getCopilotSelection, type CopilotSelection } from './copilotContext'
import { CopilotMarkdown } from './CopilotMarkdown'
import './copilot.css'

type Provider = 'openrouter' | 'openai' | 'gemini' | 'ollama'
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; context: boolean; meta?: string; partial?: boolean; references?: Array<{reference:string;record_id:string;symbol:string}> }
type Model = { id: string; name: string; tools: boolean; pricing: { prompt?: string; completion?: string } }
type Case = { id: string; title: string; symbol: string; version: number }
type Settings = { configured: Record<string, boolean>; max_output_tokens: number; requests_per_day: number; daily_usd: number }
type Options = { provider: Provider; model: string; mode: string; stream: boolean; persist: boolean; tokens: number; cost: number }
const defaults: Options = { provider: 'openrouter', model: '', mode: 'general', stream: true, persist: false, tokens: 2048, cost: 0.05 }
const STORAGE = 'researchdesk.ai.chat', PREFS = 'researchdesk.ai.preferences'
const scrub = (s: string) => s.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,})/g, '[redacted]')

function initialOptions(): Options {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}')
    return { ...defaults, provider: ['openrouter','openai','gemini','ollama'].includes(p.provider) ? p.provider : defaults.provider,
      model: typeof p.model==='string' ? p.model.slice(0,200) : '', persist: p.persist===true,
      stream: p.stream!==false, tokens: Number.isInteger(p.tokens) && p.tokens>=64 && p.tokens<=8192 ? p.tokens : 2048,
      cost: typeof p.cost==='number' && p.cost>=0 && p.cost<=5 ? p.cost : .05 }
  } catch { return defaults }
}

export async function aiApi(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/desk/ai'+path, { method: body===undefined?'GET':'POST',
    headers: { 'Content-Type':'application/json', 'X-ResearchDesk-AI':'1' }, body: body===undefined?undefined:JSON.stringify(body), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.detail==='string' ? data.detail : data.detail?.message || 'Local copilot request failed.')
  return data
}

export function Copilot({ path }: { path: string }) {
  const [open,setOpen]=useState(false), [settingsOpen,setSettingsOpen]=useState(false)
  const [options,setOptions]=useState<Options>(initialOptions)
  const [messages,setMessages]=useState<ChatMessage[]>(()=>{
    if (!initialOptions().persist) { localStorage.removeItem(STORAGE); return [] }
    try { const data=JSON.parse(localStorage.getItem(STORAGE)||'[]'); return Array.isArray(data)?data.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-40).map(m=>({id:crypto.randomUUID(),role:m.role,content:scrub(m.content.slice(0,16000)),context:m.context===true,meta:typeof m.meta==='string'?scrub(m.meta):undefined,partial:m.partial===true})):[] } catch { return [] }
  })
  const [selection,setSelection]=useState<CopilotSelection>(getCopilotSelection)
  const [useContext,setUseContext]=useState(false), [compare,setCompare]=useState<string[]>([])
  const [models,setModels]=useState<Model[]>([]),[cases,setCases]=useState<Case[]>([]),[settings,setSettings]=useState<Settings|null>(null)
  const [input,setInput]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false)
  const [width,setWidth]=useState(420),[preview,setPreview]=useState<unknown>(null)
  const [compact,setCompact]=useState(window.innerWidth<=1100)
  const request=useRef<AbortController|null>(null), generation=useRef(0), panel=useRef<HTMLElement>(null), trigger=useRef<HTMLButtonElement>(null), outputEnd=useRef<HTMLDivElement>(null)
  const resize=useRef<{x:number;width:number}|null>(null)
  const attached: CopilotSelection = { ...selection, workspace:path, journal_ids:compare.length?compare:(selection.journal_ids||[]) }
  const update=(next:Partial<Options>)=>setOptions(o=>({...o,...next}))

  useEffect(()=>{
    const receive=()=>setSelection(getCopilotSelection())
    const showCopilot=()=>setOpen(true)
    const showSettings=()=>{setOpen(true);setSettingsOpen(true)}
    window.addEventListener('researchdesk:context',receive);window.addEventListener('researchdesk:ai-open',showCopilot);window.addEventListener('researchdesk:ai-settings',showSettings);receive()
    return()=>{window.removeEventListener('researchdesk:context',receive);window.removeEventListener('researchdesk:ai-open',showCopilot);window.removeEventListener('researchdesk:ai-settings',showSettings);request.current?.abort()}
  },[])
  useEffect(()=>{setPreview(null)},[path,selection,compare,useContext])
  useEffect(()=>{
    // No context sharing preference survives reload; explicit opt-in each session.
    localStorage.setItem(PREFS,JSON.stringify(options))
    if (options.persist) localStorage.setItem(STORAGE,JSON.stringify(messages.slice(-40)))
    else localStorage.removeItem(STORAGE)
  },[options,messages])
  useEffect(()=>{
    if (!open) return
    const abort=new AbortController();let active=true;setLoading(true);setModels([]);setError('')
    aiApi('/settings',undefined,abort.signal).then(data=>{if(active)setSettings(data)}).catch(()=>{})
    aiApi('/models?provider='+options.provider,undefined,abort.signal).then(data=>{if(active)setModels(Array.isArray(data.models)?data.models:[])}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false;abort.abort()}
  },[open,options.provider])
  useEffect(()=>{
    if (!open||!useContext) return
    const abort=new AbortController()
    aiApi('/cases',undefined,abort.signal).then(data=>setCases(Array.isArray(data.cases)?data.cases:[])).catch(e=>{if(!abort.signal.aborted)setError(e.message)})
    return()=>abort.abort()
  },[open,useContext])
  useEffect(()=>{if(open) panel.current?.querySelector<HTMLButtonElement>('.ai-close')?.focus()},[open])
  useEffect(()=>{if(messages.length)outputEnd.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[open,messages.length,busy])
  useEffect(()=>{document.documentElement.classList.toggle('ai-is-open',open);document.documentElement.style.setProperty('--ai-panel-width',width+'px');return()=>document.documentElement.classList.remove('ai-is-open')},[open,width])
  useEffect(()=>{const change=()=>setCompact(window.innerWidth<=1100);window.addEventListener('resize',change);return()=>window.removeEventListener('resize',change)},[])
  useEffect(()=>{const shell=document.querySelector<HTMLElement>('.app-shell');if(shell)shell.inert=open&&compact;return()=>{if(shell)shell.inert=false}},[open,compact])

  function close() { setOpen(false); trigger.current?.focus() }
  function stop() {
    generation.current++;request.current?.abort();request.current=null;setBusy(false);setStatus('Stopped. Partial output and provider charges may remain.')
    setMessages(ms=>ms.map((m,i)=>i===ms.length-1&&m.role==='assistant'?{...m,partial:true}:m))
  }
  function clear() { stop();setMessages([]);setError('');setStatus('New conversation');setPreview(null);localStorage.removeItem(STORAGE) }
  function keys(event:KeyboardEvent<HTMLElement>) {
    if(event.key==='Escape'){event.preventDefault();close()}
    if(event.key==='Tab'&&window.matchMedia('(max-width: 1100px)').matches){
      const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[]).filter(e=>e.getClientRects().length>0)
      if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus()}
      else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus()}
    }
  }
  const payload=(question:string, history:ChatMessage[]=messages)=>({ provider:options.provider,model:options.model,mode:options.mode,stream:options.stream,max_output_tokens:options.tokens,max_request_cost:options.cost,
    use_context:useContext,selection:useContext?attached:null,
    messages:[...history.filter(m=>m.content.trim()&&!m.partial&&(useContext||!m.context)).slice(-38).map(m=>({role:m.role,content:m.content.length>16000?m.content.slice(0,15950)+' [history excerpt truncated]':m.content})),{role:'user',content:scrub(question)}] })

  async function send() {
    if(!input.trim()||busy||!options.model.trim())return
    const text=input.trim(),id=crypto.randomUUID(),controller=new AbortController(),seq=++generation.current
    request.current=controller;setBusy(true);setError('');setStatus('Connecting…');setInput('')
    setMessages(ms=>[...ms,{id:crypto.randomUUID(),role:'user',content:scrub(text),context:useContext},{id,role:'assistant',content:'',context:useContext}])
    let complete=false
    try {
      const response=await fetch('/api/desk/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-ResearchDesk-AI':'1'},body:JSON.stringify(payload(text)),signal:controller.signal})
      if(!response.ok){const data=await response.json();throw new Error(typeof data.detail==='string'?data.detail:data.detail?.message||'Invalid copilot request.')}
      if(!response.body)throw new Error('Streaming response is unavailable in this browser.')
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending=''
      const accept=(line:string)=>{
        if(seq!==generation.current||!line.trim())return
        const event=JSON.parse(line)
        if(event.type==='delta')setMessages(ms=>ms.map(m=>m.id===id?{...m,content:m.content+scrub(event.text)}:m))
        else if(event.type==='meta'){
          setStatus(event.context_attached?'Attached saved evidence · '+(event.tools_enabled?'read-only tools verified':'tools unavailable; snapshot only'):'Chat only · no workspace evidence sent')
          setMessages(ms=>ms.map(m=>m.id===id?{...m,references:event.references||[],meta:`${event.provider} · ${event.model} · ${event.context_attached?'Historical context attached':'No workspace context'} · conservative cost ceiling ${event.estimated_ceiling_usd==null?'unknown':'$'+Number(event.estimated_ceiling_usd).toFixed(5)}`} :m))
        } else if(event.type==='tool')setStatus(`${event.name}: ${event.status}`)
        else if(event.type==='done'){
          complete=true;setStatus('Response complete · '+event.accounting)
          const tokens=(event.usage||[]).map((u:{prompt_tokens?:number;completion_tokens?:number})=>`input ${u.prompt_tokens??'unreported'} / output ${u.completion_tokens??'unreported'} tokens`).join('; ')
          setMessages(ms=>ms.map(m=>m.id===id?{...m,meta:(m.meta||'')+' · '+tokens+(event.actual_cost_usd==null?' · cost unreported':` · cost $${Number(event.actual_cost_usd).toFixed(6)}`)+(event.finish==='length'||event.finish==='incomplete'?' · token limit reached':'')}:m))
        } else if(event.type==='error')throw new Error(event.message)
      }
      while(true){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});const lines=pending.split('\n');pending=lines.pop()||'';lines.forEach(accept)}
      pending+=decoder.decode();if(pending.trim())accept(pending)
      if(!complete&&seq===generation.current)throw new Error('Connection ended before completion. Partial output may have been billed.')
    } catch(e){if(seq===generation.current&&!controller.signal.aborted){setError(e instanceof Error?e.message:'Generation failed.');setStatus('Incomplete response');setMessages(ms=>ms.map(m=>m.id===id?{...m,partial:true}:m))}}
    finally{if(seq===generation.current){setBusy(false);request.current=null}}
  }

  async function testConnection() {
    if(!options.model)return
    const controller=new AbortController(),seq=++generation.current;request.current=controller;setBusy(true);setError('');setStatus('Testing model capability; no research context sent…')
    try{const data=await aiApi('/test',payload('Connection test',[]),controller.signal);if(seq!==generation.current)return;if(!data.ok)throw new Error(data.message);setStatus(data.message);if(data.limits)setPreview({openrouter_spending_controls:data.limits})}
    catch(e){if(seq===generation.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Connection test failed.')}
    finally{if(seq===generation.current){setBusy(false);request.current=null}}
  }
  async function previewContext(){try{setPreview(await aiApi('/context',attached));setError('')}catch(e){setError(e instanceof Error?e.message:'Context unavailable.')}}
  const selected=models.find(m=>m.id===options.model)
  const icon=<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 4V5Z M9 9h6 M9 12h4"/></svg>
  return <>
    <button ref={trigger} className="ai-launch" onClick={()=>setOpen(!open)} aria-expanded={open} aria-controls="ai-copilot" aria-label="Open AI Research Copilot">{icon}<span>AI Copilot</span></button>
    {open&&<><button className="ai-scrim" aria-label="Dismiss AI Copilot" onClick={close}/><aside id="ai-copilot" className="ai-panel" ref={panel} role={compact?'dialog':undefined} aria-modal={compact||undefined} aria-label="AI Research Copilot" onKeyDown={keys} style={{'--ai-width':width+'px'} as CSSProperties}>
      <div className="ai-resize" role="separator" aria-label="Resize copilot panel" aria-orientation="vertical" tabIndex={0} aria-valuenow={width} aria-valuemin={300} aria-valuemax={700}
        onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setWidth(w=>Math.max(300,Math.min(700,w+(e.key==='ArrowLeft'?20:-20))))}}}
        onPointerDown={e=>{resize.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(resize.current)setWidth(Math.max(300,Math.min(700,resize.current.width+resize.current.x-e.clientX)))}} onPointerUp={()=>{resize.current=null}} onPointerCancel={()=>{resize.current=null}}/>
      <header className="ai-header"><div><p>RESEARCH PARTNER</p><h2>AI Research Copilot</h2></div><button className="ai-close" aria-label="Close AI Research Copilot" onClick={close}>×</button></header>
      <div className="ai-controls"><label>Provider<select disabled={busy} value={options.provider} onChange={e=>{update({provider:e.target.value as Provider,model:'',cost:e.target.value==='openrouter'?.05:0});setPreview(null);setUseContext(false);setCompare([])}}>{[['openrouter','OpenRouter'],['openai','OpenAI'],['gemini','Gemini'],['ollama','Ollama · local']].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>Model<input disabled={busy} list="ai-models" placeholder={loading?'Loading models…':'Select or enter model ID'} value={options.model} onChange={e=>update({model:e.target.value})} maxLength={200}/><datalist id="ai-models">{models.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</datalist></label>
        <label className="ai-mode">Assistant mode<select disabled={busy} value={options.mode} onChange={e=>update({mode:e.target.value})}>{[['general','General Assistant'],['analyst','Research Analyst'],['tutor','Trading Tutor'],['committee','Investment Committee']].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      <div className="ai-privacy"><label><input type="checkbox" disabled={busy} checked={useContext} onChange={e=>{setUseContext(e.target.checked);setCompare([])}}/>Use Current Workspace Context</label><p>{options.provider==='ollama'?'Chat goes to local Ollama.':'Chat messages go to '+options.provider+'.'} {useContext?`Saved ${selection.symbol||'selected'} evidence is shared. Unsaved drafts excluded.`:'Workspace evidence is off. Earlier contextual turns are excluded.'}</p>
        {useContext&&<><label>Attach up to two journal cases<select multiple disabled={busy} aria-label="Attached comparison cases" value={compare} onChange={e=>setCompare(Array.from(e.target.selectedOptions).map(o=>o.value).slice(0,2))}>{cases.map(c=><option key={c.id} value={c.id}>{c.symbol} · {c.title} · v{c.version}</option>)}</select></label><button disabled={busy} onClick={previewContext}>Preview shared evidence</button></>}
      </div>
      <nav className="ai-toolbar" aria-label="Chat actions"><button onClick={clear}>New chat</button><button onClick={clear}>Clear chat</button><button aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(!settingsOpen)}>AI Settings</button></nav>
      <div className="ai-scroll">
        {settingsOpen&&<section className="ai-settings"><h3>AI Settings</h3><p>{settings?.configured?.[options.provider]?'Backend credential configured.':options.provider==='ollama'?'Ollama must be running on 127.0.0.1:11434.':'Credential missing. Configure the backend environment variable.'} Keys are never returned to this panel.</p><p>OpenRouter uses the desktop DeepSeek harness key source. Optional providers use OPENAI_API_KEY or GEMINI_API_KEY in the backend environment.</p>
          <label><input type="checkbox" disabled={busy} checked={options.stream} onChange={e=>update({stream:e.target.checked})}/>Stream responses</label><label><input type="checkbox" checked={options.persist} onChange={e=>update({persist:e.target.checked})}/>Save chat history on this browser</label><p>Off by default. Turning it off deletes the saved copy. Context sharing resets to off on reload.</p>
          <label>Maximum output tokens per provider call<input type="number" min={64} max={settings?.max_output_tokens||4096} disabled={busy} value={options.tokens} onChange={e=>update({tokens:Number(e.target.value)})}/></label><label>Request dollar guard (0 disables)<input type="number" min={0} max={5} step="0.01" disabled={busy} value={options.cost} onChange={e=>update({cost:Number(e.target.value)})}/></label><p>At most 2 provider calls per answer. OpenRouter enforces a conservative estimate and its published endpoint price ceiling. OpenRouter daily safeguard: ${settings?.daily_usd??1}; requests: {settings?.requests_per_day??100}. Unknown pricing cannot support a dollar guard.</p>
          <label>Panel width<input type="range" min={300} max={700} step={20} value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
          <p>{selected?.tools?'Catalog advertises read-only tool support.':'Tool capability is unverified. Context snapshots still work; Test Connection can verify function support.'}</p><button disabled={busy||!options.model} onClick={testConnection}>Test Connection</button><button onClick={()=>aiApi('/usage').then(setPreview).catch(e=>setError(e.message))}>Local usage</button><p>Set key spending caps in your OpenRouter account. Shared-key spending by the harness also counts there.</p>
        </section>}
        {preview!==null&&<details className="ai-preview" open><summary>Local evidence / usage preview</summary><pre>{JSON.stringify(preview,null,2)}</pre></details>}
        {!messages.length&&<div className="ai-empty">{icon}<h3>Think through the evidence.</h3><p>Ask a question, explain an assumption or challenge a thesis. Enable context when you want saved research included.</p><button onClick={()=>setInput('How should I assess a backtest with only five holdout trades?')}>Discuss small backtest samples</button></div>}
        <div className="ai-history" role="log" aria-label="Copilot conversation">{messages.map(m=><article key={m.id} className={'ai-message ai-message--'+m.role}><div className="ai-message-heading"><strong>{m.role==='user'?'You':'Copilot'}</strong>{m.role==='assistant'&&m.content&&<button onClick={()=>navigator.clipboard.writeText(scrub(m.content)).then(()=>setStatus('Response copied')).catch(()=>setError('Clipboard unavailable. Select and copy the response text.'))}>Copy response</button>}</div><CopilotMarkdown text={m.content} onEvidence={p=>aiApi(p).then(setPreview).catch(e=>setError(e.message))}/>{m.partial&&<p className="ai-partial">Incomplete response</p>}{m.meta&&<small>{m.meta}</small>}{m.references?.map(r=><button key={r.reference} onClick={()=>aiApi(r.reference.replace('/api/desk/ai','')).then(setPreview).catch(e=>setError(e.message))}>Source: {r.symbol} · {r.record_id.slice(0,8)}</button>)}</article>)}</div><div ref={outputEnd}/>
      </div>
      <footer className="ai-composer">{error&&<p role="alert" className="ai-error">{error}</p>}<p role="status" className="ai-status">{status||'Ready · choose a model'}</p><label htmlFor="ai-question" className="ai-question-label">Message to Copilot</label><textarea id="ai-question" value={input} maxLength={16000} onChange={e=>setInput(e.target.value)} placeholder="Ask about the research…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/><div><small>Enter sends · Shift+Enter adds a line</small>{busy?<button onClick={stop}>Stop generation</button>:<button disabled={!input.trim()||!options.model.trim()} onClick={send}>Send message</button>}</div></footer>
    </aside></>}
  </>
}
