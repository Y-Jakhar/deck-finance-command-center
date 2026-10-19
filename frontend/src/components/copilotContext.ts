export type CopilotSelection = {
  workspace: string; symbol: string; journal_ids?: string[]; valuation_id?: string | null;
  experiment_id?: string | null; portfolio_id?: string | null; dataset_id?: string | null;
  indicators?: string[]; range?: string;
  annual_bars?: number; indicator_period?: number; benchmark_id?: string | null;
}
let current: CopilotSelection = { workspace: 'general', symbol: '' }
export function publishCopilotSelection(selection: CopilotSelection) {
  current = selection
  window.dispatchEvent(new CustomEvent('researchdesk:context', { detail: selection }))
}
export function getCopilotSelection() { return current }
