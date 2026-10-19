import { useEffect, useState } from 'react'
import { deskApi, fmt } from './deskUtils'

type Strategy = { name: string; family: string; description: string; version: string; source_hash: string; parameters: Record<string, number>; minimum_bars: number; compatible: boolean; reason: string | null }
type Experiment = { id: string; summary: { run_id: string }; provenance?: { id?: string }; config?: { strategy: string; mode: string; parameters: Record<string, number>; costs: Record<string, number> }; result: { baseline: { metrics: Record<string, number | null> }; out_of_sample: { metrics: Record<string, number | null> } } }
type Settings = { fee_bps: number; slippage_bps: number; fixed_fee: number; initial_capital: number; is_ratio: number; walk_forward_windows: number }

const metrics = ['net_return', 'benchmark_return', 'cagr', 'sharpe', 'sortino', 'max_drawdown', 'trade_count', 'win_rate', 'profit_factor', 'exposure', 'transaction_costs']

function metric(experiment: Experiment, key: string, benchmark: number | null) {
  if (key === 'benchmark_return') return benchmark === null ? 'Unavailable' : `${fmt(benchmark * 100)}%`
  const values = experiment.result.baseline.metrics
  if ((key === 'sharpe' && values.volatility === 0) || (key === 'sortino' && values.sortino === 0 && values.volatility === 0)) return 'Unavailable'
  const value = values[key]
  return value == null ? 'Unavailable' : ['net_return', 'cagr', 'max_drawdown', 'win_rate', 'exposure', 'transaction_costs'].includes(key) ? `${fmt(value * 100)}%` : fmt(value)
}

export function StrategyLibrary({ datasetId, settings, contract, experiments, onSaved }: { datasetId: string; settings: Settings; contract: string; experiments: Experiment[]; onSaved: (saved: Experiment) => Promise<void> }) {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [selected, setSelected] = useState('')
  const [parameters, setParameters] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sortBy, setSortBy] = useState('sharpe')
  const [benchmark, setBenchmark] = useState<{ price_return: number; definition: string; adjustment_policy: string; dataset_hash: string } | null>(null)

  useEffect(() => {
    let active = true
    setStrategies([]); setSelected(''); setMessage(''); setBenchmark(null)
    if (datasetId) deskApi('/strategies?dataset_id=' + encodeURIComponent(datasetId))
      .then((items: Strategy[]) => { if (active) { setStrategies(items); const first = items.find(item => item.compatible); if (first) { setSelected(first.name); setParameters(first.parameters) } } })
      .catch(error => { if (active) setMessage(error.message) })
    if (datasetId) deskApi('/datasets/' + encodeURIComponent(datasetId) + '/buy-hold')
      .then((item: { price_return: number; definition: string; adjustment_policy: string; dataset_hash: string }) => { if (active) setBenchmark(item) })
      .catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [datasetId])

  const active = strategies.find(item => item.name === selected)
  const compatible = strategies.filter(item => item.compatible)
  const incompatible = strategies.filter(item => !item.compatible)
  const runs = experiments.filter(item => item.provenance?.id === datasetId && item.config?.strategy && strategies.some(strategy => strategy.name === item.config?.strategy))
    .slice().sort((a, b) => {
      const av = a.result.baseline.metrics[sortBy], bv = b.result.baseline.metrics[sortBy]
      return (av == null ? 1 : bv == null ? -1 : bv - av)
    })

  async function run(items: Array<{ name: string; parameters: Record<string, number> }>) {
    setBusy(true); setMessage('')
    const completed: Experiment[] = []
    const failures: string[] = []
    try {
      const failure_contract = JSON.parse(contract)
      for (const item of items) {
        try {
          const saved = await deskApi('/experiments', { dataset_id: datasetId, strategy_name: item.name, parameters: item.parameters,
            mode: 'exploratory', failure_contract, ...settings }) as Experiment
          completed.push(saved)
        } catch (error) { failures.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      if (completed.length) await onSaved(completed.at(-1)!)
      setMessage(`${completed.length} exploratory run${completed.length === 1 ? '' : 's'} saved.${failures.length ? ' Failed: ' + failures.join('; ') : ''}`)
    } catch { setMessage('Failure criteria must be valid JSON before running strategies.') }
    finally { setBusy(false) }
  }

  return <section className="desk-panel strategy-library"><h2>Strategy library · existing StrategyLab rules</h2>
    <p>These rules use the original close-signal, next-open simulation and its costs. New library runs are exploratory; the saved run bundle retains the dataset hash, strategy source hash, parameters, costs and execution convention. Compatibility checks use the dataset's validated row count and default warm-up. This screen does not tune parameters against holdout outcomes.</p>
    {!datasetId ? <p>Select a saved dataset above before configuring tests.</p> : <>
      {message && <p role="alert" className="desk-message">{message}</p>}
      <label>Strategy<select aria-label="Strategy" value={selected} onChange={event => { const item = strategies.find(strategy => strategy.name === event.target.value); setSelected(event.target.value); setParameters(item?.parameters || {}) }}><option value="">Choose a compatible rule</option>{strategies.map(item => <option key={item.name} value={item.name} disabled={!item.compatible}>{item.name} · {item.family}{item.compatible ? '' : ' · incompatible'}</option>)}</select></label>
      {active && <><p>{active.description} · Version {active.version} · minimum {active.minimum_bars} bars.</p><div className="desk-fields">{Object.entries(parameters).map(([key, value]) => <label key={key}>{key}<input type="number" step="any" value={value} onChange={event => setParameters({ ...parameters, [key]: Number(event.target.value) })} /></label>)}</div><button disabled={busy || !active.compatible} onClick={() => run([{ name: active.name, parameters }])}>Run selected exploratory strategy</button></>}
      <button disabled={busy || !compatible.length} onClick={() => run(compatible.map(item => ({ name: item.name, parameters: item.parameters })))}>Run all {compatible.length} compatible strategies</button>
      <p>{compatible.length} eligible by data length; {incompatible.length} incompatible. Runs may still fail for invalid parameters, costs or analysis requirements.</p>
      {incompatible.length > 0 && <ul>{incompatible.map(item => <li key={item.name}>{item.name}: {item.reason}</li>)}</ul>}
      {runs.length > 0 && <><h3>Saved exploratory and formal runs</h3><label>Sort by<select aria-label="Sort strategy results" value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="sharpe">Sharpe</option><option value="max_drawdown">Maximum drawdown</option><option value="cagr">CAGR</option><option value="net_return">Net return</option></select></label><div className="desk-table"><table><caption>Historical simulated results after modeled costs, using one saved dataset · {benchmark?.dataset_hash.slice(0, 12) || 'hash unavailable'}…</caption><thead><tr><th>Metric</th>{runs.map(item => <th key={item.id}>{item.config?.strategy}<br />{item.config?.mode} · {item.summary.run_id.slice(0, 8)}</th>)}</tr></thead><tbody>{metrics.map(key => <tr key={key}><th>{key.replaceAll('_', ' ')}</th>{runs.map(item => <td key={item.id}>{metric(item, key, benchmark?.price_return ?? null)}</td>)}</tr>)}</tbody></table></div><p>Benchmark: {benchmark?.definition || 'Unavailable'} Adjustment: {benchmark?.adjustment_policy || 'unknown'}. Modeled costs are a fraction of initial equity. Profit factor is unavailable without losing trades; zero-variance risk ratios are unavailable. Sort order is descriptive, not evidence of a future edge.</p></>}
    </>}
  </section>
}
