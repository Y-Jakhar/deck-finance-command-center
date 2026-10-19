import { describe, expect, it } from 'vitest'
import { calculateWacc } from './waccFormula'

describe('independent WACC worksheet', () => {
  it('weights equity and after-tax debt separately', () => {
    expect(calculateWacc({ costOfEquity: .12, pretaxCostOfDebt: .06, debtWeight: .25, marginalTaxRate: .25 })).toBeCloseTo(.10125)
  })
  it('does not relabel an all-equity CAPM result as a blended WACC', () => {
    expect(calculateWacc({ costOfEquity: .12, pretaxCostOfDebt: 0, debtWeight: 0, marginalTaxRate: .25 })).toBe(.12)
    expect(() => calculateWacc({ costOfEquity: .12, pretaxCostOfDebt: .06, debtWeight: 1.2, marginalTaxRate: .25 })).toThrow('between 0 and 1')
  })
})
