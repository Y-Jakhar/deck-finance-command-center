import { useCallback, useEffect, useState } from 'react'
import {
  commitImport, getToday, previewImport, refreshAll, runExportUrl,
} from '../services/instrumentService'
import type { ImportCommitResponse, ImportPreview, TodayResearchResponse } from '../types/market'

type TodayState =
  | { status: 'loading' }
  | { status: 'ready'; data: TodayResearchResponse }
  | { status: 'offline'; message: string }

const when = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false,
  }).format(new Date(value))
  : 'Not completed'

const countLabel = (counts: Record<string, number>) => Object.entries(counts)
  .filter(([, value]) => value > 0)
  .map(([key, value]) => `${value} ${key}`)
  .join(' · ') || 'No new records'

export function TodayOffline({ message }: { message: string }) {
  return (
    <main id="main-content" className="state-page today-state" role="alert">
      <div className="state-mark state-mark--error" aria-hidden="true">×</div>
      <p className="eyebrow">Local terminal offline</p><h1>Your saved research is safe, but the app is not running</h1>
      <p>{message}</p><p className="state-direction">Run the Go-Terminal morning launcher, then reload this page.</p>
    </main>
  )
}

export function TodayPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [state, setState] = useState<TodayState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importResult, setImportResult] = useState<ImportCommitResponse | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const load = useCallback(() => getToday().then(
    (data) => setState({ status: 'ready', data }),
    (error: unknown) => setState({
      status: 'offline',
      message: error instanceof Error ? error.message : 'Local API unavailable',
    }),
  ), [])

  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') return (
    <main id="main-content" className="state-page today-state" aria-busy="true">
      <div className="state-mark" aria-hidden="true">···</div>
      <p className="eyebrow">Opening daily workspace</p><h1>Reading the latest local research run</h1>
    </main>
  )
  if (state.status === 'offline') return <TodayOffline message={state.message} />

  const { data } = state
  const run = data.run
  const quoted = data.dashboard.items.filter((item) => item.snapshot).length
  const runTone = run?.status === 'success' ? 'good' : run ? 'warn' : 'quiet'
  return (
    <main id="main-content" className="today-page">
      <section className="today-hero page-enter page-enter--1">
        <div>
          <p className="eyebrow">Daily research workspace / {when(data.generatedAt)}</p>
          <h1>Today, with the evidence attached.</h1>
          <p className="today-deck">A deterministic brief from your registered instruments, local cache, sourced news, and dated events.</p>
        </div>
        <button className="morning-refresh" disabled={refreshing} onClick={async () => {
          setRefreshing(true)
          try { await refreshAll(); await load() } finally { setRefreshing(false) }
        }}>{refreshing ? 'Refreshing all sources…' : 'Run morning refresh'}</button>
      </section>

      <div className="today-grid page-enter page-enter--2">
        <aside className="run-spine" aria-labelledby="run-title">
          <p className="eyebrow">Latest receipt</p><h2 id="run-title">Refresh run</h2>
          <div className={`run-state run-state--${runTone}`}><span>{run?.status ?? 'not run'}</span><strong>{run?.id.slice(0, 8) ?? '—'}</strong></div>
          <dl className="receipt-list">
            <div><dt>Completed</dt><dd>{when(run?.finishedAt ?? null)}</dd></div>
            <div><dt>Coverage</dt><dd>{quoted} / {data.dashboard.items.length} quoted</dd></div>
            <div><dt>Written</dt><dd>{run ? countLabel(run.recordCounts) : 'Run a refresh to create a receipt'}</dd></div>
          </dl>
          {run && <div className="receipt-exports"><a href={runExportUrl(run.id, 'csv')} download>CSV receipt</a><a href={runExportUrl(run.id, 'xlsx')} download>Workbook</a></div>}
          <div className="provider-run-list">
            {run?.providers.map((provider) => <div key={provider.provider}><i className={`health-dot health-dot--${provider.healthState}`} /><span>{provider.provider}</span><small>{provider.healthState.replaceAll('_', ' ')}</small></div>)}
          </div>
        </aside>

        <section className="brief-column" aria-labelledby="brief-title">
          <div className="section-heading"><div><p className="eyebrow">Priority ordered / rule generated</p><h2 id="brief-title">What needs attention</h2></div></div>
          {data.alerts.length ? <ol className="alert-ledger">{data.alerts.map((alert) => (
            <li key={alert.id}>
              <span className="alert-priority">P{alert.priority}</span>
              <div><small>{alert.kind.replaceAll('_', ' ')}{alert.symbol ? ` · ${alert.symbol}` : ''}</small><h3>{alert.title}</h3><p>{alert.observation}</p><details><summary>Evidence rule</summary><code>{alert.rule}</code><span>{alert.source} · {when(alert.timestamp)}</span></details></div>
            </li>
          ))}</ol> : <div className="empty-brief"><span aria-hidden="true">✓</span><h3>No attention rules fired</h3><p>The latest stored observations are inside the configured coverage, freshness, and move thresholds.</p></div>}

          <section className="today-news" aria-labelledby="today-news-title"><p className="eyebrow">Collected in this run</p><h2 id="today-news-title">New sourced context</h2>
            {data.news.length ? <ol>{data.news.slice(0, 6).map((item) => <li key={item.id}><time>{when(item.publishedAt)}</time><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><small>{item.source}</small></li>)}</ol> : <p className="empty-copy">No new, unique headlines were collected in the latest run.</p>}
          </section>
        </section>

        <aside className="exception-column" aria-labelledby="exceptions-title">
          <p className="eyebrow">Visible exceptions</p><h2 id="exceptions-title">Provider health</h2>
          {data.providerProblems.length ? <div className="exception-list">{data.providerProblems.map((provider) => <article key={provider.provider}><div><i className={`health-dot health-dot--${provider.healthState}`} /><strong>{provider.provider}</strong></div><span>{provider.healthState.replaceAll('_', ' ')}</span><p>{provider.lastError || provider.detail}</p>{provider.cachedCoverage > 0 && <small>{provider.cachedCoverage} cached records available</small>}</article>)}</div> : <p className="empty-copy">All active providers report healthy.</p>}
          <button className="text-action" type="button" onClick={() => onNavigate('/dashboard')}>Open full universe →</button>

          <section className="import-drawer" aria-labelledby="import-title"><p className="eyebrow">Optional local handoff</p><h2 id="import-title">Import records</h2><p>Preview CSV or JSON before anything is written.</p>
            <label className="file-action">Choose file<input type="file" accept=".csv,.json,text/csv,application/json" onChange={async (event) => {
              const file = event.target.files?.[0]; if (!file) return
              setImportError(null); setImportResult(null)
              try { setPreview(await previewImport(file)) } catch (error) { setImportError(error instanceof Error ? error.message : 'Preview failed') }
            }} /></label>
            {preview && <div className={`import-preview ${preview.valid ? 'import-preview--valid' : 'import-preview--error'}`}><strong>{preview.valid ? `${preview.totalRows} rows ready` : 'Import needs attention'}</strong><span>{countLabel(preview.typeCounts)}</span>{preview.errors.slice(0, 3).map((error) => <small key={`${error.row}-${error.field}`}>Row {error.row} · {error.field}: {error.message}</small>)}{preview.valid && preview.token && <button type="button" onClick={async () => { try { setImportResult(await commitImport(preview.token!)); setPreview(null); await load() } catch (error) { setImportError(error instanceof Error ? error.message : 'Commit failed') } }}>Commit validated records</button>}</div>}
            {importResult && <p className="import-success" role="status">Imported {countLabel(importResult.typeCounts)}.</p>}{importError && <p className="import-error" role="alert">{importError}</p>}
          </section>
        </aside>
      </div>
    </main>
  )
}
