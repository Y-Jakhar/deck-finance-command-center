import { useEffect, useState } from 'react'
import { deskApi, fmt } from './deskUtils'

type SavedStatement = {
  id: string; symbol: string; source: string; currency: string; units: string
  prior_period_end: string; period_end: string
  income_statement: Record<string, Array<number | null>>
  cash_flow: Record<string, Array<number | null>>
}
type HistoryRow = { period_end: string; source_reference: string; statement_id: string | null; revenue: string; ebit: string; depreciation_amortization: string; cash_capex: string; finance_lease_asset_additions: string; change_nwc: string }
type ScenarioDraft = {
  rationale: string; operating_assumptions_source: string; discount_source: string; revenue_growth: string[]; ebit_margin: string[]
  da_percent_revenue: string[]; cash_capex_percent_revenue: string[]
  finance_lease_additions_percent_revenue: string[]; nwc_investment_percent_revenue_change: string[]
  operating_tax_rate: string; cost_of_equity: string; pretax_cost_of_debt: string
  market_debt_weight: string; marginal_debt_tax_rate: string
  terminal_method: 'perpetuity_growth' | 'exit_ebitda_multiple'; terminal_growth: string; exit_ebitda_multiple: string
}
type ScenarioName = 'bear' | 'base' | 'bull'
type ValuationResult = {
  calculation_version: string; historical_base_period: string; discount_convention: string; lease_convention: string; tax_convention: string
  scenarios: Record<ScenarioName, {wacc:number;terminal_method:string;terminal_parameter:number;terminal_value:number;pv_forecast_fcff:number;pv_terminal_value:number;terminal_share_of_ev:number|null;bridge:Record<string,number>;forecast:Array<Record<string,number>>;sensitivity:{wacc:number[];terminal_parameter:number[];equity_value_per_share:Array<Array<number|null>>}}>
}
type SavedCase = {id:string;symbol:string;created_at:string;case_revision:number;parent_case_id:string|null;input_hash:string;result_hash:string;inputs:Record<string,unknown>;result:ValuationResult}
const names: ScenarioName[] = ['bear', 'base', 'bull']
const forecastFields = [
  ['revenue_growth', 'Revenue growth'], ['ebit_margin', 'EBIT margin'], ['da_percent_revenue', 'D&A / revenue'],
  ['cash_capex_percent_revenue', 'Cash CapEx / revenue'], ['finance_lease_additions_percent_revenue', 'New finance-lease assets / revenue'],
  ['nwc_investment_percent_revenue_change', 'Δ NWC / Δ revenue'],
] as const
const bridgeFields = [
  ['excess_cash', 'Excess cash'], ['non_operating_assets', 'Non-operating assets'],
  ['borrowings', 'Borrowings'], ['finance_lease_liabilities', 'Finance-lease liabilities'],
  ['minority_interest', 'Minority interest'], ['other_non_equity_claims', 'Other non-equity claims'],
  ['diluted_shares', 'Diluted shares'],
] as const
const scenarioNumbers = [
  ['operating_tax_rate', 'Operating tax rate'], ['cost_of_equity', 'Cost of equity'],
  ['pretax_cost_of_debt', 'Pre-tax cost of debt'], ['market_debt_weight', 'Market-value debt weight'],
  ['marginal_debt_tax_rate', 'Marginal debt tax rate'],
] as const
const historicalNumbers = ['revenue', 'ebit', 'depreciation_amortization', 'cash_capex', 'finance_lease_asset_additions', 'change_nwc'] as const
const emptyHistory = (): HistoryRow => ({period_end:'',source_reference:'',statement_id:null,revenue:'',ebit:'',depreciation_amortization:'',cash_capex:'',finance_lease_asset_additions:'',change_nwc:''})
const emptyScenario = (): ScenarioDraft => ({
  rationale:'',operating_assumptions_source:'',discount_source:'',revenue_growth:Array(5).fill(''),ebit_margin:Array(5).fill(''),
  da_percent_revenue:Array(5).fill(''),cash_capex_percent_revenue:Array(5).fill(''),
  finance_lease_additions_percent_revenue:Array(5).fill(''),nwc_investment_percent_revenue_change:Array(5).fill(''),
  operating_tax_rate:'',cost_of_equity:'',pretax_cost_of_debt:'',market_debt_weight:'',marginal_debt_tax_rate:'',
  terminal_method:'perpetuity_growth',terminal_growth:'',exit_ebitda_multiple:'',
})
const optionalNumber = (value: string) => {
  if (value.trim() === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Enter finite historical values or leave them blank.')
  return number
}
const requiredNumber = (value: string, label: string) => {
  if (value.trim() === '') throw new Error(`Enter ${label}; do not use blank as zero.`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`Enter a finite ${label}.`)
  return number
}
const asText = (value: unknown) => value == null ? '' : String(value)

export function VersionedValuation({ symbol, statements, onLinkJournal }: { symbol: string; statements: SavedStatement[]; onLinkJournal?: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().slice(0,10))
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState<HistoryRow[]>([emptyHistory(),emptyHistory()])
  const [bridge, setBridge] = useState<Record<string,string>>({source_reference:'',...Object.fromEntries(bridgeFields.map(([key])=>[key,'']))})
  const [scenarios, setScenarios] = useState<Record<ScenarioName,ScenarioDraft>>({bear:emptyScenario(),base:emptyScenario(),bull:emptyScenario()})
  const [cases, setCases] = useState<SavedCase[]>([])
  const [parentId, setParentId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{input:string;result:ValuationResult}|null>(null)
  const [frozen, setFrozen] = useState<SavedCase|null>(null)
  const [verification, setVerification] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setCases([]); setFrozen(null); setParentId(null); setPreview(null); setHistory([emptyHistory(),emptyHistory()]); setScenarios({bear:emptyScenario(),base:emptyScenario(),bull:emptyScenario()}); setBridge({source_reference:'',...Object.fromEntries(bridgeFields.map(([key])=>[key,'']))}); setTitle(''); setCurrency('USD'); setValuationDate(new Date().toISOString().slice(0,10)); setNotes(''); setVerification(''); setMessage('')
    deskApi('/valuation-cases-v2?symbol='+encodeURIComponent(symbol)).then((items:SavedCase[])=>{if(active)setCases(items)}).catch(error=>{if(active)setMessage(error.message)})
    return ()=>{active=false}
  },[symbol])

  function updateHistory(index:number, patch:Partial<HistoryRow>) {
    setHistory(current=>current.map((row,i)=>i===index?{...row,...patch}:row)); setPreview(null)
  }
  function updateScenario(name:ScenarioName, patch:Partial<ScenarioDraft>) {
    setScenarios(current=>({...current,[name]:{...current[name],...patch}})); setPreview(null)
  }
  function useStatement(statement:SavedStatement) {
    if(statement.currency!==currency||statement.units!=='millions'){setMessage('Statement currency/units differ; reconcile them before linking.');return}
    const incoming:HistoryRow[] = [0,1].map((i)=>({
      period_end:i===0?statement.prior_period_end:statement.period_end,
      source_reference:statement.source,statement_id:statement.id,
      revenue:asText(statement.income_statement.revenue?.[i]), ebit:asText(statement.income_statement.ebit?.[i]),
      depreciation_amortization:asText((statement.cash_flow.da??statement.income_statement.da)?.[i]),
      cash_capex:asText(statement.cash_flow.capex?.[i]),
      finance_lease_asset_additions:asText(statement.cash_flow.finance_lease_asset_additions?.[i]),
      change_nwc:asText(statement.cash_flow.change_nwc?.[i]),
    })).filter(row=>row.revenue)
    if (!incoming.length){setMessage('This statement has no sourced revenue for either period.');return}
    const combined = history.filter(row=>row.period_end && row.revenue)
    for (const row of incoming) {
      const existing = combined.find(item=>item.period_end===row.period_end)
      if (existing && historicalNumbers.some(key=>existing[key] && row[key] && existing[key]!==row[key])) {
        setMessage(`Conflicting reported values for ${row.period_end}; resolve them manually before linking.`); return
      }
      if (!existing) combined.push(row)
    }
    setHistory(combined.sort((a,b)=>a.period_end.localeCompare(b.period_end)));setPreview(null)
    setMessage(`Linked ${incoming.length} sourced fiscal period(s). Review missing rows, lease data, and the equity bridge.`)
  }
  function loadSaved(item:SavedCase) {
    const input = item.inputs as unknown as {title:string;currency:string;valuation_date:string;notes:string;history:Array<Record<string,unknown>>;bridge:Record<string,unknown>;scenarios:Record<ScenarioName,Record<string,unknown>>}
    setTitle(input.title);setCurrency(input.currency);setValuationDate(input.valuation_date);setNotes(input.notes)
    setHistory(input.history.map(row=>({period_end:asText(row.period_end),source_reference:asText(row.source_reference),statement_id:asText(row.statement_id)||null,revenue:asText(row.revenue),ebit:asText(row.ebit),depreciation_amortization:asText(row.depreciation_amortization),cash_capex:asText(row.cash_capex),finance_lease_asset_additions:asText(row.finance_lease_asset_additions),change_nwc:asText(row.change_nwc)})))
    setBridge(Object.fromEntries(Object.entries(input.bridge).map(([key,value])=>[key,asText(value)])))
    setScenarios(Object.fromEntries(names.map(name=>{
      const source=input.scenarios[name]
      return [name,{...emptyScenario(),...Object.fromEntries(Object.entries(source).map(([key,value])=>[key,Array.isArray(value)?value.map(asText):asText(value)]))}]
    })) as Record<ScenarioName,ScenarioDraft>)
    setParentId(item.id);setFrozen(item);setPreview(null);setVerification('');setMessage(`Loaded frozen revision ${item.case_revision} as a draft. Saving creates a child snapshot; the original remains unchanged.`)
  }
  function body() {
    if (history.length<2) throw new Error('Enter at least two historical fiscal years.')
    if (!title.trim() || !notes.trim() || !valuationDate || !bridge.source_reference.trim()) throw new Error('Enter the case title, valuation date, source notes and bridge source.')
    if (history.some(row=>!row.period_end || !row.source_reference.trim())) throw new Error('Every historical year needs a fiscal date and source reference.')
    if (names.some(name=>!scenarios[name].rationale.trim() || !scenarios[name].operating_assumptions_source.trim() || !scenarios[name].discount_source.trim())) throw new Error('Every scenario needs its own rationale, operating-assumption source and cost-of-capital source.')
    return {
      model_version:'1.0',parent_case_id:parentId,symbol,title,currency,units:'millions',valuation_date:valuationDate,
      lease_treatment:'operating_expensed_finance_capitalized',notes,
      history:history.map((row,index)=>({period_end:row.period_end,source_reference:row.source_reference,statement_id:row.statement_id,
        revenue:requiredNumber(row.revenue,`year ${index+1} revenue`),
        ...Object.fromEntries(historicalNumbers.filter(key=>key!=='revenue').map(key=>[key,optionalNumber(row[key])]))})),
      bridge:{source_reference:bridge.source_reference,...Object.fromEntries(bridgeFields.map(([key])=>[key,requiredNumber(bridge[key],key)]))},
      scenarios:Object.fromEntries(names.map(name=>{
        const value=scenarios[name]
        return [name,{rationale:value.rationale,operating_assumptions_source:value.operating_assumptions_source,discount_source:value.discount_source,
          ...Object.fromEntries(forecastFields.map(([key])=>[key,value[key].map((raw,i)=>requiredNumber(raw,`${name} year ${i+1} ${key}`))])),
          ...Object.fromEntries(scenarioNumbers.map(([key])=>[key,requiredNumber(value[key],`${name} ${key}`)])),
          terminal_method:value.terminal_method,terminal_growth:value.terminal_method==='perpetuity_growth'?requiredNumber(value.terminal_growth,`${name} terminal growth`):null,
          exit_ebitda_multiple:value.terminal_method==='exit_ebitda_multiple'?requiredNumber(value.exit_ebitda_multiple,`${name} exit multiple`):null}]
      })),
    }
  }
  async function run(save:boolean) {
    setBusy(true);setMessage('')
    try {
      const inputs=body();const fingerprint=JSON.stringify(inputs)
      if(save && preview?.input!==fingerprint) throw new Error('Inputs changed after preview. Recalculate before freezing a case.')
      if(save){
        const saved=await deskApi('/valuation-cases-v2',inputs) as SavedCase
        setCases(await deskApi('/valuation-cases-v2?symbol='+encodeURIComponent(symbol)))
        setFrozen(saved);setParentId(saved.id);setPreview(null)
        setMessage(`Frozen revision ${saved.case_revision} saved with input/result hashes. Future edits create a new revision.`)
      }else{
        const result=await deskApi('/valuation-cases-v2/preview',inputs) as ValuationResult
        setPreview({input:fingerprint,result});setMessage('Preview calculated from the displayed inputs. Review forecasts, sensitivity and bridge before freezing.')
      }
    }catch(error){setMessage(error instanceof Error?error.message:String(error))}
    finally{setBusy(false)}
  }
  const display=preview?.result||frozen?.result
  return <section className="desk-panel versioned-valuation"><h2>Versioned FCFF cases · independent model</h2>
    <p>This model is separate from DealLens. Enter sourced historical years and explicit scenario assumptions. Operating leases stay expensed; finance-lease asset additions are forecast reinvestment and their liabilities enter the equity bridge. No source or market estimate is generated automatically.</p>
    {message&&<p className="desk-message" role="status">{message}</p>}
    {cases.length>0&&<><label>Open frozen case as a new revision<select aria-label="Open versioned valuation" value="" onChange={event=>{const item=cases.find(saved=>saved.id===event.target.value);if(item)loadSaved(item)}}><option value="">Choose a saved case…</option>{cases.map(item=><option key={item.id} value={item.id}>{item.inputs.title as string} · revision {item.case_revision} · {item.created_at}</option>)}</select></label>{parentId&&<button onClick={()=>{setParentId(null);setFrozen(null);setPreview(null);setVerification('');setMessage('Current inputs are now an unlinked draft; review them before freezing a new case.')}}>Start unlinked case with these inputs</button>}</>}
    <div className="desk-fields"><label>Case title<input value={title} onChange={event=>{setTitle(event.target.value);setPreview(null)}} /></label><label>Currency<input value={currency} maxLength={3} onChange={event=>{setCurrency(event.target.value.toUpperCase());setPreview(null)}} /></label><label>Valuation date · latest fiscal end<input type="date" value={valuationDate} onChange={event=>{setValuationDate(event.target.value);setPreview(null)}} /></label></div>
    <label>Case sources, lease reconciliation and limitations<textarea value={notes} onChange={event=>{setNotes(event.target.value);setPreview(null)}} /></label>
    <h3>Historical financials · source-linked, {currency} millions</h3>
    <p>Use reviewed snapshots or enter historical values manually. Blank optional values stay missing. Editing an imported value clears its statement link and requires a new source reference. Cash CapEx and noncash finance-lease additions are separate; no addition is counted twice.</p>
    <label>Bring in a reviewed statement<select aria-label="Link reviewed statement" value="" onChange={event=>{const selected=statements.find(item=>item.id===event.target.value);if(selected)useStatement(selected)}}><option value="">Choose statement…</option>{statements.map(item=><option key={item.id} value={item.id}>{item.period_end} · {item.source}</option>)}</select></label>
    <div className="desk-table"><table><thead><tr><th>Fiscal end</th><th>Source reference</th>{historicalNumbers.map(key=><th key={key}>{key.replaceAll('_',' ')}</th>)}<th /></tr></thead><tbody>{history.map((row,index)=><tr key={index}><td><input aria-label={`Historical year ${index+1}`} type="date" value={row.period_end} onChange={event=>updateHistory(index,{period_end:event.target.value,...(row.statement_id?{statement_id:null,source_reference:''}:{})})} /></td><td><input aria-label={`Historical source ${index+1}`} value={row.source_reference} onChange={event=>updateHistory(index,{source_reference:event.target.value,statement_id:null})} /></td>{historicalNumbers.map(key=><td key={key}><input aria-label={`${key} year ${index+1}`} type="number" step="any" value={row[key]} onChange={event=>updateHistory(index,{[key]:event.target.value,...(row.statement_id?{statement_id:null,source_reference:''}:{})})} /></td>)}<td><button aria-label={`Remove year ${index+1}`} onClick={()=>{setHistory(history.filter((_,i)=>i!==index));setPreview(null)}}>Remove</button></td></tr>)}</tbody></table></div>
    <button onClick={()=>{setHistory([...history,emptyHistory()]);setPreview(null)}}>Add fiscal year</button>
    <h3>Enterprise-to-equity bridge · {currency} millions</h3><p>Enter every item, including explicit zero where appropriate. Excess cash excludes operating cash. Borrowings exclude finance-lease liabilities, which have their own line. Operating-lease liabilities are excluded under this model's expensed convention.</p>
    <div className="desk-fields">{bridgeFields.map(([key,label])=><label key={key}>{label}<input type="number" step="any" value={bridge[key]} onChange={event=>{setBridge({...bridge,[key]:event.target.value});setPreview(null)}} /></label>)}</div>
    <label>Bridge and share-count source<input value={bridge.source_reference} onChange={event=>{setBridge({...bridge,source_reference:event.target.value});setPreview(null)}} /></label>
    <h3>Five-year operating scenarios</h3><p>Each case needs its own rationale, forecast inputs and financing assumptions. Financing debt weights and debt cost should include finance leases under this convention. Decimal rates: 0.10 means 10%. Δ NWC equals change in revenue × the entered investment rate. Tax on positive EBIT only; no loss carryforward. End-of-year discounting.</p>
    {names.map(name=>{const value=scenarios[name];return <details key={name} open={name==='base'}><summary>{name.toUpperCase()} · independent assumptions</summary><label>{name} rationale<textarea value={value.rationale} onChange={event=>updateScenario(name,{rationale:event.target.value})} /></label><label>Operating-assumption source<input value={value.operating_assumptions_source} onChange={event=>updateScenario(name,{operating_assumptions_source:event.target.value})} /></label><label>Cost-of-capital evidence / source<input value={value.discount_source} onChange={event=>updateScenario(name,{discount_source:event.target.value})} /></label><div className="desk-fields">{scenarioNumbers.map(([key,label])=><label key={key}>{label}<input type="number" step="any" value={value[key]} onChange={event=>updateScenario(name,{[key]:event.target.value})} /></label>)}</div>
      <div className="desk-table"><table><thead><tr><th>Year</th>{forecastFields.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{Array.from({length:5},(_,year)=><tr key={year}><th>{year+1}</th>{forecastFields.map(([key])=><td key={key}><input aria-label={`${name} year ${year+1} ${key}`} type="number" step="any" value={value[key][year]} onChange={event=>updateScenario(name,{[key]:value[key].map((current,i)=>i===year?event.target.value:current)})} /></td>)}</tr>)}</tbody></table></div>
      <div className="desk-fields"><label>Terminal method<select value={value.terminal_method} onChange={event=>updateScenario(name,{terminal_method:event.target.value as ScenarioDraft['terminal_method']})}><option value="perpetuity_growth">Perpetuity growth</option><option value="exit_ebitda_multiple">Exit EV / EBITDA</option></select></label>{value.terminal_method==='perpetuity_growth'?<label>Terminal growth<input type="number" step="any" value={value.terminal_growth} onChange={event=>updateScenario(name,{terminal_growth:event.target.value})} /></label>:<label>Exit EBITDA multiple<input type="number" step="any" value={value.exit_ebitda_multiple} onChange={event=>updateScenario(name,{exit_ebitda_multiple:event.target.value})} /></label>}</div>
    </details>})}
    <div className="desk-actions"><button disabled={busy} onClick={()=>run(false)}>Calculate preview</button><button disabled={busy||!preview} onClick={()=>run(true)}>Freeze new case revision</button></div>
    {frozen&&<div className="desk-actions"><strong>Frozen revision {frozen.case_revision}</strong><span>Input SHA-256 {frozen.input_hash.slice(0,16)}… · Result SHA-256 {frozen.result_hash.slice(0,16)}…</span><button onClick={()=>deskApi(`/valuation-cases-v2/${frozen.id}/verify`).then(item=>setVerification(`${item.snapshot_integrity}; ${item.recalculation}`)).catch(error=>setVerification(error.message))}>Verify snapshot</button><a href={`/api/desk/valuation-cases-v2/${frozen.id}/export`}>Export frozen JSON</a><a href={`/api/desk/valuation-cases-v2/${frozen.id}/export/xlsx`}>Export formula-linked Excel</a>{onLinkJournal&&<button onClick={()=>onLinkJournal(frozen.id)}>Write thesis with this case</button>}{verification&&<span role="status">{verification}</span>}</div>}
    {display&&<><h3>{preview?'Unsaved preview':'Frozen snapshot'} · {display.calculation_version}</h3><p>Base period: {display.historical_base_period}. {display.discount_convention} {display.tax_convention} {display.lease_convention}</p>
      <div className="desk-table"><table><caption>Scenario comparison · {currency} millions except per-share values</caption><thead><tr><th>Metric</th>{names.map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{[['wacc','WACC'],['pv_forecast_fcff','PV forecast FCFF'],['pv_terminal_value','PV terminal value'],['terminal_share_of_ev','Terminal / EV'],['enterprise_value','Enterprise value'],['equity_value','Equity value'],['equity_value_per_share','Equity residual per share']].map(([key,label])=><tr key={key}><th>{label}</th>{names.map(name=>{const item=display.scenarios[name];const raw=key in item?item[key as keyof typeof item]:item.bridge[key];const number=typeof raw==='number'?raw:null;return <td key={name}>{number===null?'Unavailable':['wacc','terminal_share_of_ev'].includes(key)?`${fmt(number*100)}%`:fmt(number)}</td>})}</tr>)}</tbody></table></div><p>A negative equity residual means modeled claims exceed enterprise value; it is not a negative tradable share price or a price target.</p>
      {names.map(name=>{const result=display.scenarios[name];return <details key={name}><summary>{name.toUpperCase()} forecast, bridge and sensitivity</summary><p>WACC {fmt(result.wacc*100)}% · {result.terminal_method.replaceAll('_',' ')} {fmt(result.terminal_parameter)} · terminal share of EV {result.terminal_share_of_ev===null?'Unavailable':`${fmt(result.terminal_share_of_ev*100)}%`}</p><div className="desk-table"><table><thead><tr>{['Year','Revenue','EBIT','Cash tax','D&A','Cash CapEx','Lease assets','Δ NWC','FCFF','PV FCFF'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{result.forecast.map(row=><tr key={row.year}>{['year','revenue','ebit','cash_taxes','da','cash_capex','finance_lease_asset_additions','change_nwc','fcff','present_value_fcff'].map(key=><td key={key}>{fmt(row[key])}</td>)}</tr>)}</tbody></table></div><div className="desk-table"><table><caption>Equity value per share sensitivity · rows WACC, columns terminal {result.terminal_method==='perpetuity_growth'?'growth':'EV / EBITDA multiple'}</caption><thead><tr><th>WACC</th>{result.sensitivity.terminal_parameter.map((value,i)=><th key={i}>{result.terminal_method==='perpetuity_growth'?`${fmt(value*100)}%`:`${fmt(value)}×`}</th>)}</tr></thead><tbody>{result.sensitivity.wacc.map((rate,i)=><tr key={i}><th>{fmt(rate*100)}%</th>{result.sensitivity.equity_value_per_share[i].map((value,j)=><td key={j}>{fmt(value)}</td>)}</tr>)}</tbody></table></div><p>Bridge: EV {fmt(result.bridge.enterprise_value)} + excess cash {fmt(result.bridge.excess_cash)} + non-operating assets {fmt(result.bridge.non_operating_assets)} − borrowings {fmt(result.bridge.borrowings)} − finance-lease liabilities {fmt(result.bridge.finance_lease_liabilities)} − minority interest {fmt(result.bridge.minority_interest)} − other claims {fmt(result.bridge.other_non_equity_claims)} = equity {fmt(result.bridge.equity_value)}.</p></details>})}
    </>}
  </section>
}
