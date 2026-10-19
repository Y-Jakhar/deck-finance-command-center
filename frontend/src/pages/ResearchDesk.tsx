import { useEffect, useRef, useState } from 'react'

import { Technicals } from './Technicals'
import { StrategyLibrary } from './StrategyLibrary'
import { StrategyDatasetImport } from './StrategyDatasetImport'
import { StrategyRunDetails, type DetailedExperiment } from './StrategyRunDetails'
import { FinancialImport } from './FinancialImport'
import { applyReviewedStatement, type ReviewedStatement } from './statementDraft'
import { WaccWorksheet } from './WaccWorksheet'
import { VersionedValuation } from './VersionedValuation'
import { ThreeStatementModel } from './ThreeStatementModel'
import { EvidenceReviewV2 } from './EvidenceReviewV2'
import { deskApi, fmt } from './deskUtils'
import { researchRoutes } from '../workspaces'
import type { Analysis, CompanyInput, DraftCompany } from '../types/valuation'
import { publishCopilotSelection } from '../components/copilotContext'

import './researchdesk.css'



export { deskApi, fmt } from './deskUtils'

type SavedValuation = { id: string; symbol: string; case: string; created_at: string; assumptions_note: string; result: Analysis }

type Dataset = { id: string; symbol: string; csv_text: string; source: string; currency: string; exchange: string; frequency: string; adjustment_policy: string; timestamp_policy: string; availability: string; identity: { issues: Array<{message: string}> } }

type Experiment = { id: string; symbol: string; summary: { run_id: string }; config?: {strategy:string;mode:string;parameters:Record<string,number>;costs:Record<string,number>}; result: { baseline: { metrics: Record<string, number | null>; equity_curve: Array<{equity: number}>; drawdown_curve?:Array<{drawdown:number}>; trades?:Array<Record<string,unknown>> }; out_of_sample: { metrics: Record<string, number | null> }; verdict: {verdict: string; warnings: string[]}; split: {boundary: string}; dataset: unknown; execution: unknown; walk_forward: unknown; cost_stress: unknown } }

type Entry = Record<string, string | number | null>

const blankEntry = (symbol: string): Entry => ({ symbol, title: '', category: 'combined', status: 'draft', thesis: '', evidence: '', fundamentals: '', price_action: '', catalysts: '', risks: '', invalidation: '', expectation: '', outcome: '', supported: 'pending', reasoning_errors: '', lessons: '', limitations: '', valuation_id: null, valuation_case_v2_id: null, experiment_id: null, portfolio_id: null, version: 0 })

const blankCompany = (symbol: string): DraftCompany => ({ name: '', ticker: symbol, company_type: 'public', currency: 'USD', base_year: 2025, revenue: '', ebitda: '', cash: '', debt: '', diluted_shares: null, tax_rate: 0.21, tax_methodology: 'tax_on_positive_ebit_only', da_percent_revenue: 0.03, capex_percent_revenue: 0.03, nwc_percent_revenue: 0.1, wacc: '', terminal_growth: 0.025, growth_rates: [0.05, 0.05, 0.04, 0.03, 0.03], margin_targets: [0.3, 0.3, 0.3, 0.3, 0.3], peers: [], sources: [], provenance: {} })

const financialFields = ['base_year', 'revenue', 'ebitda', 'cash', 'debt', 'diluted_shares', 'tax_rate', 'da_percent_revenue', 'capex_percent_revenue', 'nwc_percent_revenue', 'wacc', 'terminal_growth'] as const

const journalFields = ['thesis', 'evidence', 'fundamentals', 'price_action', 'catalysts', 'risks', 'invalidation', 'expectation', 'outcome', 'reasoning_errors', 'lessons', 'limitations']

const label = (key: string) => key.replaceAll('_', ' ').replace('da percent revenue', 'D&A / revenue').replace('wacc', 'WACC').replace('ebitda', 'EBITDA')

export function Plot({ values, title }: { values: number[]; title: string }) {

  if (values.length < 2) return <p>No chart observations available.</p>

  const min = Math.min(...values), max = Math.max(...values)

  const points = values.map((v, i) => `${i / (values.length - 1) * 780 + 10},${155 - (v - min) / (max - min || 1) * 140}`).join(' ')

  return <figure><figcaption>{title} · {values.length} observations · {fmt(min)}–{fmt(max)}</figcaption><svg role="img" aria-label={title} viewBox="0 0 800 170"><polyline fill="none" stroke="var(--teal)" strokeWidth="2" points={points} /></svg></figure>

}



export function ResearchDesk({ section, onNavigate }: { section: string; onNavigate: (path: string) => void }) {

  const [symbol, setSymbol] = useState(localStorage.getItem('researchdesk.symbol') || 'AAPL')

  const [selection, setSelection] = useState(symbol)
  const symbolRef = useRef(symbol); symbolRef.current = symbol
  const [valuations, setValuations] = useState<SavedValuation[]>([])
  const [versionedCases, setVersionedCases] = useState<Array<{id:string;symbol:string;case_revision:number;input_hash:string;result_hash:string;inputs:{title:string}}>>([])

  const [datasets, setDatasets] = useState<Dataset[]>([])

  const [experiments, setExperiments] = useState<Experiment[]>([])

  const [portfolios,setPortfolios]=useState<Array<{id:string;name:string}>>([])
  const [comparisonId,setComparisonId]=useState('')
  const [entries, setEntries] = useState<Entry[]>([])

  const [company, setCompany] = useState<DraftCompany>(blankCompany(symbol))

  const [valuationCase, setCase] = useState('base')

  const [assumptions, setAssumptions] = useState('')

  const [entry, setEntry] = useState<Entry>(blankEntry(symbol))

  const [entryId, setEntryId] = useState<string | null>(null)

  const [revisions, setRevisions] = useState<Entry[]>([])

  const [valuation, setValuation] = useState<SavedValuation | null>(null)

  const [experiment, setExperiment] = useState<Experiment | null>(null)

  const [datasetId, setDatasetId] = useState('')

  const [csvText, setCsvText] = useState('')
  const [importProvenance, setImportProvenance] = useState<Record<string, unknown>>({})
  const [corporateActions, setCorporateActions] = useState('[]')
  const [qualityReport, setQualityReport] = useState<{status:string;row_count:number;date_start:string|null;date_end:string|null;file_hash:string;issues:Array<{severity:string;code:string;message:string;row?:number}>}|null>(null)

  const [meta, setMeta] = useState({ source: '', exchange: 'XNAS', currency: 'USD', frequency: '1d', adjustment_policy: '', timestamp_policy: '' })

  const [longOnly,setLongOnly]=useState(false)
  const [settings, setSettings] = useState({ fast: 10, slow: 30, fee_bps: 5, slippage_bps: 5, fixed_fee: 0, initial_capital: 100000, is_ratio: 0.6, walk_forward_windows: 3 })

  const [contract, setContract] = useState(JSON.stringify([{label: 'OOS return nonnegative', metric: 'oos.total_return', op: '>=', value: 0, severity: 'critical'}, {label: 'Drawdown above -25%', metric: 'baseline.max_drawdown', op: '>=', value: -0.25, severity: 'critical'}], null, 2))

  const [query, setQuery] = useState('')

  const [statusFilter, setStatusFilter] = useState('')

  const [allDatasets, setAllDatasets] = useState<Dataset[]>([])
  const [benchmarkId, setBenchmarkId] = useState('')
  const [annualBars, setAnnualBars] = useState(252)
  const [indicatorPeriod,setIndicatorPeriod] = useState(14)
  const [priceStats, setPriceStats] = useState<unknown>(null)
  const [range, setRange] = useState('all')

  const [message, setMessage] = useState('')

  const [busy, setBusy] = useState(false)

  const [statements, setStatements] = useState<Array<ReviewedStatement & {prior_period_end:string; notes:string}>>([])
  const [statementId, setStatementId] = useState('')

  const [health, setHealth] = useState<unknown>(null)

  useEffect(() => {
    publishCopilotSelection({workspace:section,symbol,journal_ids:entryId?[entryId]:[],valuation_id:valuation?.id||null,experiment_id:experiment?.id||null,portfolio_id:section==='journal'&&typeof entry.portfolio_id==='string'?entry.portfolio_id:null,dataset_id:datasetId||null,range,annual_bars:annualBars,indicator_period:indicatorPeriod,benchmark_id:benchmarkId||null,indicators:['SMA','EMA','ATR','Stochastic %K/%D']})
  }, [section,symbol,entryId,valuation?.id,experiment?.id,entry.portfolio_id,datasetId,range,annualBars,indicatorPeriod,benchmarkId])

  async function refresh() {

    const suffix = '?symbol=' + encodeURIComponent(symbol)

    const [v, d, e, j, f, all, p, vc] = await Promise.all([deskApi('/valuations' + suffix), deskApi('/datasets' + suffix), deskApi('/experiments' + suffix), deskApi('/journal' + suffix), deskApi('/statements' + suffix), deskApi('/datasets'), deskApi('/portfolios'+suffix), deskApi('/valuation-cases-v2'+suffix)])

    if (symbolRef.current !== symbol) return
    setValuations(v); setDatasets(d); setExperiments(e); setEntries(j); setStatements(f); setAllDatasets(all);setPortfolios(p);setVersionedCases(vc)

  }

  useEffect(() => {

    localStorage.setItem('researchdesk.symbol', symbol)

    setCompany(blankCompany(symbol)); setValuation(null); setExperiment(null); setDatasetId(''); setStatementId(''); setPriceStats(null); setBenchmarkId(''); setEntry(blankEntry(symbol)); setEntryId(null); setRevisions([])

    refresh().catch(e => setMessage(e.message))

  }, [symbol])

  useEffect(()=>{if(section==='journal'){const id=localStorage.getItem('researchdesk.pendingPortfolio');if(id){setEntry({...blankEntry(symbol),portfolio_id:id});setEntryId(null);localStorage.removeItem('researchdesk.pendingPortfolio')}}},[section,symbol])

  async function action(work: () => Promise<void>) {

    setBusy(true); setMessage('')

    try { await work(); await refresh() } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }

  }

  const dataset = datasets.find(d => d.id === datasetId)

  const rows = dataset?.csv_text.trim().split(/\r?\n/).filter(line=>line.trim()).slice(1).map(line => line.split(',')) || []

  const displayRows = range === 'all' ? rows : rows.slice(-Number(range))

  const closeValues = displayRows.map(row => Number(row[4]))

  const changeCompany = (key: string, value: unknown) => {

    setCompany(c => ({ ...c, [key]: value, provenance: { ...c.provenance, [key]: { status: 'manual', source: 'Analyst input', note: 'Reviewed input; see assumption notes' } } })); setValuation(null)

  }

  return <main id="main-content" className="desk">

    {section==='settings'&&<section className="desk-panel"><h2>AI Settings</h2><p>Choose a provider, configure a model and review context sharing, history and cost limits in the copilot.</p><button onClick={()=>window.dispatchEvent(new Event('researchdesk:ai-settings'))}>Open AI Settings</button></section>}

    <header className="desk-heading"><div><p className="desk-eyebrow">SOURCE-LINKED FINANCE RESEARCH</p><h1>{section === 'company' ? 'Company research' : section === 'valuation' ? 'Valuation cases' : section === 'prices' ? 'Historical price analysis' : section === 'strategy' ? 'Strategy Lab' : section === 'journal' ? 'Research journal' : 'ResearchDesk settings'}</h1></div><label>Research instrument<input aria-label="Research instrument" value={selection} maxLength={40} onChange={e => setSelection(e.target.value.toUpperCase().trim())} /></label><button disabled={busy||!selection} onClick={()=>setSymbol(selection)}>Open instrument</button></header>

    <nav className="desk-tabs" aria-label="Research workflow">{[['prices', 'Historical prices'], ['company', 'Company research'], ['valuation', 'Valuation'], ['strategy', 'Strategy Lab'], ['journal', 'Research journal'], ['settings', 'Settings']].map(([key, name]) => <a key={key} aria-current={section === key ? 'page' : undefined} href={researchRoutes[key]} onClick={e => { e.preventDefault(); onNavigate(researchRoutes[key]) }}>{name}</a>)}</nav>

    {message && <p className="desk-message" role="alert">{message}</p>}

    {busy && <p role="status">Working…</p>}

    {section === 'company' && <section className="desk-panel"><h2>Reported financial statements</h2><label>Import reviewed statement JSON<input type="file" accept=".json" onChange={e=>{const file=e.target.files?.[0];if(file) action(async()=>{const body=JSON.parse(await file.text());if(body.symbol!==symbol)throw new Error('Select the matching instrument');await deskApi('/statements',body);setMessage('Sourced statement snapshot saved')})}} /></label>{statements.length===0&&<p>No statements imported. Import a reviewed statement snapshot; unavailable facts remain empty.</p>}{statements.map(s=><article key={s.id}><p>Source: {s.source}</p><p>{s.notes}</p>{[['Income statement',s.income_statement],['Balance sheet',s.balance_sheet],['Cash flow',s.cash_flow]].map(([name,rows])=><div className="desk-table" key={String(name)}><table><caption>{String(name)} · currency millions</caption><thead><tr><th>Reported metric</th><th>{s.prior_period_end}</th><th>{s.period_end}</th></tr></thead><tbody>{Object.entries(rows).map(([name,values])=><tr key={name}><th>{label(name)}</th>{(values as Array<number|null>).map((v,i)=><td key={i}>{fmt(v)}</td>)}</tr>)}</tbody></table></div>)}</article>)}</section>}

    {(section === 'company' || section === 'valuation') && <FinancialImport symbol={symbol} statements={statements} onSaved={refresh} />}

    {section === 'valuation' && <EvidenceReviewV2 key={symbol} symbol={symbol} />}
    {section === 'valuation' && <ThreeStatementModel symbol={symbol} statements={statements} />}

    {section === 'valuation' && <VersionedValuation symbol={symbol} statements={statements.map(s=>({...s,symbol}))} onLinkJournal={id=>{setEntry({...blankEntry(symbol),valuation_case_v2_id:id});setEntryId(null);onNavigate('/journal')}} />}

    {(section === 'company' || section === 'valuation') && <>

      <section className="desk-panel"><h2>Reviewed company inputs</h2><p>Amounts and shares in millions. Ratios use decimals: 0.10 = 10%. Defaults are analyst assumptions; financial fields require sourced inputs. SEC prefill covers revenue, cash, debt and diluted shares only.</p>

      <div className="desk-actions"><button disabled={busy || !symbol} onClick={() => action(async () => { const draft = await deskApi('/company/' + encodeURIComponent(symbol)); setCompany({ ...blankCompany(symbol), ...draft.values, provenance: draft.provenance, sources: [draft.source] }); setValuation(null); setMessage(draft.warning) })}>Fetch SEC draft</button>

      <select aria-label="Reviewed statement for valuation" value={statementId} onChange={e => setStatementId(e.target.value)}><option value="">Choose reviewed statement…</option>{statements.map(s => <option key={s.id} value={s.id}>{s.period_end} · {s.source}</option>)}</select><button disabled={busy || !statementId} onClick={() => { try { const chosen = statements.find(s => s.id === statementId); if (!chosen) throw new Error('Choose a saved statement first.'); const result = applyReviewedStatement(company, chosen); if (!result.transferred.length) throw new Error('This statement has no supported current-period valuation inputs.'); setCompany(result.draft); setValuation(null); setMessage(`Transferred ${result.transferred.join(', ')} from reviewed statement. Check all remaining assumptions before valuation.`) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }}>Use reviewed statement inputs</button>

      <label className="desk-file">Import company JSON<input type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) action(async () => { const imported = await deskApi('/company/validate', JSON.parse(await file.text())) as CompanyInput; if (imported.ticker !== symbol) throw new Error('Select the matching research instrument before import'); setCompany({...imported,diluted_shares:imported.diluted_shares??null}); setValuation(null) }) }} /></label>

      <select aria-label="Open saved valuation" value="" onChange={e => { const v = valuations.find(v => v.id === e.target.value); if (v) {setCompany({...v.result.company,diluted_shares:v.result.company.diluted_shares??null}); setValuation(v); setCase(v.case); setAssumptions(v.assumptions_note)} }}><option value="">Open saved case…</option>{valuations.map(v => <option key={v.id} value={v.id}>{v.case} · {v.created_at}</option>)}</select></div>

      <div className="desk-fields"><label>Company name<input required value={company.name} onChange={e => changeCompany('name', e.target.value)} /></label><label>Currency<input value={company.currency} maxLength={3} onChange={e => changeCompany('currency', e.target.value.toUpperCase())} /></label>{financialFields.map(key => <label key={key}>{label(key)}<input type="number" step="any" value={company[key] ?? ''} onChange={e => changeCompany(key, e.target.value === '' ? null : Number(e.target.value))} /><small>{company.provenance[key]?.status || 'Analyst assumption / input required'}</small></label>)}</div>
      <WaccWorksheet onApply={(rate, inputs) => { setCompany(c => ({ ...c, wacc: rate, provenance: { ...c.provenance, wacc: { status: 'derived', source: 'Analyst-entered WACC worksheet', note: `Cost of equity ${inputs.costOfEquity}; pre-tax debt cost ${inputs.pretaxCostOfDebt}; market debt weight ${inputs.debtWeight}; marginal tax rate ${inputs.marginalTaxRate}. Verify source evidence and reconcile lease treatment.` } } })); setValuation(null) }} />

      <div className="desk-fields"><label>Five annual growth rates<textarea defaultValue={JSON.stringify(company.growth_rates)} key={company.name+'growth'} onBlur={e => {try { changeCompany('growth_rates', JSON.parse(e.target.value)) } catch { setMessage('Enter a JSON array of five decimal growth rates') }}} /></label><label>Five EBITDA margins<textarea defaultValue={JSON.stringify(company.margin_targets)} key={company.name+'margins'} onBlur={e => {try {changeCompany('margin_targets', JSON.parse(e.target.value))} catch {setMessage('Enter a JSON array of five decimal margins')}}} /></label></div>

      <label>Peer companies JSON — at least two reviewed peers<textarea className="desk-code" defaultValue={JSON.stringify(company.peers, null, 2)} key={company.name + JSON.stringify(company.peers)} onBlur={e => {try { changeCompany('peers', JSON.parse(e.target.value)) } catch {setMessage('Invalid peer JSON')} }} /></label>

      <label>Source notes (one per line)<textarea value={company.sources.join('\n')} onChange={e => changeCompany('sources', e.target.value.split('\n'))} /></label>

      <details><summary>Field provenance</summary><pre>{JSON.stringify(company.provenance, null, 2)}</pre></details>

      <div className="desk-fields"><label>Case<select value={valuationCase} onChange={e => setCase(e.target.value)}>{['base', 'bull', 'bear'].map(x => <option key={x}>{x}</option>)}</select></label><label>Assumptions, peer relevance and limitations<textarea required value={assumptions} onChange={e => setAssumptions(e.target.value)} /></label></div>

      <button disabled={busy || !assumptions.trim()} onClick={() => action(async () => { setValuation(await deskApi('/valuations', { company, case: valuationCase, assumptions_note: assumptions })); setMessage('Valuation calculated and saved as an immutable case') })}>Calculate & save case</button></section>

      {valuation && <section className="desk-panel"><h2>{valuation.case} · Saved valuation</h2><div className="desk-metrics">{Object.entries(valuation.result.dcf).map(([key, value]) => <div key={key}><small>{label(key)}</small><strong>{fmt(value)}</strong></div>)}</div>

      <div className="desk-actions"><button onClick={()=>onNavigate('/quant')}>Analyze in Quant Lab</button><a href={`/api/desk/valuations/${valuation.id}/export/xlsx`}>Export Excel</a><a href={`/api/desk/valuations/${valuation.id}/export/pdf`}>Export PDF</a><button onClick={() => {setEntry({...blankEntry(symbol), valuation_id: valuation.id}); setEntryId(null); onNavigate('/journal')}}>Write thesis with this case</button></div>

      <div className="desk-table"><table><caption>FCFF projections · {company.currency} millions</caption><thead><tr>{['Year', 'Revenue', 'EBITDA', 'NOPAT', 'D&A', 'Capex', 'Δ NWC', 'FCFF', 'PV'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{valuation.result.projections.map(p => <tr key={p.year}>{[p.year,p.revenue,p.ebitda,p.nopat,p.da,p.capex,p.change_nwc,p.free_cash_flow,p.present_value].map((x,i) => <td key={i}>{fmt(x)}</td>)}</tr>)}</tbody></table></div>

      <div className="desk-table"><table><caption>Equity sensitivity · {company.currency} millions</caption><thead><tr><th>Growth / WACC</th>{valuation.result.sensitivity.wacc.map(w => <th key={w}>{fmt(w*100)}%</th>)}</tr></thead><tbody>{valuation.result.sensitivity.equity_values.map((row,i) => <tr key={i}><th>{fmt(valuation.result.sensitivity.terminal_growth[i]*100)}%</th>{row.map((x,j) => <td key={j}>{fmt(x)}</td>)}</tr>)}</tbody></table></div>

      <h3>Trading comps</h3><pre>{JSON.stringify(valuation.result.comps, null, 2)}</pre>{valuation.result.risks.map(r => <p key={r}>{r}</p>)}</section>}

    </>}

    {(section === 'strategy' || section === 'prices') && <>

      <section className="desk-panel"><h2>Historical data & provenance</h2><p>Import CSV or XLSX, map six OHLCV columns, inspect source rows, then validate dates, duplicates and price relationships. Gap warnings are heuristic and can include weekends or holidays; confirm the exchange calendar. Supply timestamp and adjustment conventions explicitly. No artificial bars are inserted.</p><div className="desk-actions"><StrategyDatasetImport onValidated={(csv, quality, provenance) => { setCsvText(csv); setQualityReport(quality); setImportProvenance(provenance) }} /><button disabled={busy} onClick={() => action(async () => { const search=await fetch('/api/v1/search?q=' + encodeURIComponent(symbol)).then(r=>r.json()); const instrument=search.items.find((x: {displaySymbol:string})=>x.displaySymbol===symbol); if(!instrument) throw new Error('Instrument is not in the Go-Terminal universe'); const d=await deskApi('/datasets/from-market/' + instrument.id, {}); setDatasetId(d.id); setMessage('Provider dataset saved') })}>Use Go-Terminal daily history</button></div>

      <div className="desk-fields">{Object.entries(meta).map(([key,value]) => <label key={key}>{label(key)}{key==='frequency' ? <select value={value} onChange={e=>setMeta({...meta,[key]:e.target.value})}>{['1d','1h','15m','1w'].map(x=><option key={x}>{x}</option>)}</select> : <input required value={value} onChange={e=>setMeta({...meta,[key]:e.target.value})} />}</label>)}</div><label>Corporate-action records JSON (optional; disclosure only, never applied to fills)<textarea aria-label="Corporate-action records JSON" className="desk-code" value={corporateActions} onChange={e=>setCorporateActions(e.target.value)} /></label><p>Each record: effective_date, kind (split or cash_dividend), positive value and source. An empty list means no records supplied, not proof that no actions occurred. Verify whether OHLC prices and volume were adjusted consistently; StrategyLab does not repair them.</p><p>{csvText ? `${csvText.trim().split('\n').length - 1} mapped source rows selected` : 'Select and map a sourced CSV or XLSX to import.'}</p>{qualityReport&&<div role="status"><strong>Data quality: {qualityReport.status}</strong><p>{qualityReport.row_count} valid rows · {qualityReport.date_start||'no start'} to {qualityReport.date_end||'no end'} · SHA-256 {qualityReport.file_hash.slice(0,12)}…</p>{qualityReport.issues.map((issue,i)=><p key={i}>{issue.severity}: {issue.message}{issue.row?` (row ${issue.row})`:''}</p>)}</div>}<button disabled={busy || qualityReport?.status!=='valid' || Object.values(meta).some(v=>!v.trim())} onClick={() => action(async()=>{const d=await deskApi('/datasets',{symbol,csv_text:csvText,...meta,import_provenance:Object.keys(importProvenance).length?importProvenance:null,corporate_actions:JSON.parse(corporateActions)}); setDatasetId(d.id); setMessage('Historical snapshot validated and saved')})}>Save validated dataset</button>

      <label>Saved datasets<select value={datasetId} onChange={e=>{setDatasetId(e.target.value);setPriceStats(null)}}><option value="">Select dataset…</option>{datasets.map(d=><option key={d.id} value={d.id}>{d.source} · {d.id.slice(0,8)}</option>)}</select></label>

      {dataset && <><p>{dataset.availability} · {dataset.exchange} · {dataset.currency} · {dataset.frequency}</p><p>Adjustment: {dataset.adjustment_policy}. Timestamp: {dataset.timestamp_policy}</p>{dataset.identity.issues.map((x,i)=><p key={i}>{x.message}</p>)}<label>Chart timeframe<select value={range} onChange={e=>setRange(e.target.value)}>{[['all','All bars'],['252','Last 252 bars'],['63','Last 63 bars']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><Plot values={closeValues} title={`${symbol} historical close`} /><p>Close-to-close price return: {closeValues.length>1 ? fmt((closeValues.at(-1)!/closeValues[0]-1)*100)+'%' : 'Unavailable'} · Excludes distributions unless the source adjusts them.</p><div className="desk-fields"><label>Bars per year for price volatility<input type="number" min="1" max="100000" value={annualBars} onChange={e=>{setAnnualBars(Number(e.target.value));setPriceStats(null)}} /></label><label>Benchmark dataset<select aria-label="Benchmark dataset" value={benchmarkId} onChange={e=>{setBenchmarkId(e.target.value);setPriceStats(null)}}><option value="">No benchmark</option>{allDatasets.filter(x=>x.id!==dataset.id).map(x=><option key={x.id} value={x.id}>{x.symbol} · {x.source}</option>)}</select></label></div><button disabled={busy} onClick={()=>action(async()=>setPriceStats(await deskApi(`/datasets/${dataset.id}/statistics?annual_bars=${annualBars}`+(benchmarkId?'&benchmark_id='+benchmarkId:''))))}>Calculate price risk & comparison</button>{priceStats!==null&&<pre>{JSON.stringify(priceStats,null,2)}</pre>}<details><summary>OHLCV observations</summary><div className="desk-table"><table><thead><tr>{['Timestamp','Open','High','Low','Close','Volume'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{displayRows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></details><Technicals datasetId={dataset.id} onPeriodChange={setIndicatorPeriod} /></>}

      </section>{section==='strategy'&&<><section className="desk-panel"><h2>Moving-average crossover</h2><label><span><input type="checkbox" checked={longOnly} onChange={e=>setLongOnly(e.target.checked)} /> Long/cash only (no shorts)</span></label>{longOnly?<p>Reviewed long/cash rule: +100% exposure when fast SMA exceeds slow SMA; cash otherwise and during warm-up. Original StrategyLab close-signal/next-open simulation and costs. Cash earns zero; no leverage or borrow costs.</p>:<p>Original StrategyLab rule: +100% exposure when fast SMA exceeds slow SMA, −100% otherwise; flat during warm-up. Close signals execute at the next open. Shorts omit borrow costs. Fixed parameters remain unchanged across OOS windows. All results are simulations.</p>}<div className="desk-fields">{Object.entries(settings).map(([key,value])=><label key={key}>{label(key)}<input type="number" step="any" value={value} onChange={e=>setSettings({...settings,[key]:Number(e.target.value)})} /></label>)}</div><label>Predeclared failure criteria JSON<textarea className="desk-code" value={contract} onChange={e=>setContract(e.target.value)} /></label><button disabled={busy || !dataset} onClick={()=>action(async()=>{setExperiment(await deskApi('/experiments',{dataset_id:datasetId,...settings,long_only:longOnly,failure_contract:JSON.parse(contract)})); setMessage('Experiment saved with original engine artifacts')})}>Freeze & run backtest</button>

      <label>Open saved experiment<select value="" onChange={e=>setExperiment(experiments.find(x=>x.id===e.target.value)||null)}><option value="">Select experiment…</option>{experiments.map(x=><option key={x.id} value={x.id}>{x.summary.run_id}</option>)}</select></label></section>

      <StrategyLibrary datasetId={datasetId} settings={settings} contract={contract} experiments={experiments} onSaved={async saved=>{setExperiment(saved as Experiment);await refresh()}} />

      {experiment && <section className="desk-panel"><h2>Simulated results · {experiment.result.verdict.verdict}</h2><p>Contract verdict describes declared criteria, not investment suitability. OOS begins {experiment.result.split.boundary}.</p><div className="desk-metrics">{Object.entries(experiment.result.baseline.metrics).map(([key,value])=><div key={key}><small>{label(key)}</small><strong>{fmt(value)}</strong></div>)}</div><p>Ratios are decimals; total_return 0.10 means 10%. Annualization follows the original engine's median bar spacing and may differ from exchange-calendar conventions.</p><StrategyRunDetails experiment={experiment as unknown as DetailedExperiment} /><details><summary>OOS, walk-forward, cost stress & execution</summary><pre>{JSON.stringify({oos:experiment.result.out_of_sample,walk_forward:experiment.result.walk_forward,cost_stress:experiment.result.cost_stress,execution:experiment.result.execution},null,2)}</pre></details><div className="desk-actions"><a href={`/api/desk/experiments/${experiment.id}/bundle`}>Export reproducible bundle</a><button onClick={()=>{setEntry({...blankEntry(symbol),experiment_id:experiment.id});setEntryId(null);onNavigate('/journal')}}>Write thesis with this experiment</button></div></section>}

    </>}</>}

    {section==='strategy'&&<section className="desk-panel"><h2>Saved strategy comparisons</h2><p>Compare retained results without rerunning. Dataset periods, source adjustments and costs can differ; inspect each run's configuration before comparing.</p><label>Compare against saved experiment<select value={comparisonId} onChange={e=>setComparisonId(e.target.value)}><option value="">Choose another run</option>{experiments.filter(x=>x.id!==experiment?.id).map(x=><option key={x.id} value={x.id}>{x.summary.run_id}</option>)}</select></label>{experiment&&comparisonId&&<div className="desk-table"><table><caption>Simulated baseline metrics · decimal returns</caption><thead><tr><th>Metric</th><th>Selected run</th><th>Comparison run</th></tr></thead><tbody>{Object.entries(experiment.result.baseline.metrics).map(([key,value])=><tr key={key}><th>{label(key)}</th><td>{fmt(value)}</td><td>{fmt(experiments.find(x=>x.id===comparisonId)?.result.baseline.metrics[key])}</td></tr>)}</tbody></table></div>}<details><summary>Selected run and comparison configurations & provenance</summary><pre>{JSON.stringify({selected:experiment,comparison:experiments.find(x=>x.id===comparisonId)},null,2)}</pre></details><p>Option Chain Edge Lab was not found. Advanced options surfaces and brokerage execution are unavailable. Historical Volatility Lens comparisons are in <a href="/portfolio" onClick={e=>{e.preventDefault();onNavigate('/portfolio')}}>Portfolio & Risk Lab</a>.</p></section>}

    {section==='journal' && <div className="desk-journal"><section className="desk-panel"><h2>Saved research</h2><label>Search<input value={query} onChange={e=>setQuery(e.target.value)} /></label><label>Status filter<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{['draft','active','reviewed','archived'].map(x=><option key={x}>{x}</option>)}</select></label><button onClick={()=>{setEntry(blankEntry(symbol));setEntryId(null);setRevisions([])}}>New entry</button>{entries.filter(x=>(!statusFilter||x.status===statusFilter)&&JSON.stringify(x).toLowerCase().includes(query.toLowerCase())).map(x=><button className="desk-entry" key={x.id} onClick={()=>action(async()=>{const {id,created_at,updated_at,...body}=x;setEntry(body);setEntryId(String(id));setRevisions(await deskApi(`/journal/${id}/revisions`))})}><strong>{x.title}</strong><small>{x.status} · Revision {x.version}</small></button>)}</section><section className="desk-panel"><h2>{entryId?'Edit / review entry':'New investment thesis'}</h2><p>Every save creates a retained revision. Reviews add outcomes; original theses remain in history.</p><label>Title<input required value={String(entry.title)} onChange={e=>setEntry({...entry,title:e.target.value})} /></label><div className="desk-fields">{[['status',['draft','active','reviewed','archived']],['category',['fundamental','strategy','combined']],['supported',['pending','yes','no','mixed']]].map(([key,values])=><label key={String(key)}>{label(String(key))}<select aria-label={label(String(key))} value={String(entry[String(key)])} onChange={e=>setEntry({...entry,[String(key)]:e.target.value})}>{(values as string[]).map(x=><option key={x}>{x}</option>)}</select></label>)}</div>{journalFields.map(key=><label key={key}>{label(key)}<textarea required={key==='thesis'} value={String(entry[key]||'')} onChange={e=>setEntry({...entry,[key]:e.target.value})} /></label>)}<label>Saved valuation<select aria-label="Saved valuation" value={String(entry.valuation_id||'')} onChange={e=>setEntry({...entry,valuation_id:e.target.value||null})}><option value="">No valuation attached</option>{valuations.map(v=><option key={v.id} value={v.id}>{v.case} · {v.created_at}</option>)}</select></label><label>Saved strategy experiment<select aria-label="Saved strategy experiment" value={String(entry.experiment_id||'')} onChange={e=>setEntry({...entry,experiment_id:e.target.value||null})}><option value="">No experiment attached</option>{experiments.map(x=><option key={x.id} value={x.id}>{x.summary.run_id}</option>)}</select></label><label>Saved portfolio analysis<select aria-label="Saved portfolio analysis" value={String(entry.portfolio_id||'')} onChange={e=>setEntry({...entry,portfolio_id:e.target.value||null})}><option value="">No portfolio attached</option>{portfolios.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="desk-actions">{entry.valuation_id&&<button onClick={()=>{const v=valuations.find(x=>x.id===entry.valuation_id);if(v){setValuation(v);setCompany({...v.result.company,diluted_shares:v.result.company.diluted_shares??null});setCase(v.case);setAssumptions(v.assumptions_note);onNavigate('/banking')}}}>Open linked valuation</button>}{entry.experiment_id&&<button onClick={()=>{setExperiment(experiments.find(x=>x.id===entry.experiment_id)||null);onNavigate('/quant')}}>Open linked experiment</button>}{entry.portfolio_id&&<button onClick={()=>{localStorage.setItem('researchdesk.openPortfolio',String(entry.portfolio_id));onNavigate('/portfolio')}}>Open linked portfolio</button>}</div><div className="desk-actions"><button disabled={busy||!entry.title||!entry.thesis} onClick={()=>action(async()=>{const saved=await deskApi(entryId?`/journal/${entryId}`:'/journal',entry,entryId?'PUT':'POST'); const {id,created_at,updated_at,...body}=saved;setEntry(body);setEntryId(id);setRevisions(await deskApi(`/journal/${id}/revisions`));setMessage('Research saved; earlier revisions retained')})}>Save research revision</button>{entryId&&<a href={`/api/desk/journal/${entryId}/export`}>Export research & evidence</a>}</div>{revisions.length>0&&<details><summary>Retained history · {revisions.length} revisions</summary>{revisions.map(x=><article key={x.version}><h3>Revision {x.version} · {x.updated_at}</h3><p>Original thesis: {x.thesis}</p><p>Observed outcome: {x.outcome||'Pending'}</p></article>)}</details>}</section></div>}

    {section==='settings'&&<section className="desk-panel"><h2>Local workspace</h2><p>ResearchDesk runs standalone. Go-Terminal, DealLens and StrategyLab are optional local integrations; unavailable engines cannot produce results. Data stays in the ResearchDesk data folder. No brokerage or automatic trading is connected.</p><p>Set SEC_USER_AGENT with your application name and contact email in the launching terminal to enable SEC drafts. Provider credentials remain server-side.</p><button onClick={()=>action(async()=>setHealth(await deskApi('/health')))}>Check storage & connections</button>{health!==null&&<pre>{JSON.stringify(health,null,2)}</pre>}<p>Back up the entire data folder while the app is stopped. Keep datasets, SQLite databases and run artifacts together. Portfolio analytics use a limited historical buy-and-hold model. Volatility Lens serves dated local snapshots; see their current age and evidence gates in Portfolio & Risk.</p></section>}

    {section==='journal' && <section className="desk-panel"><h2>Versioned valuation evidence</h2><label>Frozen FCFF case<select aria-label="Frozen FCFF case" value={String(entry.valuation_case_v2_id||'')} onChange={e=>setEntry({...entry,valuation_case_v2_id:e.target.value||null})}><option value="">No versioned case attached</option>{versionedCases.map(c=><option key={c.id} value={c.id}>{c.inputs.title} · revision {c.case_revision} · {c.id.slice(0,8)}</option>)}</select></label>{entry.valuation_case_v2_id&&<p>Frozen case ID {entry.valuation_case_v2_id}. <a href={`/api/desk/valuation-cases-v2/${entry.valuation_case_v2_id}/export`}>Download inputs, result and provenance</a>.</p>}</section>}
  </main>

}

