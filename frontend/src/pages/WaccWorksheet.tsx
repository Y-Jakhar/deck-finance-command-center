import { useState } from 'react'
import { calculateWacc, type WaccInputs } from './waccFormula'

export function WaccWorksheet({ onApply }: { onApply: (rate: number, inputs: WaccInputs) => void }) {
  const [values, setValues] = useState({ costOfEquity: '', pretaxCostOfDebt: '', debtWeight: '', marginalTaxRate: '' })
  const [result, setResult] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const names: Array<[keyof typeof values, string]> = [
    ['costOfEquity', 'Cost of equity'], ['pretaxCostOfDebt', 'Pre-tax cost of financing debt'],
    ['debtWeight', 'Market-value debt weight'], ['marginalTaxRate', 'Marginal debt tax rate'],
  ]
  return <details className="desk-panel"><summary>WACC worksheet · separately review equity and debt costs</summary>
    <p>Enter decimal rates (0.10 = 10%). Equity weight is 1 − debt weight. Use market-value capital weights, a supported cost of equity and financing debt cost. The tax shield applies only to the debt share. This worksheet does not estimate any input from the share price.</p>
    <div className="desk-fields">{names.map(([key, name]) => <label key={key}>{name}<input type="number" step="any" value={values[key]} onChange={event => { setValues({ ...values, [key]: event.target.value }); setResult(null) }} /></label>)}</div>
    <p>Lease convention: keep operating leases in operating expenses and exclude their liabilities from financing debt; include finance leases in financing debt and the equity bridge. Reconcile the actual statements before using this convention. Current DealLens bridge is a simplified debt-minus-cash bridge.</p>
    <button onClick={() => { try { if (Object.values(values).some(value => value.trim() === '')) throw new Error('Enter all four supported inputs.'); const rate = calculateWacc({ costOfEquity: Number(values.costOfEquity), pretaxCostOfDebt: Number(values.pretaxCostOfDebt), debtWeight: Number(values.debtWeight), marginalTaxRate: Number(values.marginalTaxRate) }); setResult(rate); setMessage('Review input evidence and lease/debt consistency before applying.') } catch (error) { setResult(null); setMessage(error instanceof Error ? error.message : String(error)) } }}>Calculate WACC</button>
    {message && <p role="status">{message}</p>}{result !== null && <p>Blended WACC: <strong>{(result * 100).toFixed(3)}%</strong> · <button onClick={() => onApply(result, { costOfEquity: Number(values.costOfEquity), pretaxCostOfDebt: Number(values.pretaxCostOfDebt), debtWeight: Number(values.debtWeight), marginalTaxRate: Number(values.marginalTaxRate) })}>Apply to valuation draft</button></p>}
  </details>
}
