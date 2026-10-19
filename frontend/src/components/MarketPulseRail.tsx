import type { PulseEvent } from '../types/market'

const formatTime = (timestamp: string) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  hour12: false,
}).format(new Date(timestamp))

const labels: Record<PulseEvent['type'], string> = {
  quote: 'Quote',
  news: 'News',
  freshness: 'Check',
  event: 'Event',
}

export function MarketPulseRail({ events }: { events: PulseEvent[] }) {
  return (
    <section className="pulse-section" aria-labelledby="pulse-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Recent event ledger</span>
          <h2 id="pulse-title">Market Pulse Rail</h2>
        </div>
        <p><span className="legend-mark" aria-hidden="true" /> Confirmed sequence</p>
      </div>
      <div className="pulse-scroll" tabIndex={0} aria-label="Scrollable recent market event timeline">
        <ol className="pulse-rail">
          {events.map((event, index) => (
            <li className={`pulse-block pulse-block--${event.status}`} key={event.id}>
              <div className="pulse-block__chain" aria-hidden="true">
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <time dateTime={event.timestamp}>{formatTime(event.timestamp)} UTC</time>
              <span className="pulse-block__type">{labels[event.type]}</span>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
              <small>{event.source}</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
