import { fmt } from './deskUtils'

type Point = { timestamp: string; phase: string; equity?: number; drawdown?: number }
type Trade = { entry_timestamp: string; exit_timestamp: string | null; direction: string; entry_price: number; exit_price: number | null; net_pnl: number | null; costs: number; holding_bars: number }
type Window = { metrics: Record<string, number | null>; trades: Trade[]; equity_curve: Point[]; drawdown_curve: Point[] }
export type DetailedExperiment = { result: { baseline: Window; in_sample: Window; out_of_sample: Window; split: { boundary: string }; execution: Record<string, unknown>; verdict: { warnings: string[] } } }

function curvePoints(points: Point[], field: 'equity' | 'drawdown') {
  const values = points.map(point => point[field] ?? 0)
  const minimum = Math.min(...values), maximum = Math.max(...values)
  return values.map((value, index) => ({ x: 15 + index * 770 / Math.max(1, values.length - 1),
    y: 170 - (value - minimum) / (maximum - minimum || 1) * 145 }))
}

function Curve({ points, field, trades }: { points: Point[]; field: 'equity' | 'drawdown'; trades?: Trade[] }) {
  if (points.length < 2) return <p>No curve available.</p>
  const coordinates = curvePoints(points, field)
  const markers = trades?.flatMap((trade, tradeIndex) => [
    { date: trade.entry_timestamp, kind: 'entry', tradeIndex },
    { date: trade.exit_timestamp, kind: 'exit', tradeIndex },
  ]).filter(item => item.date).map(item => {
    const preferred = item.kind === 'entry' ? 'open' : 'close'
    let index = points.findIndex(point => point.timestamp === item.date && point.phase === preferred)
    if (index < 0 && item.kind === 'exit') index = points.findIndex(point => point.timestamp === item.date && point.phase === 'open')
    return index < 0 ? null : { ...item, ...coordinates[index] }
  }).filter(item => item !== null) || []
  return <figure><figcaption>{field === 'equity' ? 'Net simulated equity with trade entry and exit markers' : 'Simulated drawdown'} · {points.length} engine points</figcaption>
    <svg role="img" aria-label={field === 'equity' ? 'Net simulated equity and trades' : 'Simulated drawdown'} viewBox="0 0 800 185">
      <polyline fill="none" stroke="var(--teal)" strokeWidth="2" points={coordinates.map(point => `${point.x},${point.y}`).join(' ')} />
      {markers.map(marker => marker.kind === 'entry'
        ? <circle key={`${marker.tradeIndex}-entry`} cx={marker.x} cy={marker.y} r="4" fill="var(--teal)"><title>Trade {marker.tradeIndex + 1} entry · {marker.date}</title></circle>
        : <rect key={`${marker.tradeIndex}-exit`} x={marker.x - 4} y={marker.y - 4} width="8" height="8" fill="var(--copper)"><title>Trade {marker.tradeIndex + 1} exit · {marker.date}</title></rect>)}
    </svg></figure>
}

export function StrategyRunDetails({ experiment }: { experiment: DetailedExperiment }) {
  const { baseline, in_sample, out_of_sample, split, execution, verdict } = experiment.result
  return <div className="strategy-run-details">
    <p>In sample ends before {split.boundary}; out of sample starts there. Windows use fixed declared parameters. Fewer than 10 completed holdout trades are a weak basis for judging an edge.</p>
    <div className="desk-table"><table><caption>Separate simulated sample evidence</caption><thead><tr><th>Sample</th><th>Net return</th><th>Sharpe</th><th>Drawdown</th><th>Completed trades</th></tr></thead><tbody>
      {([['In sample', in_sample], ['Out of sample', out_of_sample]] as const).map(([name, window]) => <tr key={name}><th>{name}</th><td>{fmt((window.metrics.total_return ?? 0) * 100)}%</td><td>{fmt(window.metrics.sharpe)}</td><td>{fmt((window.metrics.max_drawdown ?? 0) * 100)}%</td><td>{fmt(window.metrics.trade_count)}</td></tr>)}
    </tbody></table></div>
    {(out_of_sample.metrics.trade_count ?? 0) < 10 && <p role="alert">Small holdout: {out_of_sample.metrics.trade_count ?? 0} completed trades. Risk-adjusted estimates are unstable.</p>}
    {verdict.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
    <Curve points={baseline.equity_curve} field="equity" trades={baseline.trades} />
    <Curve points={baseline.drawdown_curve} field="drawdown" />
    <p>Circles mark simulated entries; squares mark simulated exits. Markers locate engine-reported fills and do not establish executable orders. {baseline.trades.length} completed trade records.</p>
    <details><summary>Individual simulated trades · {baseline.trades.length}</summary><div className="desk-table"><table><thead><tr>{['Entry', 'Exit', 'Side', 'Entry price', 'Exit price', 'Bars', 'Net P&L', 'Modeled costs'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{baseline.trades.map((trade, index) => <tr key={index}><td>{trade.entry_timestamp}</td><td>{trade.exit_timestamp || 'Open'}</td><td>{trade.direction}</td><td>{fmt(trade.entry_price)}</td><td>{fmt(trade.exit_price)}</td><td>{trade.holding_bars}</td><td>{fmt(trade.net_pnl)}</td><td>{fmt(trade.costs)}</td></tr>)}</tbody></table></div></details>
    <details><summary>Execution assumptions and full research diagnostics</summary><pre>{JSON.stringify(execution, null, 2)}</pre></details>
  </div>
}
