import { useEffect, useState } from 'react'
import { deskApi } from './ResearchDesk'
import type { Instrument } from '../types/market'
import './researchdesk.css'
type Watchlist = {id:string; name:string; instrument_ids:string[]; instruments:Instrument[]}
export function Watchlists({onNavigate}:{onNavigate:(path:string)=>void}) {
  const [lists,setLists]=useState<Watchlist[]>([])
  const [universe,setUniverse]=useState<Instrument[]>([])
  const [id,setId]=useState('')
  const [name,setName]=useState('')
  const [members,setMembers]=useState<string[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  async function load(){setLists(await deskApi('/watchlists'))}
  useEffect(()=>{load().catch(e=>setError(e.message)); fetch('/api/v1/search').then(r=>{if(!r.ok)throw new Error('Market instrument universe unavailable');return r.json()}).then(d=>setUniverse(Array.isArray(d.items)?d.items:[])).catch(e=>{setUniverse([]);setError(e.message)})},[])
  async function save(remove=false) {
    setBusy(true);setError('')
    try {
      if(remove) {await deskApi('/watchlists/'+id,{},'DELETE');setId('');setName('');setMembers([])}
      else {const saved=await deskApi('/watchlists'+(id?'/'+id:''),{name,instrument_ids:members},id?'PUT':'POST');setId(saved.id)}
      await load()
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <section className="desk" aria-label="Named research watchlists"><div className="desk-panel"><h2>Research watchlists</h2>{error&&<p role="alert">{error}</p>}<div className="desk-fields"><label>Open watchlist<select aria-label="Open watchlist" value={id} onChange={e=>{const list=lists.find(x=>x.id===e.target.value);setId(list?.id||'');setName(list?.name||'');setMembers(list?.instrument_ids||[])}}><option value="">New watchlist</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Watchlist name<input value={name} onChange={e=>setName(e.target.value)} /></label></div><fieldset><legend>Registered instruments</legend><div className="desk-fields">{universe.map(x=><label key={x.id}><span><input type="checkbox" checked={members.includes(x.id)} onChange={e=>setMembers(e.target.checked?[...members,x.id]:members.filter(id=>id!==x.id))} /> {x.displaySymbol} · {x.name}</span></label>)}</div></fieldset><div className="desk-actions"><button disabled={busy||!name.trim()} onClick={()=>save()}>Save watchlist</button>{id&&<button disabled={busy} onClick={()=>save(true)}>Delete watchlist</button>}</div>{lists.find(x=>x.id===id)?.instruments.map(x=><div className="desk-actions" key={x.id}><button onClick={()=>onNavigate('/instrument/'+x.id)}>{x.displaySymbol} · Market history</button><button onClick={()=>{localStorage.setItem('researchdesk.symbol',x.displaySymbol);onNavigate('/research/company')}}>{x.displaySymbol} · Company research</button></div>)}</div></section>
}
