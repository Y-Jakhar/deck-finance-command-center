import { useState } from 'react'
import type { InstrumentPageData } from '../types/market'

const tabs = ['Overview', 'Research', 'News', 'Data provenance'] as const
type Tab = (typeof tabs)[number]
const dateTime = (timestamp: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false,
}).format(new Date(timestamp)) + ' UTC'
const format = (value: number, currency: string) => currency === 'PCT' ? `${value.toFixed(3)}%` : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: value < 10 ? 4 : 2 }).format(value)

export function ResearchTabs({ data }: { data: InstrumentPageData }) {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const { quote, candles, research, sources, instrument } = data
  const high = Math.max(...candles.map((item) => item.high)); const low = Math.min(...candles.map((item) => item.low))
  const volume = candles.reduce((total, item) => total + item.volume, 0)
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, current: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setActiveTab(tabs[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <section className="research-section" aria-label="Instrument information">
    <div className="tab-list" role="tablist" aria-label="Instrument detail sections">{tabs.map((tab, index) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} aria-controls="instrument-tab-panel" id={`tab-${tab.toLowerCase().replace(' ', '-')}`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={(event) => moveFocus(event, index)}>{tab}</button>)}</div>
    <div id="instrument-tab-panel" role="tabpanel" aria-labelledby={`tab-${activeTab.toLowerCase().replace(' ', '-')}`}>
      {activeTab === 'Overview' && <div className="overview-grid">
        <article className="ledger-panel stats-panel"><span className="panel-index">A / Statistics</span><h3>Key statistics</h3><dl className="stat-list">
          <div><dt>Series high</dt><dd>{format(high, quote.currency)}</dd></div><div><dt>Series low</dt><dd>{format(low, quote.currency)}</dd></div>
          <div><dt>Series volume</dt><dd>{volume > 0 ? volume.toLocaleString('en-US') : 'Not supplied'}</dd></div><div><dt>Previous close</dt><dd>{format(quote.previousClose, quote.currency)}</dd></div>
          <div><dt>Quote currency</dt><dd>{quote.currency}</dd></div><div><dt>Market</dt><dd>{instrument.marketHoursLabel}</dd></div>
        </dl></article>
        <article className="ledger-panel brief-panel"><span className="panel-index">B / Rules engine</span><div className="panel-title-row"><h3>Deterministic brief</h3><span className="method-chip">No generative claims</span></div><p className="brief-lead">Facts and observations calculated from normalized provider records. No forecast or trade instruction is produced.</p><h4>Verified price facts</h4><ul className="fact-list">{research.verifiedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul><h4>Rule-generated observations</h4><ul className="observation-list">{research.observations.map((item) => <li key={item}>{item}</li>)}</ul>{research.warnings.map((warning) => <div className="warning-note" role="note" key={warning}><strong>Data warning</strong><span>{warning}</span></div>)}</article>
        <article className="ledger-panel source-panel"><span className="panel-index">C / Provenance</span><h3>Source ledger</h3><ol className="source-list">{sources.map((source) => <li key={source.id}><div className="source-list__head"><strong>{source.label}</strong><span>{source.freshness.label}</span></div><p>{source.role}</p><dl><div><dt>Provider</dt><dd>{source.provider}</dd></div><div><dt>Retrieved</dt><dd>{dateTime(source.retrievedAt)}</dd></div></dl></li>)}</ol></article>
      </div>}
      {activeTab === 'Research' && <article className="ledger-panel single-panel"><span className="panel-index">Research / Deterministic</span><h3>Evidence before interpretation</h3><ul className="observation-list">{[...research.verifiedFacts, ...research.observations].map((item) => <li key={item}>{item}</li>)}</ul></article>}
      {activeTab === 'News' && <article className="ledger-panel single-panel"><span className="panel-index">News / Separate stream</span><h3>Sourced context</h3>{research.headlines.length ? <ol className="news-ledger">{research.headlines.map((item) => <li key={`${item.timestamp}-${item.title}`}><time>{dateTime(item.timestamp)}</time>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <strong>{item.title}</strong>}<small>{item.source}</small></li>)}</ol> : <p>No locally collected headlines are mapped to this instrument yet.</p>}</article>}
      {activeTab === 'Data provenance' && <article className="ledger-panel single-panel"><span className="panel-index">Provenance / Complete record</span><h3>Normalized lineage</h3><p>Instrument identifiers, provider mappings, market time, receive time, delay, quality, and cache freshness remain separate fields. Missing provider data stays visibly unavailable.</p></article>}
    </div>
  </section>
}
