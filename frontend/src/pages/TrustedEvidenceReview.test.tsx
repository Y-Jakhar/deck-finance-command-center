import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TrustedEvidenceReview } from './TrustedEvidenceReview'
import { emptyCase, type UploadDocument } from './v2EvidenceCase'

afterEach(() => vi.unstubAllGlobals())

it('binds isolated source review to a server identity and shows the original disclosure', async () => {
  const user = userEvent.setup()
  const token = 'review-token-' + 'x'.repeat(48)
  const calls: Array<{ url: string; authorization: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const headers = options?.headers as Record<string, string>
    calls.push({ url, authorization: headers.Authorization, body: options?.body })
    const data = url.endsWith('/identity') ? { reviewer: 'local-os-reviewer' }
      : url.endsWith('/history') ? { events: [], hash_chain_verified: true }
      : { event_hash: 'a'.repeat(64), reviewer: 'local-os-reviewer' }
    return { ok: true, json: async () => data }
  }))
  const doc: UploadDocument = { filename: 'filing.csv', hash: 'b'.repeat(64), staged: true,
    format: 'csv', limitations: '', columnPeriods: ['2025-09-27'], unitsConfirmed: true,
    unitBasis: 'USD millions', selected: {}, candidates: [{ reference: 'filing.csv · CSV row 2',
      label: 'Net sales', suggested_key: 'revenue', raw_values: ['100'] }] }
  const { container } = render(<TrustedEvidenceReview draft={emptyCase('TEST')} documents={[doc]} token={token} onToken={() => {}} />)
  await user.click(screen.getByText('Trusted source and reviewer workflow · isolated staging'))
  await user.click(screen.getByRole('button', { name: 'Connect isolated reviewer' }))
  expect(await screen.findByText('local-os-reviewer')).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Original disclosure line'), 'filing.csv · CSV row 2')
  expect(container.querySelector('.evidence-v2-compare pre')?.textContent).toContain('Net sales\n100')
  await user.type(screen.getByLabelText('Trusted reviewer notes'), 'Checked the original line and source context.')
  await user.click(screen.getByLabelText('I inspected the original staged document.'))
  await user.click(screen.getByLabelText('I checked its issuer or auditor origin.'))
  await user.click(screen.getByRole('button', { name: 'Verify inspected source' }))
  expect(await screen.findByText(/Source inspection recorded in isolated history/)).toBeInTheDocument()
  const decision = calls.find(call => call.url.endsWith('/source-review'))
  expect(decision?.authorization).toBe(`Bearer ${token}`)
  expect(decision?.body).not.toContain('reviewer')
  expect(calls.every(call => call.url.includes('/staging/'))).toBe(true)
})
