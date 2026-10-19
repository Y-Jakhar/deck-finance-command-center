export type EvidenceState = 'audited' | 'derived' | 'analyst_estimated' | 'not_applicable' | 'unavailable'
export type ScheduleMode = 'reported_aggregate' | 'disaggregated'
export type Review = { reviewer: string; approval_id: string; reviewed_at: string; rationale: string }
export type Source = { document_id: string; url: string; locator: string; reported_value: number; period_end: string; currency: string; units: 'millions'; scope: string; document_sha256?: string }
export type Evidence = { state: EvidenceState; value: number | null; period_end: string; currency: string; units: 'millions'; scope: string; definition: string; sources: Source[]; formula: { operation: 'add' | 'subtract'; operands: string[] } | null; review: Review | null; reason: string | null; component_ids: string[] }
export type Convention = { mode: ScheduleMode; review: Review; scope: string }
export type Period = { period_start: string; period_end: string; fields: Record<string, Evidence>; conventions: Record<string, Convention> }
export type HistoricalCase = { version: '2.0'; symbol: string; currency: string; opening_cash: { period_end: string; balance_cash?: Evidence; cash_flow_cash?: Evidence }; periods: Period[]; notes: string }
export type Candidate = { reference: string; label: string; suggested_key: string | null; raw_values: string[] }
export type UploadDocument = { filename: string; hash: string; format: string; candidates: Candidate[]; limitations: string; columnPeriods: string[]; unitsConfirmed: boolean; unitBasis: string; staged?: boolean; selected: Record<number, { field: string; checked: boolean; values: string[] }> }
export type Reconciliation = { status: 'accepted' | 'blocked'; issues: Array<{ period: string; code: string; detail: string }>; checks: Array<{ period: string; code: string; value: string }>; history_hash: string; field_hashes: Record<string, string>; source_lineage: Record<string, string[]>; calculation_version: string }

export const SCHEDULES = ['income', 'cash_flow', 'debt', 'equity', 'lease', 'ppe'] as const
export const REQUIRED_FIELDS = [
  'income.revenue', 'income.cost_of_sales', 'income.operating_expenses', 'income.ebit',
  'income.net_other', 'income.income_tax', 'income.net_income',
  'balance.cash', 'balance.receivables', 'balance.inventory', 'balance.other_current_assets',
  'balance.ppe', 'balance.other_assets', 'balance.payables', 'balance.other_current_liabilities',
  'balance.borrowings', 'balance.finance_lease_liabilities', 'balance.other_liabilities',
  'balance.equity', 'balance.total_assets', 'balance.total_liabilities_equity',
  'cash_flow.cfo', 'cash_flow.cfi', 'cash_flow.cff', 'cash_flow.fx_effect',
  'cash_flow.net_change', 'cash_flow.end_cash', 'cash_scope.difference',
] as const

const SUGGESTIONS: Record<string, string> = {
  revenue: 'income.revenue', cogs: 'income.cost_of_sales', cost_of_sales: 'income.cost_of_sales',
  operating_expenses: 'income.operating_expenses', ebit: 'income.ebit',
  other_income: 'income.net_other', taxes: 'income.income_tax', income_tax: 'income.income_tax',
  net_income: 'income.net_income', cash: 'balance.cash', receivables: 'balance.receivables',
  inventory: 'balance.inventory', other_current_assets: 'balance.other_current_assets',
  ppe: 'balance.ppe', fixed_assets: 'balance.ppe', other_assets: 'balance.other_assets',
  payables: 'balance.payables', other_current_liabilities: 'balance.other_current_liabilities',
  debt: 'balance.borrowings', borrowings: 'balance.borrowings',
  finance_lease_liabilities: 'balance.finance_lease_liabilities',
  other_liabilities: 'balance.other_liabilities', equity: 'balance.equity',
  shareholders_equity: 'balance.equity', total_assets: 'balance.total_assets',
  total_liabilities_equity: 'balance.total_liabilities_equity',
  cash_from_operations: 'cash_flow.cfo', cash_from_investing: 'cash_flow.cfi',
  cash_from_financing: 'cash_flow.cff', net_change_cash: 'cash_flow.net_change',
  fx_cash_effect: 'cash_flow.fx_effect',
}

export function suggestedField(key: string | null): string {
  return key ? SUGGESTIONS[key] || '' : ''
}

export function rawNumber(raw: string): string {
  const value = raw.trim().replaceAll(',', '')
  return /^\(?-?\d+(\.\d+)?\)?$/.test(value)
    ? String(Number(value.replace(/[()]/g, '')) * (value.startsWith('(') ? -1 : 1)) : ''
}

export function draftReview(rationale: string): Review {
  return { reviewer: 'unauthenticated browser draft', approval_id: 'read-only-preview-only',
    reviewed_at: new Date().toISOString().slice(0, 10), rationale }
}

export function emptyCase(symbol: string): HistoricalCase {
  return { version: '2.0', symbol, currency: 'USD',
    opening_cash: { period_end: '' },
    periods: Array.from({ length: 3 }, () => ({ period_start: '', period_end: '', fields: {}, conventions: {} })),
    notes: 'Read-only historical evidence draft; no production review or valuation approval.' }
}

export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid fiscal date: ${day}`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function evidenceFromUpload(document: UploadDocument, candidate: Candidate, value: number,
  periodEnd: string, field: string, currency: string): Evidence {
  const source: Source = { document_id: `${document.filename}#${document.hash.slice(0, 12)}`,
    url: `urn:sha256:${document.hash}`, document_sha256: document.hash,
    locator: candidate.reference, reported_value: value, period_end: periodEnd,
    currency, units: 'millions', scope: field }
  return { state: 'audited', value, period_end: periodEnd, currency, units: 'millions',
    scope: field, definition: `${candidate.label} · original extraction: ${candidate.raw_values.join(' | ')} · units/conversion: ${document.unitBasis}`,
    sources: [source], formula: null,
    review: draftReview('Browser mapping check only; source support awaits independent review.'),
    reason: null, component_ids: [] }
}

export function withCashScope(caseDraft: HistoricalCase): HistoricalCase {
  const result = structuredClone(caseDraft)
  for (const row of result.periods) {
    const cash = row.fields['balance.cash']
    const flow = row.fields['cash_flow.end_cash']
    if (!row.fields['cash_scope.difference'] && cash && flow && cash.value !== null && flow.value !== null) {
      row.fields['cash_scope.difference'] = {
        state: 'derived', value: flow.value - cash.value, period_end: row.period_end,
        currency: result.currency, units: 'millions', scope: 'cash_scope.difference',
        definition: 'Cash-flow closing cash less balance-sheet cash; economic cause not inferred',
        sources: [], formula: { operation: 'subtract', operands: [
          `${row.period_end}:cash_flow.end_cash`, `${row.period_end}:balance.cash` ] },
        review: draftReview('Transparent dated cash-scope measure only; source classification is pending.'),
        reason: null, component_ids: [],
      }
    }
  }
  return result
}

export function prepareCase(caseDraft: HistoricalCase): HistoricalCase {
  const result = withCashScope(caseDraft)
  if (!result.symbol.trim()) throw new Error('Select a company symbol.')
  if (!result.opening_cash.period_end || !result.opening_cash.balance_cash || !result.opening_cash.cash_flow_cash)
    throw new Error('Map opening balance-sheet cash and cash-flow cash to the prior fiscal date.')
  if (result.periods.length < 3 || result.periods.length > 5) throw new Error('Choose three to five fiscal years.')
  let previous = result.opening_cash.period_end
  for (const row of result.periods) {
    if (!row.period_end || row.period_end <= previous) throw new Error('Enter ascending fiscal year-end dates.')
    row.period_start = nextDay(previous)
    for (const schedule of SCHEDULES) {
      const convention = row.conventions[schedule]
      if (!convention?.mode || !convention.review.rationale.trim())
        throw new Error(`Select and explain the ${schedule} convention for ${row.period_end}.`)
    }
    previous = row.period_end
  }
  if (!result.notes.trim()) throw new Error('Explain the historical evidence perimeter.')
  return result
}

export function applyUploadMappings(caseDraft: HistoricalCase, documents: UploadDocument[]): HistoricalCase {
  const result = structuredClone(caseDraft)
  let applied = 0
  for (const doc of documents) {
    if (Object.values(doc.selected).some(selection => selection.checked) && (!doc.unitsConfirmed || !doc.unitBasis.trim()))
      throw new Error(`Confirm ${doc.filename} amounts were converted to ${result.currency} millions and record the unit basis before mapping.`)
    for (const [indexText, selection] of Object.entries(doc.selected)) {
      if (!selection.checked || !selection.field.trim()) continue
      const candidate = doc.candidates[Number(indexText)]
      if (!candidate) continue
      for (const [column, raw] of selection.values.entries()) {
        if (!raw.trim()) continue
        const date = doc.columnPeriods[column]
        if (!date) throw new Error(`Assign a fiscal date to ${doc.filename}, column ${column + 1}.`)
        const amount = Number(raw)
        if (!Number.isFinite(amount)) throw new Error(`Invalid number in ${candidate.reference}, column ${column + 1}.`)
        const field = selection.field.trim()
        const evidence = evidenceFromUpload(doc, candidate, amount, date, field, result.currency)
        if (date === result.opening_cash.period_end && field === 'opening.balance_cash') {
          if (result.opening_cash.balance_cash) throw new Error(`Duplicate opening balance cash mapping: ${candidate.reference}`)
          result.opening_cash.balance_cash = evidence
        } else if (date === result.opening_cash.period_end && field === 'opening.cash_flow_cash') {
          if (result.opening_cash.cash_flow_cash) throw new Error(`Duplicate opening cash-flow cash mapping: ${candidate.reference}`)
          result.opening_cash.cash_flow_cash = evidence
        } else {
          const period = result.periods.find(row => row.period_end === date)
          if (!period) throw new Error(`Fiscal date ${date} has no case year.`)
          if (period.fields[field]) throw new Error(`Duplicate ${date} ${field}; compare the two sources before choosing one.`)
          period.fields[field] = evidence
        }
        applied += 1
      }
    }
  }
  if (!applied) throw new Error('Select at least one source-checked value with a fiscal date.')
  return result
}
