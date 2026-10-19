import type { DataFreshness } from '../types/market'

export function StatusBadge({ freshness }: { freshness: DataFreshness }) {
  const icon = freshness.state === 'stale' ? '!' : freshness.state === 'unavailable' ? '×' : '✓'

  return (
    <span
      className={`status-badge status-badge--${freshness.state}`}
      data-state={freshness.state}
      aria-label={`Data status: ${freshness.label}`}
    >
      <span className="status-badge__icon" aria-hidden="true">{icon}</span>
      <span className="status-badge__text">{freshness.label}</span>
    </span>
  )
}
