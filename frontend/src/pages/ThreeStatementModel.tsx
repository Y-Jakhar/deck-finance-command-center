import { useEffect, useState } from 'react'
import { deskApi, fmt } from './deskUtils'

type Statement = { id: string; period_end: string; source: string }
type SavedCase = { id:string; case_revision:number; input_hash:string; result_hash:string; inputs:Record<string,unknown>; result:ModelResult }
type ModelResult = { calculation_version:string; scenarios:Record<string,{wacc:number;enterprise_value:number;equity_value_per_share:number;forecast:Array<{year:number;income:Record<string,number>;balance:Record<string,number>;cash_flow:Record<string,number>;fcff:number;balance_check:number}>}> }
type Issue = {period:string;code:string;observed?:number;expected?:number}
const names = ['bear','base','bull']
const arrays = ['revenue_growth','cost_of_sales_percent_revenue','operating_expenses_percent_revenue','da_percent_revenue','cash_capex_percent_revenue','lease_additions_percent_revenue','receivables_percent_revenue','inventory_percent_cost_sales','other_current_assets_percent_revenue','payables_percent_cost_sales','other_current_liabilities_percent_revenue','debt_issuance','debt_repayment','lease_principal_repayment','dividends','repurchases','other_income']
const scalars = ['income_tax_rate','borrowings_interest_rate','lease_interest_rate','cost_of_equity','pretax_cost_of_debt','market_debt_weight','marginal_debt_tax_rate','terminal_growth']
const blankScenario = () => ({rationale:'',operating_source:'',financing_source:'',...Object.fromEntries(arrays.map(k=>[k,Array(5).fill(null)])),...Object.fromEntries(scalars.map(k=>[k,null]))})

export function ThreeStatementModel({symbol, statements}:{symbol:string;statements:Statement[]}) {
  const [ids,setIds] = useState<string[]>([])
  const [raw,setRaw] = useState('')
  const [cases,setCases] = useState<SavedCase[]>([])
  const [issues,setIssues] = useState<Issue[]>([])
  const [preview,setPreview] = useState<ModelResult|null>(null)
  const [frozen,setFrozen] = useState<SavedCase|null>(null)
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)

  useEffect(()=>{let active=true;setIds([]);setRaw('');setPreview(null);setFrozen(null);setIssues([]);setMessage('')
    deskApi('/three-statement-cases?symbol='+encodeURIComponent(symbol)).then((items:SavedCase[])=>{if(active)setCases(items)}).catch(e=>{if(active)setMessage(e.message)})
    return ()=>{active=false}
  },[symbol])

  function parse() {
    const value = JSON.parse(raw)
    if(value.symbol!==symbol) throw new Error('Case symbol must match the selected instrument.')
    return value
  }
  async function run(work:()=>Promise<void>) {
    setBusy(true);setMessage('')
    try{await work()}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  async function normalize() {
    if(!ids.length)throw new Error('Select reviewed statement snapshots first.')
    const normalized=await deskApi('/three-statement-cases/normalize',{symbol,statement_ids:ids}) as {currency:string;history:Array<Record<string,unknown>>;missing:Array<unknown>;conflicts:Array<unknown>}
    if(normalized.conflicts.length){setMessage(`${normalized.conflicts.length} conflicting source mapping(s). Resolve the reviewed snapshots before modeling.`);return}
    const body={model_version:'1.0',parent_case_id:null,symbol,title:'',currency:normalized.currency,units:'millions',
      valuation_date:normalized.history.at(-1)?.period_end,history:normalized.history,
      scenarios:Object.fromEntries(names.map(name=>[name,blankScenario()])),
      bridge:{excess_cash:null,non_operating_assets:null,minority_interest:null,other_non_equity_claims:null,diluted_shares:null,source_reference:''},
      notes:''}
    setRaw(JSON.stringify(body,null,2));setPreview(null);setFrozen(null);setIssues([])
    setMessage(`${normalized.history.length} fiscal periods normalized; ${normalized.missing.length} unmapped fields remain. Review source units, periods, signs and every missing value before reconciliation. Blank values are not zero.`)
  }
  function load(item:SavedCase){setRaw(JSON.stringify({...item.inputs,parent_case_id:item.id},null,2));setPreview(null);setFrozen(item);setIssues([]);setMessage(`Loaded frozen revision ${item.case_revision} as a child draft. The original remains unchanged.`)}

  return <section className="desk-panel three-statement-model">
    <h2>Integrated three-statement cases · separate versioned model</h2>
    <p>Use reviewed income, balance-sheet and cash-flow snapshots from Import Financials above. Reconcile three to five consecutive fiscal years, then forecast earnings, operating working capital, PP&amp;E, debt, finance leases, equity and cash together. The model blocks missing facts, broken historical identities, negative forecast cash and unbalanced forecast years. Existing Apple and DealLens cases are unaffected.</p>
    {message&&<p role="status" className="desk-message">{message}</p>}
    {cases.length>0&&<label>Open frozen integrated case as a new revision<select aria-label="Open integrated case" value="" onChange={e=>{const item=cases.find(x=>x.id===e.target.value);if(item)load(item)}}><option value="">Choose saved case</option>{cases.map(item=><option key={item.id} value={item.id}>{String(item.inputs.title)} · revision {item.case_revision}</option>)}</select></label>}
    <details><summary>Choose reviewed statement snapshots</summary>{statements.map(item=><label key={item.id} className="desk-check"><input type="checkbox" checked={ids.includes(item.id)} onChange={e=>setIds(e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))} />{item.period_end} · {item.source}</label>)}<button disabled={busy||!ids.length} onClick={()=>run(normalize)}>Normalize selected years</button></details>
    <p>Review and edit the source-labeled case JSON. Rate inputs are decimals; cash CapEx and payouts are positive spending; other movements are signed. Unknown values stay <code>null</code>. Independent scenario assumptions require their own rationale and sources.</p>
    <label>Integrated case inputs<textarea aria-label="Integrated case inputs" rows={20} spellCheck={false} value={raw} onChange={e=>{setRaw(e.target.value);setPreview(null);setIssues([])}} /></label>
    <label>Import reviewed integrated-case JSON<input type="file" accept=".json" onChange={e=>{const file=e.target.files?.[0];if(file)file.text().then(value=>{setRaw(value);setPreview(null);setFrozen(null);setIssues([])}).catch(error=>setMessage(error.message))}} /></label>
    <div className="desk-actions"><button disabled={busy||!raw} onClick={()=>run(async()=>{const result=await deskApi('/three-statement-cases/reconcile',parse()) as {status:string;issues:Issue[]};setIssues(result.issues);setMessage(result.status==='ready'?'Historical statements reconcile; review assumptions before calculating.':`${result.issues.length} historical issue(s) block valuation.`)})}>Reconcile history</button><button disabled={busy||!raw} onClick={()=>run(async()=>{const result=await deskApi('/three-statement-cases/preview',parse()) as ModelResult;setPreview(result);setMessage('Integrated forecast balances in all scenarios. Review cash, debt, FCFF and source readiness before freezing.')})}>Calculate preview</button><button disabled={busy||!preview} onClick={()=>run(async()=>{const saved=await deskApi('/three-statement-cases',parse()) as SavedCase;setFrozen(saved);setPreview(null);setCases(await deskApi('/three-statement-cases?symbol='+encodeURIComponent(symbol)));setMessage(`Frozen revision ${saved.case_revision}; source inputs and results hashed.`)})}>Freeze case</button></div>
    {issues.length>0&&<details open><summary>{issues.length} reconciliation issue(s)</summary><div role="alert" className="desk-table"><table><thead><tr><th>Period</th><th>Issue</th><th>Observed</th><th>Expected</th></tr></thead><tbody>{issues.map((item,i)=><tr key={i}><td>{item.period}</td><td>{item.code}</td><td>{fmt(item.observed)}</td><td>{fmt(item.expected)}</td></tr>)}</tbody></table></div></details>}
    {frozen&&<div className="desk-actions"><strong>Frozen revision {frozen.case_revision}</strong><span>Input SHA-256 {frozen.input_hash.slice(0,16)}… · Result SHA-256 {frozen.result_hash.slice(0,16)}…</span><button onClick={()=>run(async()=>{const checked=await deskApi(`/three-statement-cases/${frozen.id}/verify`);setMessage(`Frozen snapshot ${checked.snapshot_integrity}; recalculation ${checked.recalculation}`)})}>Verify snapshot</button><a href={`/api/desk/three-statement-cases/${frozen.id}/export`}>Export frozen JSON</a><a href={`/api/desk/three-statement-cases/${frozen.id}/export/xlsx`}>Export formula-linked Excel</a></div>}
    {(preview||frozen?.result)&&<><h3>{preview?'Unsaved preview':'Frozen result'} · {(preview||frozen?.result)?.calculation_version}</h3><p>Calculation integrity is separate from decision readiness. Forecast cash is generated by cash flows, never a balance plug. Market financing assumptions and source completeness still need analyst review.</p><div className="desk-table"><table><thead><tr><th>Scenario</th><th>WACC</th><th>Enterprise value</th><th>Equity residual/share</th><th>Year-five cash</th><th>Year-five debt</th><th>Maximum balance difference</th></tr></thead><tbody>{names.map(name=>{const item=(preview||frozen?.result)!.scenarios[name];return <tr key={name}><th>{name}</th><td>{fmt(item.wacc*100)}%</td><td>{fmt(item.enterprise_value)}</td><td>{fmt(item.equity_value_per_share)}</td><td>{fmt(item.forecast.at(-1)?.balance.cash)}</td><td>{fmt(item.forecast.at(-1)?.balance.borrowings)}</td><td>{fmt(Math.max(...item.forecast.map(row=>Math.abs(row.balance_check))))}</td></tr>})}</tbody></table></div>{names.map(name=><details key={name}><summary>{name} five-year statements and FCFF</summary><div className="desk-table"><table><thead><tr><th>Year</th><th>Revenue</th><th>EBIT</th><th>Net income</th><th>CFO</th><th>CapEx</th><th>Closing cash</th><th>Borrowings</th><th>Finance leases</th><th>Equity</th><th>FCFF</th><th>Balance check</th></tr></thead><tbody>{(preview||frozen?.result)!.scenarios[name].forecast.map(row=><tr key={row.year}><td>{row.year}</td><td>{fmt(row.income.revenue)}</td><td>{fmt(row.income.ebit)}</td><td>{fmt(row.income.net_income)}</td><td>{fmt(row.cash_flow.cash_from_operations)}</td><td>{fmt(row.cash_flow.cash_capex)}</td><td>{fmt(row.balance.cash)}</td><td>{fmt(row.balance.borrowings)}</td><td>{fmt(row.balance.finance_lease_liabilities)}</td><td>{fmt(row.balance.equity)}</td><td>{fmt(row.fcff)}</td><td>{fmt(row.balance_check)}</td></tr>)}</tbody></table></div></details>)}</>}
  </section>
}
