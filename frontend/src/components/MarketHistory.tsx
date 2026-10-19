import { useEffect, useState } from 'react'
import { CandlestickChart } from './CandlestickChart'
import { getCandleSeries } from '../services/instrumentService'
import { chartRanges, parseSavedCandles, selectChartHistory, type ChartRange } from '../pages/chartHistory'
import type { Candle, Instrument, InstrumentPageData } from '../types/market'

type SavedDataset = { id: string; symbol: string; csv_text: string; source: string; frequency: string; currency: string; adjustment_policy: string; timestamp_policy: string }
type Series = { candles: Candle[]; interval: string; source: string; policy: string; note: string }

export function MarketHistory({ instrument, initial }: { instrument: Instrument; initial?: InstrumentPageData }) {
  const [range, setRange] = useState<ChartRange>('1D')
  const [datasets, setDatasets] = useState<SavedDataset[]>([])
  const [loadedSymbol, setLoadedSymbol] = useState('')
  const [choice, setChoice] = useState('auto')
  const [mode, setMode] = useState<'candles' | 'line'>('candles')
  const [showVolume, setShowVolume] = useState(false)
  const [logScale, setLogScale] = useState(false)
  const [zoom, setZoom] = useState(2)
  const [series, setSeries] = useState<Series | null>(initial ? {
    candles: initial.candles, interval: initial.candleInterval, source: initial.candles[0]?.source || 'Market provider',
    policy: initial.candles[0]?.adjustmentStatus || 'Provider policy unavailable', note: 'Provider or cached market series',
  } : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setDatasets(previous => previous.length ? [] : previous); setLoadedSymbol(''); setChoice('auto'); setRange('1D')
    fetch('/api/desk/datasets?symbol=' + encodeURIComponent(instrument.displaySymbol))
      .then(response => { if (!response.ok) throw new Error('Saved history unavailable'); return response.json() as Promise<SavedDataset[]> })
      .then(items => { if (active) { const available = Array.isArray(items) ? items.filter(item => item.symbol === instrument.displaySymbol && (item.frequency === '1d' || item.frequency === '1h')) : []; if (available.length) setDatasets(available); setLoadedSymbol(instrument.displaySymbol) } })
      .catch(() => { if (active) setLoadedSymbol(instrument.displaySymbol) })
    return () => { active = false }
  }, [instrument.id, instrument.displaySymbol])

  useEffect(() => {
    let active = true
    const interval = instrument.assetClass === 'crypto' && range === '1D' ? '1h' : '1d'
    const selected = choice === 'auto' ? null : datasets.find(item => item.id === choice)
    const fallback = datasets.filter(item => item.symbol === instrument.displaySymbol && (item.frequency === interval || (interval === '1h' && item.frequency === '1d')))
      .sort((a, b) => b.csv_text.length - a.csv_text.length)[0]
    const savedSeries = (item: SavedDataset): Series => ({
      candles: parseSavedCandles(item.csv_text, instrument.id, item.source, item.frequency), interval: item.frequency,
      source: item.source, policy: item.adjustment_policy, note: `Saved historical snapshot · ${item.timestamp_policy}`,
    })
    if (selected) {
      setBusy(false)
      try { setSeries(savedSeries(selected)); setError('') } catch (reason) { setSeries(null); setError(reason instanceof Error ? reason.message : 'Saved history could not be read.') }
      return () => { active = false }
    }
    if (!initial && loadedSymbol !== instrument.displaySymbol) { setBusy(true); setSeries(null); return () => { active = false } }
    if (!initial && fallback) {
      setBusy(false)
      try { setSeries(savedSeries(fallback)); setError('Current quote unavailable; showing a saved historical snapshot.') }
      catch (reason) { setSeries(null); setError(reason instanceof Error ? reason.message : 'Saved history could not be read.') }
      return () => { active = false }
    }
    if (initial && range === '1D' && initial.candleInterval === interval) {
      setBusy(false)
      setSeries({ candles: initial.candles, interval, source: initial.candles[0]?.source || 'Market provider',
        policy: initial.candles[0]?.adjustmentStatus || 'Provider policy unavailable', note: 'Provider or cached market series' })
      setError(''); return () => { active = false }
    }
    setBusy(true); setSeries(null); setError('')
    getCandleSeries(instrument.id, interval).then(result => {
      if (!active) return
      setSeries({ candles: result.candles, interval: result.interval, source: result.source,
        policy: result.candles[0]?.adjustmentStatus || 'Provider policy unavailable', note: `${result.cacheStatus.replaceAll('_', ' ')} · ${result.freshness.label}` })
    }).catch(reason => {
      if (!active) return
      if (fallback) {
        try { setSeries(savedSeries(fallback)); setError(`Market provider unavailable; displaying saved history. ${reason instanceof Error ? reason.message : ''}`) }
        catch (parseError) { setSeries(null); setError(parseError instanceof Error ? parseError.message : 'Saved history could not be read.') }
      } else { setSeries(null); setError(reason instanceof Error ? reason.message : 'Historical data unavailable.') }
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [instrument.id, instrument.displaySymbol, instrument.assetClass, range, choice, datasets, loadedSymbol, initial])

  const selected = series ? selectChartHistory(series.candles, range) : null
  const high = selected?.visible.length ? Math.max(...selected.visible.map(c => c.high)) : null
  const low = selected?.visible.length ? Math.min(...selected.visible.map(c => c.low)) : null
  const percent = selected?.returnPct
  const lastTimestamp = series?.candles.at(-1)?.timestamp
  const ageDays = lastTimestamp ? (Date.now() - Date.parse(lastTimestamp)) / 86400000 : null
  const currency = choice === 'auto' ? initial?.quote.currency || datasets[0]?.currency || instrument.quoteCurrency
    : datasets.find(item => item.id === choice)?.currency || instrument.quoteCurrency
  return <section className="chart-section market-history" aria-labelledby="price-history-title">
    <div className="chart-header"><div><p className="eyebrow">Price history / sourced OHLC</p><h2 id="price-history-title">{instrument.displaySymbol} historical chart</h2></div>
      <div className="range-controls" role="group" aria-label="Chart time range">{chartRanges.map(item => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div></div>
    {datasets.length > 0 && <label className="market-history__source">History source <select aria-label="History source" value={choice} onChange={event => setChoice(event.target.value)}><option value="auto">Market provider, with saved fallback</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.source} · {item.frequency} · {item.id.slice(0, 8)}</option>)}</select></label>}
    <div className="market-history__controls"><label>Chart style <select aria-label="Chart style" value={mode} onChange={event => setMode(event.target.value as 'candles' | 'line')}><option value="candles">Candlesticks</option><option value="line">Close line</option></select></label><label><input type="checkbox" checked={showVolume} onChange={event => setShowVolume(event.target.checked)} /> Volume</label><label><input type="checkbox" checked={logScale} onChange={event => setLogScale(event.target.checked)} /> Log price</label><button type="button" onClick={() => setZoom(value => Math.max(2, value / 2))} disabled={zoom <= 2} aria-label="Zoom out chart">−</button><button type="button" onClick={() => setZoom(value => Math.min(16, value * 2))} disabled={zoom >= 16} aria-label="Zoom in chart">+</button></div>
    {busy && <p role="status">Loading {range} history…</p>}
    {error && <p role="alert">{error}</p>}
    {ageDays !== null && ageDays > 7 && <p className="market-history__notice" role="status">Historical snapshot ends {lastTimestamp?.slice(0, 10)} ({Math.floor(ageDays)} days ago); it is not a current market quote.</p>}
    {selected && <><CandlestickChart candles={selected.visible} symbol={instrument.displaySymbol} currency={currency} interval={series!.interval} mode={mode} showVolume={showVolume} logScale={logScale} zoom={zoom} />
      <div className="chart-caption"><span>{range} · {selected.visible.length} visible candle{selected.visible.length === 1 ? '' : 's'}</span><span>Price return: {percent == null ? 'Unavailable' : `${percent.toFixed(2)}%`}</span><span>High: {high === null ? 'Unavailable' : high.toLocaleString()}</span><span>Low: {low === null ? 'Unavailable' : low.toLocaleString()}</span></div>
      {selected.coverage && <p className="market-history__notice" role="status">{selected.coverage}</p>}
      <p className="market-history__provenance">Last observation: {series!.candles.at(-1)?.timestamp || 'Unavailable'} · Source: {series!.source} · {series!.note} · Adjustment: {series!.policy}. Return is close-to-close price change; distributions are included only if the source adjustment reflects them.</p></>}
    {!busy && !series && <p>No compatible market history is available. <a href="/market/history">Import a sourced OHLCV CSV in Historical prices</a>.</p>}
  </section>
}
