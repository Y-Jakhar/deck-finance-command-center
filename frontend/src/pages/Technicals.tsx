import { useEffect, useState } from 'react'
import { deskApi, fmt, Plot } from './ResearchDesk'

type Point = {timestamp:string;close:number;sma:number|null;ema:number|null;atr:number|null;stochastic_k:number|null;stochastic_d:number|null}
export function Technicals({datasetId,onPeriodChange}:{datasetId:string;onPeriodChange?:(period:number)=>void}) {
  const [period,setPeriod]=useState(14),[data,setData]=useState<{definition:string;observations:Point[]}|null>(null),[error,setError]=useState('')
  useEffect(()=>{onPeriodChange?.(period)},[period,onPeriodChange])
  useEffect(()=>{let active=true;setData(null);setError('');deskApi(`/datasets/${datasetId}/technicals?period=${period}`).then(x=>{if(active)setData(x)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[datasetId,period])
  return <section><h3>Technical indicators</h3><label>Indicator period<input type="number" min="2" max="500" value={period} onChange={e=>setPeriod(Number(e.target.value))} /></label>{error&&<p role="alert">{error}</p>}{data&&<><p>{data.definition}</p><Plot title={`EMA (${period}) · after warm-up`} values={data.observations.filter(x=>x.ema!==null).map(x=>x.ema!)} /><div className="desk-table"><table><caption>Last 30 source observations · indicator values, not trade recommendations</caption><thead><tr>{['Timestamp','Close','SMA','EMA','ATR','Stochastic %K','%D'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{data.observations.slice(-30).map(x=><tr key={x.timestamp}><th>{x.timestamp}</th>{[x.close,x.sma,x.ema,x.atr,x.stochastic_k,x.stochastic_d].map((v,i)=><td key={i}>{fmt(v)}</td>)}</tr>)}</tbody></table></div></>}</section>
}
