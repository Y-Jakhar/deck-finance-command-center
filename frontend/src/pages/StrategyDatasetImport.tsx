import { useState } from 'react'

const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const
type Preview = { filename: string; original_sha256: string; columns: string[]; row_count: number; sample: string[][]; suggested_mapping: Record<string, string> }
type Quality = { status: string; row_count: number; date_start: string | null; date_end: string | null; file_hash: string; issues: Array<{ severity: string; code: string; message: string; row?: number }> }

async function upload(path: string, file: File, mapping?: Record<string, string>) {
  const form = new FormData()
  form.append('file', file)
  if (mapping) form.append('mapping', JSON.stringify(mapping))
  const response = await fetch(`/api/desk/datasets/${path}`, { method: 'POST', body: form })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail))
  return result
}

export function StrategyDatasetImport({ onValidated }: { onValidated: (csv: string, quality: Quality, provenance: Record<string, unknown>) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function choose(selected: File | null) {
    setFile(selected); setPreview(null); setMapping({}); setMessage(''); onValidated('', { status: 'unvalidated', row_count: 0, date_start: null, date_end: null, file_hash: '', issues: [] }, {})
    if (!selected) return
    setBusy(true)
    try {
      const result = await upload('import-preview', selected) as Preview
      setPreview(result); setMapping(result.suggested_mapping)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload preview failed') }
    finally { setBusy(false) }
  }

  async function normalize() {
    if (!file) return
    setBusy(true); setMessage('')
    try {
      const result = await upload('import-normalize', file, mapping) as { csv_text: string; validation: Quality; import_provenance: Record<string, unknown> }
      onValidated(result.csv_text, result.validation, result.import_provenance)
      setMessage(result.validation.status === 'valid' ? 'Mapped OHLCV ready for metadata review and saving.' : 'Resolve fatal validation issues before saving.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Mapping failed') }
    finally { setBusy(false) }
  }

  return <div className="strategy-import"><label className="desk-file">Choose OHLCV CSV or XLSX<input type="file" accept=".csv,.xlsx" onChange={event => void choose(event.target.files?.[0] || null)} /></label>
    {preview && <><p>{preview.filename} · {preview.row_count} source rows · original SHA-256 {preview.original_sha256.slice(0, 16)}…</p>
      <div className="desk-fields">{fields.map(field => <label key={field}>{field}<select aria-label={`Map ${field}`} value={mapping[field] || ''} onChange={event => setMapping({ ...mapping, [field]: event.target.value })}><option value="">Choose source column</option>{preview.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>)}</div>
      <details><summary>Inspect first five source rows</summary><div className="desk-table"><table><thead><tr>{preview.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>{preview.columns.map((column, cell) => <td key={column}>{row[cell] || ''}</td>)}</tr>)}</tbody></table></div></details>
      <button type="button" disabled={busy || fields.some(field => !mapping[field]) || new Set(Object.values(mapping)).size !== fields.length} onClick={() => void normalize()}>Validate mapped OHLCV</button></>}
    {message && <p role="status">{message}</p>}
  </div>
}
