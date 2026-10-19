import { describe, expect, it } from 'vitest'
import { applyReviewedStatement, type ReviewedStatement } from './statementDraft'
import type { DraftCompany } from '../types/valuation'

const draft = {
  name: 'Synthetic Co', ticker: 'TEST', company_type: 'public', currency: 'USD', revenue: '', ebitda: '', cash: '', debt: '', diluted_shares: null,
  base_year: 2024, tax_rate: 0.21, tax_methodology: 'tax_on_positive_ebit_only', wacc: 0.1, terminal_growth: 0.025,
  da_percent_revenue: 0.03, capex_percent_revenue: 0.03, nwc_percent_revenue: 0.1,
  growth_rates: [0.05, 0.05, 0.04, 0.03, 0.03], margin_targets: [0.3, 0.3, 0.3, 0.3, 0.3],
  peers: [], sources: [], provenance: {},
} satisfies DraftCompany
const statement: ReviewedStatement = {
  id: 'synthetic-1', source: 'synthetic reviewed fixture', currency: 'USD', units: 'millions', period_end: '2025-06-30',
  income_statement: { revenue: [90, 100], ebitda: [10, -2], diluted_shares: [50, 49] },
  balance_sheet: { cash: [15, 20], debt: [30, 40] }, cash_flow: {},
}

describe('reviewed statement transfer', () => {
  it('copies only supported current-period facts and leaves assumptions untouched', () => {
    const result = applyReviewedStatement(draft, statement)
    expect(result.transferred).toEqual(['revenue', 'ebitda', 'cash', 'debt', 'diluted_shares'])
    expect(result.draft).toMatchObject({ revenue: 100, ebitda: -2, cash: 20, debt: 40, diluted_shares: 49, base_year: 2025, wacc: 0.1, tax_rate: 0.21 })
    expect(result.draft.provenance.revenue.source).toContain('synthetic-1')
    expect(draft.revenue).toBe('')
  })
  it('rejects incompatible currency and units', () => {
    expect(() => applyReviewedStatement(draft, { ...statement, currency: 'EUR' })).toThrow('currencies differ')
    expect(() => applyReviewedStatement(draft, { ...statement, units: 'thousands' })).toThrow('millions')
  })
})
