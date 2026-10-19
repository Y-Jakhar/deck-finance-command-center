import { useMemo, useState } from 'react'
import { prepareCase, SCHEDULES, type Evidence, type HistoricalCase, type UploadDocument } from './v2EvidenceCase'

type Event = { seq: number; target_kind: string; target_key: string; decision: string; reviewer: string; created_at: string; note: string; event_hash: string }
type Readiness = { source_verified: boolean; field_mapping_reviewed: boolean; accounting_convention_approved: boolean; historical_ready_for_acceptance: boolean; valuation_ready_for_review: boolean; missing_sources: string[]; missing_fields: string[]; missing_conventions: string[]; accounting_issues: Array<{ code: string; detail: string }>; persistent: boolean }

const base = '/api/desk/three-statement-v2/staging'

async function stageApi(path: string, token: string, body?: unknown) {
  const response = await fetch(base + path, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
  return data
}

function fieldRows(draft: HistoricalCase): Array<{ key: string; field: string; evidence: Evidence }> {
  const opening = [
    { field: 'opening.balance_cash', evidence: draft.opening_cash.balance_cash },
    { field: 'opening.cash_flow_cash', evidence: draft.opening_cash.cash_flow_cash },
  ].filter((row): row is { field: string; evidence: Evidence } => Boolean(row.evidence))
    .map(row => ({ ...row, key: `${draft.opening_cash.period_end}:${row.field}` }))
  return [...opening, ...draft.periods.flatMap(period => Object.entries(period.fields).map(([field, evidence]) =>
    ({ key: `${period.period_end}:${field}`, field, evidence })))]
}

export function TrustedEvidenceReview({ draft, documents, token, onToken }: {
  draft: HistoricalCase; documents: UploadDocument[]; token: string; onToken: (value: string) => void
}) {
  const [identity, setIdentity] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [docIndex, setDocIndex] = useState(0)
  const [fieldKey, setFieldKey] = useState('')
  const [candidateReference, setCandidateReference] = useState('')
  const [valueIndex, setValueIndex] = useState(0)
  const [sourceUnits, setSourceUnits] = useState('millions')
  const [sourcePeriod, setSourcePeriod] = useState('')
  const [sourceCurrency, setSourceCurrency] = useState('')
  const [section, setSection] = useState('income')
  const [scheduleKey, setScheduleKey] = useState('')
  const [note, setNote] = useState('')
  const [originalInspected, setOriginalInspected] = useState(false)
  const [originChecked, setOriginChecked] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const staged = documents.filter(item => item.staged)
  const selectedDocument = staged[Math.min(docIndex, staged.length - 1)]
  const fields = useMemo(() => fieldRows(draft), [draft])
  const selectedField = fields.find(item => item.key === fieldKey)
  const conventions = draft.periods.filter(period => period.period_end).flatMap(period => SCHEDULES.map(schedule =>
    ({ key: `${period.period_end}:${schedule}`, period_end: period.period_end, schedule,
       convention: period.conventions[schedule] })))
  const selectedConvention = conventions.find(item => item.key === scheduleKey)
  const selectedCandidate = selectedDocument?.candidates.find(item => item.reference === candidateReference)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('')
    try {
      await action()
      setMessage(success)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review request failed.') }
    finally { setBusy(false) }
  }

  async function refreshHistory() {
    if (!token) return
    const data = await stageApi('/history', token) as { events: Event[] }
    setEvents(data.events)
  }

  async function connect() {
    await run(async () => {
      const data = await stageApi('/identity', token) as { reviewer: string }
      setIdentity(data.reviewer)
      await refreshHistory()
    }, 'Isolated reviewer identity verified by the server. Decisions remain outside production records.')
  }

  async function reviewSource(decision: 'approve' | 'reject') {
    if (!selectedDocument) return
    await run(async () => {
      await stageApi('/source-review', token, { document_sha256: selectedDocument.hash, decision, note,
        original_inspected: originalInspected, issuer_or_auditor_origin_checked: originChecked })
      await refreshHistory(); setReadiness(null)
    }, `Source ${decision === 'approve' ? 'inspection recorded' : 'rejected'} in isolated history.`)
  }

  async function reviewField(decision: 'approve' | 'reject') {
    if (!selectedField) return
    await run(async () => {
      await stageApi('/field-review', token, {
        decision, note, field: selectedField.field, evidence: selectedField.evidence,
        document_sha256: selectedField.evidence.state === 'audited' ? selectedDocument?.hash : null,
        candidate_reference: selectedField.evidence.state === 'audited' ? candidateReference : null,
        value_index: valueIndex, source_units: selectedField.evidence.state === 'audited' ? sourceUnits : null,
        source_currency: selectedField.evidence.state === 'audited' ? sourceCurrency || selectedField.evidence.currency : null,
        source_period_end: selectedField.evidence.state === 'audited' ? sourcePeriod || selectedField.evidence.period_end : null,
        statement_section: selectedField.evidence.state === 'audited' ? section : null,
      })
      await refreshHistory(); setReadiness(null)
    }, `Field ${decision === 'approve' ? 'mapping approved' : 'claim rejected'} in isolated history.`)
  }

  async function reviewConvention(decision: 'approve' | 'reject') {
    if (!selectedConvention?.convention) return
    await run(async () => {
      await stageApi('/convention-review', token, { decision, note,
        period_end: selectedConvention.period_end, schedule: selectedConvention.schedule,
        convention: selectedConvention.convention })
      await refreshHistory(); setReadiness(null)
    }, `Convention ${decision === 'approve' ? 'approved' : 'rejected'} in isolated history.`)
  }

  async function checkReadiness() {
    await run(async () => {
      const result = await stageApi('/readiness', token, prepareCase(draft)) as Readiness
      if (result.persistent) throw new Error('Unexpected production persistence flag.')
      setReadiness(result)
    }, 'Historical readiness recalculated from staged decisions and v2 accounting checks.')
  }

  async function downloadOriginal() {
    if (!selectedDocument) return
    await run(async () => {
      const response = await fetch(`${base}/documents/${selectedDocument.hash}/original`,
        { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Original file unavailable or its bytes no longer match the recorded hash.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url
      link.download = selectedDocument.filename; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'Original staged file downloaded for source inspection.')
  }

  const latest = (kind: string, key: string) => events.find(event => event.target_kind === kind && event.target_key === key)
  const status = (value?: string) => value === 'approve' ? 'Approved in staging' : value === 'reject' ? 'Rejected in staging' : 'Pending'

  return <details className="evidence-v2-trusted"><summary>Trusted source and reviewer workflow · isolated staging</summary>
    <p>The source file's bytes and each review decision are checked by the server. A matching hash proves file identity; it does not prove a disclosure is correctly interpreted. Production acceptance remains disabled.</p>
    <div className="desk-fields"><label>Local reviewer token<input aria-label="Isolated reviewer token" type="password" autoComplete="off" value={token} onChange={event => { onToken(event.target.value); setIdentity(''); setReadiness(null) }} /></label><div className="desk-actions"><button type="button" disabled={busy || token.length < 32} onClick={connect}>Connect isolated reviewer</button></div></div>
    <p>Identity: <strong>{identity || 'not connected'}</strong>. Token stays in this page's memory and is never sent as a reviewer name. Configure staging separately on the local server before connecting.</p>
    {message && <p className="desk-message" role="status">{message}</p>}
    {identity && <>
      <div className="evidence-v2-trust-rail" aria-label="Independent review gates">
        {['Source verified', 'Field mapping reviewed', 'Convention approved', 'Historical ready', 'Valuation review'].map((gate, index) =>
          <div key={gate}><small>{index + 1} / 5</small><strong>{gate}</strong><span>{readiness ? status([readiness.source_verified, readiness.field_mapping_reviewed,
            readiness.accounting_convention_approved, readiness.historical_ready_for_acceptance,
            readiness.valuation_ready_for_review][index] ? 'approve' : undefined) : 'Not checked'}</span></div>)}
      </div>
      <h3>Original source beside the mapped claim</h3>
      <div className="desk-fields"><label>Staged source<select aria-label="Staged source" value={docIndex} onChange={event => { setDocIndex(Number(event.target.value)); setCandidateReference(''); setOriginalInspected(false); setOriginChecked(false) }}><option value="">Choose staged source</option>{staged.map((item, index) => <option key={item.hash} value={index}>{item.filename} · {item.hash.slice(0, 12)}</option>)}</select></label><label>Mapped field<select aria-label="Evidence field for review" value={fieldKey} onChange={event => { const key = event.target.value; setFieldKey(key); const item = fields.find(row => row.key === key); if (item) { setSourcePeriod(item.evidence.period_end); setSourceCurrency(item.evidence.currency); setSection(item.field.startsWith('income.') ? 'income' : item.field.startsWith('balance.') || item.field === 'opening.balance_cash' ? 'balance' : item.field.startsWith('cash_flow.') || item.field === 'opening.cash_flow_cash' ? 'cash_flow' : 'note'); setCandidateReference(item.evidence.sources[0]?.locator || '') } }}><option value="">Choose claim</option>{fields.map(item => <option key={item.key} value={item.key}>{item.key}</option>)}</select></label></div>
      <div className="evidence-v2-compare"><div><h4>Staged disclosure</h4>{selectedDocument ? <><p>{selectedDocument.filename} · server SHA-256 {selectedDocument.hash}</p><button type="button" disabled={busy} onClick={downloadOriginal}>Download original file</button><label>Extracted line<select aria-label="Original disclosure line" value={candidateReference} onChange={event => setCandidateReference(event.target.value)}><option value="">Choose exact line</option>{selectedDocument.candidates.map(item => <option key={item.reference} value={item.reference}>{item.reference} · {item.label}</option>)}</select></label><pre>{selectedCandidate ? `${selectedCandidate.label}\n${selectedCandidate.raw_values.join(' | ')}` : 'Choose a source line to inspect its original extracted values.'}</pre><small>Byte identity: verified at upload; rechecked for every source review and download. Source interpretation requires your explicit review.</small></> : <p>Connect, then upload a filing above to stage its original bytes.</p>}</div><div><h4>Mapped value</h4>{selectedField ? <><p><strong>{selectedField.key}</strong> · {selectedField.evidence.state}</p><p>{String(selectedField.evidence.value ?? 'Unavailable')} {selectedField.evidence.currency} {selectedField.evidence.units}</p><p>{selectedField.evidence.definition}</p><small>{status(latest('field', selectedField.key)?.decision)}</small></> : <p>Choose a field to compare its value and classification with the source.</p>}</div></div>
      <div className="desk-fields"><label>Source units<select aria-label="Reviewed source units" value={sourceUnits} onChange={event => setSourceUnits(event.target.value)}>{['ones', 'thousands', 'millions', 'billions'].map(value => <option key={value}>{value}</option>)}</select></label><label>Source fiscal end<input aria-label="Reviewed source fiscal end" type="date" value={sourcePeriod} onChange={event => setSourcePeriod(event.target.value)} /></label><label>Source currency<input aria-label="Reviewed source currency" maxLength={3} value={sourceCurrency} onChange={event => setSourceCurrency(event.target.value.toUpperCase())} /></label><label>Statement section<select aria-label="Reviewed statement section" value={section} onChange={event => setSection(event.target.value)}>{['income', 'balance', 'cash_flow', 'note'].map(value => <option key={value}>{value}</option>)}</select></label><label>Value column (first = 0)<input aria-label="Reviewed value column" type="number" min={0} max={6} value={valueIndex} onChange={event => setValueIndex(Number(event.target.value))} /></label></div>
      <label>Reviewer notes<textarea aria-label="Trusted reviewer notes" value={note} onChange={event => setNote(event.target.value)} placeholder="Describe exactly what was inspected, any discrepancies, and why this decision is justified." /></label>
      <div className="evidence-v2-attest"><label><input type="checkbox" checked={originalInspected} onChange={event => setOriginalInspected(event.target.checked)} /> I inspected the original staged document.</label><label><input type="checkbox" checked={originChecked} onChange={event => setOriginChecked(event.target.checked)} /> I checked its issuer or auditor origin.</label></div>
      <div className="desk-actions"><button type="button" disabled={busy || !selectedDocument || !originalInspected || !originChecked || note.trim().length < 12} onClick={() => reviewSource('approve')}>Verify inspected source</button><button type="button" disabled={busy || !selectedDocument || note.trim().length < 12} onClick={() => reviewSource('reject')}>Reject source</button><button type="button" disabled={busy || !selectedField || note.trim().length < 12} onClick={() => reviewField('approve')}>Approve field mapping</button><button type="button" disabled={busy || !selectedField || note.trim().length < 12} onClick={() => reviewField('reject')}>Reject field claim</button></div>
      <h3>Separate accounting convention decision</h3><div className="desk-fields"><label>Year and schedule<select aria-label="Convention for review" value={scheduleKey} onChange={event => setScheduleKey(event.target.value)}><option value="">Choose convention</option>{conventions.map(item => <option key={item.key} value={item.key}>{item.key} · {item.convention?.mode || 'unset'}</option>)}</select></label><p>{selectedConvention ? `${selectedConvention.convention?.mode || 'Unset'} · ${selectedConvention.convention?.review.rationale || 'No rationale'}` : 'Choose a schedule to review its mode and rationale.'}</p></div><div className="desk-actions"><button type="button" disabled={busy || !selectedConvention?.convention || note.trim().length < 12} onClick={() => reviewConvention('approve')}>Approve convention</button><button type="button" disabled={busy || !selectedConvention?.convention || note.trim().length < 12} onClick={() => reviewConvention('reject')}>Reject convention</button></div>
      <h3>Historical readiness</h3><button type="button" disabled={busy} onClick={checkReadiness}>Check independent readiness gates</button>{readiness && <><p>Source gaps: {readiness.missing_sources.length}; field decisions pending or stale: {readiness.missing_fields.length}; convention decisions pending or stale: {readiness.missing_conventions.length}; accounting issues: {readiness.accounting_issues.length}.</p><p>{readiness.historical_ready_for_acceptance ? 'Ready for a future controlled acceptance process; no case was saved.' : 'Historical acceptance is blocked.'} Valuation review is separately blocked.</p><details><summary>Readiness gaps</summary><pre>{[...readiness.missing_sources, ...readiness.missing_fields, ...readiness.missing_conventions, ...readiness.accounting_issues.map(item => `${item.code}: ${item.detail}`)].join('\n') || 'No historical gaps'}</pre></details></>}
      <details><summary>Immutable isolated review history · {events.length} events</summary><ol>{events.map(event => <li key={event.seq}><strong>{event.decision}</strong> {event.target_kind} {event.target_key} · {event.reviewer} · {event.created_at}<br />{event.note}<br /><small>Event SHA-256 {event.event_hash.slice(0, 16)}…</small></li>)}</ol></details>
    </>}
  </details>
}
