export type WaccInputs = { costOfEquity: number; pretaxCostOfDebt: number; debtWeight: number; marginalTaxRate: number }

export function calculateWacc({ costOfEquity, pretaxCostOfDebt, debtWeight, marginalTaxRate }: WaccInputs): number {
  if (![costOfEquity, pretaxCostOfDebt, debtWeight, marginalTaxRate].every(Number.isFinite)) throw new Error('Enter finite cost and capital-structure inputs.')
  if (costOfEquity < 0 || pretaxCostOfDebt < 0 || debtWeight < 0 || debtWeight > 1 || marginalTaxRate < 0 || marginalTaxRate > 1) throw new Error('Costs must be nonnegative; debt weight and tax rate must be between 0 and 1.')
  return Number(((1 - debtWeight) * costOfEquity + debtWeight * pretaxCostOfDebt * (1 - marginalTaxRate)).toFixed(10))
}
