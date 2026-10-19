import { useEffect, useRef, useState } from 'react'
import { searchInstruments } from '../services/instrumentService'
import type { Instrument } from '../types/market'

export function UniversalSearch({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [active, setActive] = useState(0)
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); setMessage(''); return }
    let activeRequest = true
    const timer = window.setTimeout(async () => {
      try {
        const items = await searchInstruments(query.trim())
        if (activeRequest) { setResults(items); setActive(0); setMessage(items.length ? '' : 'No registered instruments found') }
      } catch (error) {
        if (activeRequest) { setResults([]); setMessage(error instanceof Error ? error.message : 'Search unavailable') }
      }
    }, 180)
    return () => { activeRequest = false; window.clearTimeout(timer) }
  }, [query])

  const choose = (instrument: Instrument) => {
    setQuery(''); setResults([]); onNavigate(`/instrument/${encodeURIComponent(instrument.id)}`)
  }

  return (
    <div className="universal-search">
      <label className="sr-only" htmlFor="universal-search">Search every instrument</label>
      <span aria-hidden="true">⌕</span>
      <input
        ref={inputRef} id="universal-search" name="instrument-search" type="search" value={query}
        placeholder="Search symbol, FIGI, series, or market…" autoComplete="off"
        aria-expanded={Boolean(query)} aria-controls="search-results"
        aria-activedescendant={results[active] ? `search-result-${active}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)) }
          if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
          if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active]) }
          if (event.key === 'Escape') { setQuery(''); setResults([]) }
        }}
      />
      <kbd>Ctrl K</kbd>
      {query && (
        <div className="search-popover" id="search-results" role="listbox" aria-label="Instrument search results">
          {results.map((instrument, index) => (
            <button
              id={`search-result-${index}`} role="option" aria-selected={active === index}
              key={instrument.id} type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(instrument)}
            >
              <span className="search-symbol">{instrument.displaySymbol}</span>
              <span>{instrument.name}</span>
              <small>{instrument.assetClass} · {Object.keys(instrument.providerMappings).join(' + ')}</small>
            </button>
          ))}
          {message && <p className="search-message" role="status">{message}</p>}
        </div>
      )}
    </div>
  )
}
