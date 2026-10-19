import { useMemo, useState } from 'react'
import { deskApi, fmt } from './deskUtils'
import { TrustedEvidenceReview } from './TrustedEvidenceReview'
import {
  applyUploadMappings, draftReview, emptyCase, evidenceFromUpload, prepareCase, rawNumber,
  REQUIRED_FIELDS, SCHEDULES, suggestedField, withCashScope,
  type Candidate, type Evidence, type EvidenceState, type HistoricalCase,
  type Reconciliation, type ScheduleMode, type UploadDocument,
} from './v2EvidenceCase'

const label = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' · ')
const statuses: EvidenceState[] = ['audited', 'derived', 'unavailable', 'not_applicable']

export function EvidenceReviewV2({ symbol }: { symbol: string }) {
  const [draft, setDraft] = useState<HistoricalCase>(() => emptyCase(symbol))
  const [documents, setDocuments] = useState<UploadDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Reconciliation | null>(null)
  const [snapshotHash, setSnapshotHash] = useState('')
  const [yearIndex, setYearIndex] = useState(0)
  const [trail, setTrail] = useState<string[]>([])
  const [fieldName, setFieldName] = useState('')
  const [fieldState, setFieldState] = useState<EvidenceState>('audited')
  const [fieldValue, setFieldValue] = useState('')
  const [fieldDefinition, setFieldDefinition] = useState('')
  const [fieldReason, setFieldReason] = useState('')
  const [formulaOp, setFormulaOp] = useState<'add' | 'subtract'>('add')
  const [formulaOperands, setFormulaOperands] = useState('')
  const [sourceIndex, setSourceIndex] = useState('')
  const [sourceLocator, setSourceLocator] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [conventionNotes, setConventionNotes] = useState<Record<string, string>>({})
  const [reviewToken, setReviewToken] = useState('')

  const visible = useMemo(() => withCashScope(draft), [draft])
  const active = visible.periods[Math.min(yearIndex, visible.periods.length - 1)]
  const allDates = [visible.opening_cash.period_end, ...visible.periods.map(row => row.period_end)].filter(Boolean)
  const requiredMissing = visible.periods.reduce((count, row) =>
    count + REQUIRED_FIELDS.filter(key => !row.fields[key]).length, 0)

  function changed(next: HistoricalCase, note?: string) {
    setDraft(next); setResult(null); setSnapshotHash('')
    if (note) setTrail(items => [...items, `${new Date().toISOString()} · ${note}`])
  }

  function updatePeriod(index: number, periodEnd: string) {
    const next = structuredClone(draft)
    next.periods[index].period_end = periodEnd
    changed(next, `Fiscal end ${index + 1} set to ${periodEnd || 'blank'}`)
  }

  function updateDocument(index: number, updater: (doc: UploadDocument) => UploadDocument) {
    setDocuments(items => items.map((item, i) => i === index ? updater(item) : item))
    setResult(null); setSnapshotHash('')
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setMessage(''); setResult(null); setSnapshotHash('')
    try {
      if (files.length > 5) throw new Error('Choose no more than five documents at once.')
      const chosen = Array.from(files)
      const hashes = await Promise.all(chosen.map(async file => {
        const bytes = await file.arrayBuffer()
        const value = await crypto.subtle.digest('SHA-256', bytes)
        return Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('')
      }))
      let returned: Array<{ filename: string; format: string; candidates: Candidate[]; limitations: string; staged?: boolean }> = []
      if (reviewToken) {
        for (const [index, file] of chosen.entries()) {
          const body = new FormData(); body.append('file', file)
          const response = await fetch('/api/desk/three-statement-v2/staging/documents', {
            method: 'POST', body, headers: { Authorization: `Bearer ${reviewToken}`, 'X-Document-SHA256': hashes[index] },
          })
          const data = await response.json()
          if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Trusted staging rejected the file.')
          if (data.sha256 !== hashes[index] || !data.byte_verified) throw new Error('Server file digest did not match this upload.')
          returned.push({ ...data.document, staged: true })
        }
      } else {
        const body = new FormData(); chosen.forEach(file => body.append('files', file))
        const response = await fetch('/api/desk/financials/preview', { method: 'POST', body })
        const data = await response.json()
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Document extraction failed.')
        returned = data.documents
      }
      const incoming = returned.map((doc, index) => {
        const columns = Math.min(5, Math.max(1, ...doc.candidates.map(row => row.raw_values.length)))
        return { ...doc, hash: hashes[index], columnPeriods: Array(columns).fill(''), unitsConfirmed: false, unitBasis: '', selected: {} } satisfies UploadDocument
      })
      setDocuments(incoming)
      setMessage(`${incoming.length} document(s) inspected${reviewToken ? ' and byte-verified by isolated staging' : ' locally'}. Assign fiscal dates and verify each extracted line against its source before mapping.`)
      setTrail(items => [...items, `${new Date().toISOString()} · Inspected ${incoming.map(item => `${item.filename}#${item.hash.slice(0, 12)}`).join(', ')}`])
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Document extraction failed.') }
    finally { setBusy(false) }
  }

  async function importCase(file: File | undefined) {
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as HistoricalCase
      if (imported.symbol !== symbol || imported.version !== '2.0' ||
          !Array.isArray(imported.periods) || imported.periods.length < 3 || imported.periods.length > 5)
        throw new Error('Choose a three-to-five-year v2 case for the selected instrument.')
      changed(imported, `Imported read-only draft ${file.name}`)
      setDocuments([]); setYearIndex(0); setConventionNotes({})
      setMessage('Evidence case loaded for inspection. Imported review names are not authenticated production approvals.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read evidence case.') }
  }

  function applyMappings() {
    try {
      const next = applyUploadMappings(draft, documents)
      changed(next, 'Applied browser-checked upload mappings; source support unverified')
      setMessage('Mapped values are now visible in the evidence ledger. Compare source scopes and add missing or derived fields before reconciliation.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not apply mappings.') }
  }

  function saveField() {
    try {
      const field = fieldName.trim()
      if (!field || !/^(opening\.(balance_cash|cash_flow_cash)|(?:income|balance|cash_flow|cash_scope|lease|debt|equity|ppe|raw)\.[a-z0-9_.]+)$/.test(field))
        throw new Error('Enter a valid v2 field name, such as balance.cash or raw.vendor_receivables.')
      const periodEnd = field.startsWith('opening.') ? draft.opening_cash.period_end : active.period_end
      if (!periodEnd) throw new Error('Set the fiscal date before editing evidence.')
      const amount = fieldState === 'unavailable' || fieldState === 'not_applicable' ? null : Number(fieldValue)
      if (amount !== null && (!fieldValue.trim() || !Number.isFinite(amount))) throw new Error('Enter a finite numeric value.')
      if ((fieldState === 'unavailable' || fieldState === 'not_applicable') && !fieldReason.trim())
        throw new Error('Explain why this component is unavailable or not applicable.')
      const operands = formulaOperands.split(',').map(item => item.trim()).filter(Boolean)
        .map(item => item.includes(':') ? item : `${periodEnd}:${item}`)
      if (fieldState === 'derived' && (operands.length < 2 || (formulaOp === 'subtract' && operands.length !== 2)))
        throw new Error('A derived value needs two or more dependencies; subtraction needs exactly two.')
      const document = sourceIndex === '' ? null : documents[Number(sourceIndex)]
      if (fieldState === 'audited' && (!sourceLocator.trim() || (!document && !sourceUrl.startsWith('https://'))))
        throw new Error('An audited claim needs an uploaded document or HTTPS filing URL and an exact locator.')
      const source = fieldState === 'audited' ? [{
        document_id: document ? `${document.filename}#${document.hash.slice(0, 12)}` : sourceUrl,
        url: document ? `urn:sha256:${document.hash}` : sourceUrl,
        ...(document ? { document_sha256: document.hash } : {}),
        locator: sourceLocator, reported_value: amount as number,
        period_end: periodEnd, currency: draft.currency, units: 'millions' as const, scope: field,
      }] : []
      const evidence: Evidence = { state: fieldState, value: amount, period_end: periodEnd,
        currency: draft.currency, units: 'millions', scope: field,
        definition: fieldDefinition.trim() || label(field), sources: source,
        formula: fieldState === 'derived' ? { operation: formulaOp, operands } : null,
        review: fieldState === 'audited' || fieldState === 'derived'
          ? draftReview('Browser-only evidence classification; independent source review pending.') : null,
        reason: fieldState === 'unavailable' || fieldState === 'not_applicable' ? fieldReason.trim() : null,
        component_ids: [] }
      const next = structuredClone(draft)
      if (field === 'opening.balance_cash') next.opening_cash.balance_cash = evidence
      else if (field === 'opening.cash_flow_cash') next.opening_cash.cash_flow_cash = evidence
      else next.periods[yearIndex].fields[field] = evidence
      changed(next, `${periodEnd} ${field} classified ${fieldState}`)
      setMessage(`${field} updated in the read-only draft. Its source and calculation appear in the ledger.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update evidence.') }
  }

  function convention(index: number, schedule: string, mode: ScheduleMode | '') {
    const next = structuredClone(draft)
    if (!mode) delete next.periods[index].conventions[schedule]
    else next.periods[index].conventions[schedule] = {
      mode, scope: `${schedule} ${next.periods[index].period_end || 'undated'} disclosure perimeter`,
      review: draftReview(conventionNotes[schedule] || ''),
    }
    changed(next, `${next.periods[index].period_end} ${schedule} mode ${mode || 'unset'}`)
  }

  function conventionRationale(schedule: string, value: string) {
    setConventionNotes(notes => ({ ...notes, [schedule]: value }))
    const next = structuredClone(draft)
    next.periods.forEach(row => {
      if (row.conventions[schedule]) row.conventions[schedule].review = draftReview(value)
    })
    changed(next, `${schedule} convention explanation edited`)
  }

  async function reconcile() {
    setBusy(true); setMessage(''); setSnapshotHash('')
    try {
      const prepared = prepareCase(draft)
      const checked = await deskApi('/three-statement-v2/historical/reconcile', prepared) as Reconciliation
      setResult(checked)
      if (checked.status === 'accepted') {
        const preview = await deskApi('/three-statement-v2/historical/accept', prepared) as { history_hash: string; persistent: boolean; valuation_authorized: boolean }
        if (preview.persistent || preview.valuation_authorized) throw new Error('Unexpected persistence or valuation authorization in preview.')
        setSnapshotHash(preview.history_hash)
        setMessage('Historical arithmetic passes. This is a read-only candidate; reviewer authentication and disclosure verification remain open.')
      } else setMessage(`${checked.issues.length} historical issue(s) need review. No case was saved.`)
      setTrail(items => [...items, `${new Date().toISOString()} · Reconciliation ${checked.status}: ${checked.issues.length} issues`])
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Historical reconciliation failed.') }
    finally { setBusy(false) }
  }

  function downloadPreview() {
    const payload = { case: visible, reconciliation: result, local_audit_trail: trail,
      warning: 'Browser-only evidence preview. Reviewer identities and source claims are unverified. Not a saved case.' }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    link.download = `${symbol}-historical-v2-preview.json`
    link.click(); URL.revokeObjectURL(link.href)
  }

  return <section className="desk-panel evidence-v2" aria-labelledby="evidence-v2-title">
    <div className="evidence-v2-head"><div><p className="desk-eyebrow">INVESTMENT BANKING · HISTORICAL EVIDENCE</p><h2 id="evidence-v2-title">Three-statement v2 review</h2></div><span className="evidence-v2-readonly">Read-only preview</span></div>
    <p>Take a filing from extracted lines to a reconciled historical evidence draft. This workspace does not save a case or authorize a valuation. Browser-entered review names and source claims are provisional until independently verified.</p>
    <ol className="evidence-v2-steps" aria-label="Evidence workflow"><li>Import</li><li>Map & inspect</li><li>Reconcile</li><li>Preview</li></ol>
    {message && <p role="status" className="desk-message">{message}</p>}

    <details open><summary>1 · Import reports and set fiscal periods</summary>
      <div className="desk-fields"><label>Audited reports or workbooks<input aria-label="V2 financial files" type="file" accept=".csv,.xlsx,.pdf" multiple onChange={event => upload(event.target.files)} /></label><label>Open an isolated v2 evidence JSON<input aria-label="Open v2 evidence JSON" type="file" accept=".json" onChange={event => importCase(event.target.files?.[0])} /></label></div>
      <p>CSV, XLSX and text-readable PDF extraction only suggests rows. Scanned PDFs need OCR outside this screen. With an isolated reviewer connection, the backend verifies file bytes and stages the original outside production data. Otherwise upload remains a browser draft. Amounts must be reviewed in {draft.currency} millions.</p>
      <div className="desk-fields"><label>Opening fiscal date<input aria-label="Opening fiscal date" type="date" value={draft.opening_cash.period_end} onChange={event => changed({ ...draft, opening_cash: { ...draft.opening_cash, period_end: event.target.value } }, 'Opening fiscal date edited')} /></label><label>Currency<input aria-label="V2 currency" maxLength={3} value={draft.currency} onChange={event => changed({ ...draft, currency: event.target.value.toUpperCase() }, 'Currency edited')} /></label></div>
      <div className="evidence-v2-years">{draft.periods.map((row, index) => <label key={index}>Fiscal year {index + 1} end<input aria-label={`Fiscal year ${index + 1} end`} type="date" value={row.period_end} onChange={event => updatePeriod(index, event.target.value)} /></label>)}</div>
      <div className="desk-actions"><button type="button" disabled={draft.periods.length >= 5} onClick={() => changed({ ...draft, periods: [...draft.periods, { period_start: '', period_end: '', fields: {}, conventions: {} }] }, 'Fiscal year added')}>Add fiscal year</button><button type="button" disabled={draft.periods.length <= 3} onClick={() => { changed({ ...draft, periods: draft.periods.slice(0, -1) }, 'Last fiscal year removed'); setYearIndex(0) }}>Remove last year</button></div>
      {documents.map((doc, index) => <details key={`${doc.filename}-${doc.hash}`} open={index === 0}><summary>{doc.filename} · {doc.candidates.length} candidate lines · SHA-256 {doc.hash.slice(0, 12)}…</summary>
        <p>{doc.limitations}</p><p>Possible years in filename: {doc.filename.match(/20\d{2}/g)?.join(', ') || 'none'}. Assign actual fiscal dates to the extracted columns.</p>
        <label>Source units and conversion into {draft.currency} millions<input aria-label={`${doc.filename} unit basis`} value={doc.unitBasis} onChange={event => updateDocument(index, item => ({ ...item, unitBasis: event.target.value, unitsConfirmed: false }))} placeholder="e.g. filing USD thousands ÷ 1,000; reviewed in source table" /></label>
        <label className="evidence-v2-unit-check"><input aria-label={`${doc.filename} amounts verified in millions`} type="checkbox" checked={doc.unitsConfirmed} onChange={event => updateDocument(index, item => ({ ...item, unitsConfirmed: event.target.checked }))} /> I checked the source units, currency and any conversion; entered amounts are in {draft.currency} millions.</label>
        <div className="evidence-v2-years">{doc.columnPeriods.map((date, column) => <label key={column}>Column {column + 1} fiscal end<select aria-label={`${doc.filename} column ${column + 1} fiscal end`} value={date} onChange={event => updateDocument(index, item => ({ ...item, columnPeriods: item.columnPeriods.map((value, i) => i === column ? event.target.value : value) }))}><option value="">Choose period</option>{allDates.map(day => <option key={day} value={day}>{day}{day === draft.opening_cash.period_end ? ' · opening' : ''}</option>)}</select></label>)}</div>
        <div className="desk-table"><table><thead><tr><th>Source line</th><th>Reviewed</th><th>Map to v2 field</th>{doc.columnPeriods.map((_, column) => <th key={column}>Column {column + 1} · millions</th>)}</tr></thead><tbody>{doc.candidates.map((candidate, rowIndex) => {
          const selected = doc.selected[rowIndex] || { field: suggestedField(candidate.suggested_key), checked: false, values: doc.columnPeriods.map((_, i) => rawNumber(candidate.raw_values[i] || '')) }
          const change = (patch: Partial<typeof selected>) => updateDocument(index, item => ({ ...item, selected: { ...item.selected, [rowIndex]: { ...selected, ...patch } } }))
          return <tr key={`${candidate.reference}-${rowIndex}`}><th scope="row">{candidate.reference}<br /><small>{candidate.label}<br />Original: {candidate.raw_values.join(' | ')}</small></th><td><input aria-label={`Source checked ${candidate.reference}`} type="checkbox" checked={selected.checked} onChange={event => change({ checked: event.target.checked })} /></td><td><input aria-label={`Map ${candidate.reference}`} list="v2-field-options" value={selected.field} onChange={event => change({ field: event.target.value })} /></td>{doc.columnPeriods.map((_, column) => <td key={column}><input aria-label={`${candidate.reference} column ${column + 1} amount`} type="number" step="any" value={selected.values[column] || ''} onChange={event => change({ values: selected.values.map((value, i) => i === column ? event.target.value : value) })} /></td>)}</tr>
        })}</tbody></table></div>
      </details>)}
      <datalist id="v2-field-options">{[...REQUIRED_FIELDS, 'opening.balance_cash', 'opening.cash_flow_cash', 'lease.finance_additions', 'lease.finance_principal'].map(field => <option key={field} value={field} />)}</datalist>
      {documents.length > 0 && <button type="button" disabled={busy} onClick={applyMappings}>Apply checked draft mappings</button>}
    </details>

    <TrustedEvidenceReview draft={visible} documents={documents} token={reviewToken} onToken={setReviewToken} />

    <details open><summary>2 · Inspect values, sources and classifications</summary>
      <p>{requiredMissing} mandatory year-field slots lack evidence. Missing is different from zero; aggregate schedule mode can leave optional gross components unavailable.</p>
      <p>Opening cash: balance sheet {visible.opening_cash.balance_cash?.value == null ? 'missing' : fmt(visible.opening_cash.balance_cash.value)}; cash flow {visible.opening_cash.cash_flow_cash?.value == null ? 'missing' : fmt(visible.opening_cash.cash_flow_cash.value)} ({draft.currency} millions). Each opening amount also requires its own dated source.</p>
      <label>Inspect fiscal year<select aria-label="Inspect fiscal year" value={yearIndex} onChange={event => setYearIndex(Number(event.target.value))}>{visible.periods.map((row, index) => <option key={index} value={index}>{row.period_end || `Year ${index + 1} · date needed`}</option>)}</select></label>
      <div className="desk-table"><table><thead><tr><th>Field</th><th>Value · {draft.currency} m</th><th>Class</th><th>Source / calculation</th><th>Evidence hash</th></tr></thead><tbody>{(['opening.balance_cash', 'opening.cash_flow_cash'] as const).map(field => {
        const item = field === 'opening.balance_cash' ? visible.opening_cash.balance_cash : visible.opening_cash.cash_flow_cash
        return <tr key={field}><th scope="row">{field}</th><td>{item?.value == null ? '—' : fmt(item.value)}</td><td><span className={`evidence-state evidence-state--${item?.state || 'missing'}`}>{item?.state || 'missing'}</span></td><td>{item ? <>{item.period_end} · {item.currency} {item.units} · {item.definition}{item.sources.map(source => <small key={`${source.document_id}-${source.locator}`}><br />{source.document_id} · {source.locator} · {source.url}</small>)}</> : 'No mapped observation'}</td><td>{result?.field_hashes[`${visible.opening_cash.period_end}:${field}`]?.slice(0, 12) || '—'}</td></tr>
      })}{[...new Set([...REQUIRED_FIELDS, ...Object.keys(active.fields)])].map(field => {
        const item = active.fields[field]
        return <tr key={field}><th scope="row">{field}</th><td>{item?.value == null ? '—' : fmt(item.value)}</td><td><span className={`evidence-state evidence-state--${item?.state || 'missing'}`}>{item?.state || 'missing'}</span></td><td>{item ? <><span>{item.period_end} · {item.currency} {item.units} · {item.definition}</span>{item.sources.map(source => <small key={`${source.document_id}-${source.locator}`}><br />{source.document_id} · {source.locator} · {source.url}</small>)}{item.formula && <small><br />{item.formula.operation}({item.formula.operands.join(', ')})</small>}{item.reason && <small><br />{item.reason}</small>}</> : 'No mapped observation'}{result?.source_lineage[`${active.period_end}:${field}`]?.length ? <small><br />Lineage: {result.source_lineage[`${active.period_end}:${field}`].join(', ')}</small> : null}</td><td>{result?.field_hashes[`${active.period_end}:${field}`]?.slice(0, 12) || '—'}</td></tr>
      })}</tbody></table></div>
      <h3>Classify or correct one field</h3>
      <div className="desk-fields"><label>V2 field<input aria-label="V2 field name" list="v2-field-options" value={fieldName} onChange={event => setFieldName(event.target.value)} /></label><label>Evidence class<select aria-label="Evidence class" value={fieldState} onChange={event => setFieldState(event.target.value as EvidenceState)}>{statuses.map(state => <option key={state}>{state}</option>)}</select></label>{!['unavailable', 'not_applicable'].includes(fieldState) && <label>Value · {draft.currency} millions<input aria-label="V2 field value" type="number" step="any" value={fieldValue} onChange={event => setFieldValue(event.target.value)} /></label>}<label>Definition<input aria-label="V2 field definition" value={fieldDefinition} onChange={event => setFieldDefinition(event.target.value)} /></label></div>
      {fieldState === 'audited' && <div className="desk-fields"><label>Uploaded source file<select aria-label="V2 source file" value={sourceIndex} onChange={event => setSourceIndex(event.target.value)}><option value="">Use filing URL</option>{documents.map((doc, index) => <option key={doc.hash} value={index}>{doc.filename} · {doc.hash.slice(0, 12)}</option>)}</select></label>{sourceIndex === '' && <label>HTTPS filing URL<input aria-label="V2 filing URL" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label>}<label>Exact page, note or cell<input aria-label="V2 source locator" value={sourceLocator} onChange={event => setSourceLocator(event.target.value)} /></label></div>}
      {fieldState === 'derived' && <div className="desk-fields"><label>Formula<select aria-label="V2 formula operation" value={formulaOp} onChange={event => setFormulaOp(event.target.value as 'add' | 'subtract')}><option value="add">Add</option><option value="subtract">Subtract</option></select></label><label>Dependencies, comma separated<input aria-label="V2 formula dependencies" placeholder="raw.cash, balance.cash" value={formulaOperands} onChange={event => setFormulaOperands(event.target.value)} /></label></div>}
      {(fieldState === 'unavailable' || fieldState === 'not_applicable') && <label>Why absent<input aria-label="V2 absence reason" value={fieldReason} onChange={event => setFieldReason(event.target.value)} /></label>}
      <button type="button" onClick={saveField}>Update draft evidence</button>
    </details>

    <details open><summary>3 · Review historical accounting conventions</summary>
      <p>Select each schedule mode for each year. The explanation is retained in the browser draft; it is not an authenticated approval. Disaggregated modes require the supporting gross components.</p>
      <div className="desk-table"><table><thead><tr><th>Schedule and explanation</th>{draft.periods.map((row, index) => <th key={index}>{row.period_end || `Year ${index + 1}`}</th>)}</tr></thead><tbody>{SCHEDULES.map(schedule => <tr key={schedule}><th scope="row">{label(schedule)}<textarea aria-label={`${schedule} convention rationale`} value={conventionNotes[schedule] || active.conventions[schedule]?.review.rationale || ''} onChange={event => conventionRationale(schedule, event.target.value)} placeholder="Explain why this disclosure level is appropriate" /></th>{draft.periods.map((row, index) => <td key={index}><select aria-label={`${schedule} mode ${row.period_end || `year ${index + 1}`}`} value={row.conventions[schedule]?.mode || ''} onChange={event => convention(index, schedule, event.target.value as ScheduleMode | '')}><option value="">Choose mode</option><option value="reported_aggregate">Reported aggregate</option><option value="disaggregated">Disaggregated</option></select></td>)}</tr>)}</tbody></table></div>
      <label>Historical evidence scope and unresolved questions<textarea aria-label="V2 case notes" value={draft.notes} onChange={event => changed({ ...draft, notes: event.target.value }, 'Case notes edited')} /></label>
    </details>

    <details open><summary>4 · Reconcile and preview historical acceptance</summary>
      <div className="desk-actions"><button type="button" disabled={busy} onClick={reconcile}>Run read-only reconciliation</button>{result && <button type="button" onClick={downloadPreview}>Download evidence preview</button>}</div>
      {busy && <p role="status">Checking evidence and accounting identities…</p>}
      {result && <><div className="evidence-v2-result"><strong>{result.status === 'accepted' ? 'Historical arithmetic ready' : 'Historical evidence blocked'}</strong><span>{result.checks.length} passing checks · {result.issues.length} issues</span><small>Version {result.calculation_version} · {snapshotHash ? `candidate SHA-256 ${snapshotHash}` : 'no accepted preview hash'}</small></div>
        <p>Source support and reviewer identity remain unverified. No production record or valuation approval was created.</p>
        <h3>Cash-scope bridge</h3><div className="desk-table"><table><thead><tr><th>Fiscal end</th><th>Balance cash</th><th>Cash-flow cash</th><th>Difference</th><th>Check</th></tr></thead><tbody>{visible.periods.map(row => <tr key={row.period_end}><th scope="row">{row.period_end}</th><td>{fmt(row.fields['balance.cash']?.value)}</td><td>{fmt(row.fields['cash_flow.end_cash']?.value)}</td><td>{fmt(row.fields['cash_scope.difference']?.value)}</td><td>{result.checks.some(item => item.period === row.period_end && item.code === 'cash_scope') ? 'Pass' : 'Review'}</td></tr>)}</tbody></table></div>
        <details open={result.issues.length > 0}><summary>Discrepancies and unsupported components · {result.issues.length}</summary>{result.issues.length ? <div className="desk-table"><table><thead><tr><th>Period</th><th>Issue</th><th>Detail</th></tr></thead><tbody>{result.issues.map((issue, index) => <tr key={index}><td>{issue.period}</td><td>{issue.code}</td><td>{issue.detail || 'Review evidence and mapping'}</td></tr>)}</tbody></table></div> : <p>None in the submitted historical contract.</p>}</details>
        <details><summary>Passing accounting checks · {result.checks.length}</summary><div className="desk-table"><table><thead><tr><th>Period</th><th>Check</th><th>Value</th></tr></thead><tbody>{result.checks.map((check, index) => <tr key={index}><td>{check.period}</td><td>{check.code}</td><td>{check.value}</td></tr>)}</tbody></table></div></details>
      </>}
      {trail.length > 0 && <details><summary>Local draft audit trail · {trail.length} events</summary><ol>{trail.map((event, index) => <li key={index}>{event}</li>)}</ol></details>}
    </details>
  </section>
}
