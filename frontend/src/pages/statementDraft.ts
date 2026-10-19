import type { DraftCompany, FieldProvenance } from '../types/valuation'

export type ReviewedStatement = {
  id: string; source: string; currency: string; units: string; period_end: string
  income_statement: Record<string, Array<number | null>>
  balance_sheet: Record<string, Array<number | null>>
  cash_flow: Record<string, Array<number | null>>
}

export function applyReviewedStatement(draft: DraftCompany, statement: ReviewedStatement): { draft: DraftCompany; transferred: string[] } {
  if (statement.units !== 'millions') throw new Error('Only reviewed statements in millions can fill this valuation draft.')
  if (statement.currency !== draft.currency) throw new Error('Statement and valuation currencies differ; reconcile them before transfer.')
  const fields: Array<[keyof DraftCompany, number | null | undefined]> = [
    ['revenue', statement.income_statement.revenue?.[1]],
    ['ebitda', statement.income_statement.ebitda?.[1]],
    ['cash', statement.balance_sheet.cash?.[1]],
    ['debt', statement.balance_sheet.debt?.[1]],
    ['diluted_shares', statement.income_statement.diluted_shares?.[1]],
  ]
  const next: DraftCompany = { ...draft, base_year: Number(statement.period_end.slice(0, 4)), provenance: { ...draft.provenance }, sources: [...new Set([...draft.sources, statement.source])] }
  const transferred: string[] = []
  for (const [key, value] of fields) {
    if (value == null || !Number.isFinite(value)) continue
    if (['revenue', 'cash', 'debt', 'diluted_shares'].includes(key) && value < 0) continue
    Object.assign(next, { [key]: value })
    next.provenance[key] = { status: 'sourced', source: `Reviewed statement ${statement.id}: ${statement.source}`, period_end: statement.period_end, unit: `${statement.currency} millions`, note: 'Analyst-reviewed mapping; inspect the saved source references and lease/debt classification.' } satisfies FieldProvenance
    transferred.push(key)
  }
  next.provenance.base_year = { status: 'derived', source: `Reviewed statement ${statement.id}`, period_end: statement.period_end, note: 'Calendar year of fiscal period end.' }
  return { draft: next, transferred }
}
