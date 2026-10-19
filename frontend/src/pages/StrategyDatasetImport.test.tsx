import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { StrategyDatasetImport } from './StrategyDatasetImport'

afterEach(() => vi.unstubAllGlobals())

it('maps an uploaded worksheet before exposing validated canonical OHLCV', async () => {
  const columns = ['Date', 'OpenPx', 'HighPx', 'LowPx', 'Last', 'Shares']
  const mapping = Object.fromEntries(['timestamp', 'open', 'high', 'low', 'close', 'volume'].map((field, index) => [field, columns[index]]))
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    return { ok: true, json: async () => url.endsWith('import-preview')
      ? { filename: 'prices.xlsx', original_sha256: 'a'.repeat(64), columns, row_count: 25,
          sample: [['2024-01-01', '10', '11', '9', '10', '100']], suggested_mapping: mapping }
      : { csv_text: 'timestamp,open,high,low,close,volume\n2024-01-01,10,11,9,10,100\n',
          import_provenance: { original_sha256: 'a'.repeat(64), column_mapping: mapping },
          validation: { status: 'valid', row_count: 25, date_start: '2024-01-01', date_end: '2024-02-01', file_hash: 'b'.repeat(64), issues: [] } } }
  }))
  const onValidated = vi.fn()
  render(<StrategyDatasetImport onValidated={onValidated} />)
  await userEvent.upload(screen.getByLabelText('Choose OHLCV CSV or XLSX'), new File(['test'], 'prices.xlsx'))
  expect(await screen.findByText(/25 source rows/)).toBeInTheDocument()
  expect(screen.getByLabelText('Map timestamp')).toHaveValue('Date')
  await userEvent.click(screen.getByRole('button', { name: 'Validate mapped OHLCV' }))
  expect(await screen.findByText(/ready for metadata review/)).toBeInTheDocument()
  expect(onValidated).toHaveBeenLastCalledWith(expect.stringContaining('timestamp,open'), expect.objectContaining({ status: 'valid' }), expect.objectContaining({ original_sha256: 'a'.repeat(64) }))
  expect(calls).toEqual(['/api/desk/datasets/import-preview', '/api/desk/datasets/import-normalize'])
})
