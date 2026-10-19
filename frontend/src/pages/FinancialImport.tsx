import { useState } from 'react'
import { deskApi, fmt } from './deskUtils'

type Candidate = { reference: string; label: string; suggested_key: string; raw_values: string[] }
type Document = { filename: string; format: string; candidates: Candidate[]; limitations: string }
type Row = Candidate & { key: string; prior: string; current: string; reviewed: boolean }
type Analysis = { periods: Record<string, Record<string, number | null>>; growth: Record<string, number | null>; discrepancies: Array<{ period: string; identity: string; difference: number }>; methodology: string; currency: string; units: string; source: string }

const formatMetric = (key: string, value: number | null) => value === null ? 'Unavailable'
  : ['gross_margin', 'ebitda_margin', 'ebit_margin', 'net_margin', 'roe_end_equity', 'roic'].includes(key) ? `${fmt(value * 100)}%`
  : key === 'free_cash_flow' ? fmt(value) : `${fmt(value)}×`

const groups: Record<string, 'income_statement' | 'balance_sheet' | 'cash_flow'> = {
  revenue: 'income_statement', cogs: 'income_statement', gross_profit: 'income_statement', operating_expenses: 'income_statement',
  ebitda: 'income_statement', da: 'income_statement', ebit: 'income_statement', interest: 'income_statement', taxes: 'income_statement', net_income: 'income_statement', diluted_shares: 'income_statement',
  cash: 'balance_sheet', receivables: 'balance_sheet', inventory: 'balance_sheet', current_assets: 'balance_sheet', fixed_assets: 'balance_sheet', total_assets: 'balance_sheet', debt: 'balance_sheet', payables: 'balance_sheet', current_liabilities: 'balance_sheet', total_liabilities: 'balance_sheet', shareholders_equity: 'balance_sheet',
  cash_from_operations: 'cash_flow', capex: 'cash_flow', cash_from_investing: 'cash_flow', cash_from_financing: 'cash_flow', change_nwc: 'cash_flow',
  cost_of_sales: 'income_statement', interest_expense: 'income_statement', other_income: 'income_statement', income_tax: 'income_statement',
  other_current_assets: 'balance_sheet', ppe: 'balance_sheet', other_assets: 'balance_sheet', other_current_liabilities: 'balance_sheet', borrowings: 'balance_sheet', finance_lease_liabilities: 'balance_sheet', other_liabilities: 'balance_sheet', equity: 'balance_sheet', total_liabilities_equity: 'balance_sheet',
  cash_capex: 'cash_flow', finance_lease_asset_additions: 'cash_flow', other_operating_cash_flow: 'cash_flow', other_investing_cash_flow: 'cash_flow', borrowings_net_flow: 'cash_flow', finance_lease_principal_repayment: 'cash_flow', dividends: 'cash_flow', repurchases: 'cash_flow', other_financing_cash_flow: 'cash_flow', fx_cash_effect: 'cash_flow', net_change_cash: 'cash_flow', other_ppe_movement: 'cash_flow', other_equity_movement: 'cash_flow', other_borrowings_movement: 'cash_flow', other_lease_movement: 'cash_flow',
}

const simpleNumber = (raw: string) => {
  const value = raw.trim().replaceAll(',', '')
  return /^\(?-?\d+(\.\d+)?\)?$/.test(value) ? String(Number(value.replace(/[()]/g, '')) * (value.startsWith('(') ? -1 : 1)) : ''
}

export function FinancialImport({ symbol, statements, onSaved }: { symbol: string; statements: Array<{id:string;source:string;period_end:string}>; onSaved: () => Promise<void> }) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [source, setSource] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [prior, setPrior] = useState('')
  const [current, setCurrent] = useState('')
  const [notes, setNotes] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function preview(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setMessage(''); setAnalysis(null); setRows([])
    try {
      const body = new FormData()
      Array.from(files).forEach(file => body.append('files', file))
      const response = await fetch('/api/desk/financials/preview', { method: 'POST', body })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Financial preview failed')
      const docs = result.documents as Document[]
      setDocuments(docs)
      setRows(docs.flatMap(doc => doc.candidates.map(candidate => ({ ...candidate, key: candidate.suggested_key,
        prior: simpleNumber(candidate.raw_values[0] || ''), current: simpleNumber(candidate.raw_values[1] || ''), reviewed: false }))))
      setSource(docs.map(doc => doc.filename).join('; '))
      setMessage(`${docs.length} document${docs.length === 1 ? '' : 's'} previewed. Review every selected row, period, unit and sign before saving.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Financial preview failed') }
    finally { setBusy(false) }
  }

  async function save() {
    setBusy(true); setMessage('')
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(prior) || !/^\d{4}-\d{2}-\d{2}$/.test(current) || prior >= current) throw new Error('Enter ordered prior and current fiscal period-end dates.')
      const selected = rows.filter(row => row.reviewed && row.key)
      if (!selected.length) throw new Error('Review and select at least one mapped financial row.')
      const mapped: Record<string, Record<string, [number | null, number | null]>> = { income_statement: {}, balance_sheet: {}, cash_flow: {} }
      for (const row of selected) {
        const group = groups[row.key]
        if (mapped[group][row.key]) throw new Error(`Duplicate mapping for ${row.key}; choose one source row.`)
        const values = [row.prior, row.current].map(value => value.trim() === '' ? null : Number(value)) as [number | null, number | null]
        if (values.every(value => value === null) || values.some(value => value !== null && !Number.isFinite(value))) throw new Error(`Enter a finite value for ${row.key}.`)
        mapped[group][row.key] = values
      }
      const references = selected.map(row => `${row.key}: ${row.reference}`).join('\n')
      const retainedNotes = `${notes.trim()}\nReviewed source references:\n${references}`
      if (retainedNotes.length > 5000) throw new Error('Mapping references exceed the 5,000-character statement note limit; select fewer rows.')
      const saved = await deskApi('/statements', { symbol, currency: currency.toUpperCase(), units: 'millions', source,
        prior_period_end: prior, period_end: current, notes: retainedNotes, ...mapped })
      setAnalysis(await deskApi(`/statements/${saved.id}/analysis`))
      await onSaved()
      setMessage('Reviewed statement snapshot saved. Original upload remains the analyst source; mapped values and references are retained.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Statement could not be saved') }
    finally { setBusy(false) }
  }

  const reviewed = rows.filter(row => row.reviewed).length
  return <section className="desk-panel financial-import"><h2>Import Financials · review before use</h2>
    <p>Upload up to five CSV, XLSX or text-readable PDF files. Suggestions are extracted candidates, not verified financial facts. PDF tables can lose column order; scanned reports require separate OCR. Keep source documents and verify units, fiscal periods, signs, debt and lease treatment.</p>
    <label>Financial statement files<input type="file" accept=".csv,.xlsx,.pdf" multiple onChange={event => preview(event.target.files)} /></label>
    {statements.length > 0 && <label>Open saved statement analysis<select aria-label="Open saved statement analysis" defaultValue="" onChange={event => { if (event.target.value) deskApi(`/statements/${event.target.value}/analysis`).then(setAnalysis).catch(error => setMessage(error.message)) }}><option value="">Choose saved snapshot</option>{statements.map(item => <option key={item.id} value={item.id}>{item.period_end} · {item.source}</option>)}</select></label>}
    {busy && <p role="status">Processing financial documents…</p>}{message && <p role="status" className="desk-message">{message}</p>}
    {documents.length > 0 && <><p>{documents.map(doc => `${doc.filename}: ${doc.candidates.length} candidates`).join(' · ')}</p>
      <div className="desk-fields"><label>Prior period end<input type="date" value={prior} onChange={event => setPrior(event.target.value)} /></label><label>Current period end<input type="date" value={current} onChange={event => setCurrent(event.target.value)} /></label><label>Currency<input value={currency} maxLength={3} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label><label>Source document(s)<input value={source} onChange={event => setSource(event.target.value)} /></label></div>
      <p>Statement values must be in <strong>millions of {currency}</strong>. Convert source units manually and verify whether CapEx is positive spending. Suggested column order is not trusted until you review it.</p>
      <label>Mapping and unit notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <details open><summary>Review extracted candidates · {reviewed} selected</summary><div className="desk-table"><table><thead><tr><th>Use</th><th>Source reference and original text</th><th>Map to</th><th>{prior || 'Prior'} · millions</th><th>{current || 'Current'} · millions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.reference}-${index}`}><td><input type="checkbox" aria-label={`Review ${row.reference}`} checked={row.reviewed} onChange={event => setRows(rows.map((item, i) => i === index ? { ...item, reviewed: event.target.checked } : item))} /></td><td>{row.reference}<br /><small>{row.label} · Raw: {row.raw_values.join(' | ')}</small></td><td><select aria-label={`Map ${row.reference}`} value={row.key} onChange={event => setRows(rows.map((item, i) => i === index ? { ...item, key: event.target.value } : item))}>{Object.keys(groups).map(key => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}</select></td><td><input type="number" step="any" aria-label={`Prior ${row.reference}`} value={row.prior} onChange={event => setRows(rows.map((item, i) => i === index ? { ...item, prior: event.target.value } : item))} /></td><td><input type="number" step="any" aria-label={`Current ${row.reference}`} value={row.current} onChange={event => setRows(rows.map((item, i) => i === index ? { ...item, current: event.target.value } : item))} /></td></tr>)}</tbody></table></div></details>
      <button disabled={busy || !reviewed || !source.trim() || !notes.trim()} onClick={save}>Save reviewed statement snapshot</button></>}
    {analysis && <><h3>Historical financial analysis</h3><p>Source: {analysis.source} · Values in {analysis.currency} {analysis.units}. {analysis.methodology}</p>{analysis.discrepancies.length > 0 && <div role="alert">{analysis.discrepancies.map((item, i) => <p key={i}>{item.period}: {item.identity} differs by {fmt(item.difference)} {analysis.currency} {analysis.units}.</p>)}</div>}<div className="desk-table"><table><thead><tr><th>Metric</th>{Object.keys(analysis.periods).map(period => <th key={period}>{period}</th>)}</tr></thead><tbody>{Object.keys(Object.values(analysis.periods)[0] || {}).map(key => <tr key={key}><th>{key.replaceAll('_', ' ')}{key === 'free_cash_flow' ? ` · ${analysis.currency} ${analysis.units}` : ''}</th>{Object.values(analysis.periods).map((period, i) => <td key={i}>{formatMetric(key, period[key])}</td>)}</tr>)}</tbody></table></div><p>Growth: {Object.entries(analysis.growth).map(([key, value]) => `${key.replaceAll('_', ' ')} ${value == null ? 'unavailable' : `${fmt(value * 100)}%`}`).join(' · ')}</p></>}
  </section>
}
