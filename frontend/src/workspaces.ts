export const workspaces = [
  { key: 'market', name: 'Market Intelligence', path: '/market', tag: 'OBSERVE', description: 'Inspect markets, instruments and sources. Keep a watchlist and research companies.', features: 'Market dashboard · Historical prices · Watchlists' },
  { key: 'banking', name: 'Investment Banking Lab', path: '/banking', tag: 'VALUE', description: 'Build a sourced valuation case. Review cash flows, comparable companies and sensitivity.', features: 'Statements · DCF · Trading comps · Saved cases' },
  { key: 'quant', name: 'Quant & Trading Lab', path: '/quant', tag: 'TEST', description: 'Test rules against historical observations. Retain costs, failure criteria and unseen results.', features: 'Backtests · Indicators · Walk-forward · Comparisons' },
  { key: 'portfolio', name: 'Portfolio & Risk Lab', path: '/portfolio', tag: 'MEASURE', description: 'Study historical holdings and risk. Inspect source-backed volatility forecasts.', features: 'Buy-and-hold analysis · Correlation · Volatility Lens' },
]

export const researchRoutes: Record<string, string> = { prices: '/market/history', company: '/market/company', valuation: '/banking', strategy: '/quant', journal: '/journal', settings: '/settings' }

export function workspaceFor(path: string) {
  if (path.startsWith('/instrument/') || path === '/dashboard' || path === '/today' || path === '/research/company') return workspaces[0]
  if (path === '/research/valuation') return workspaces[1]
  if (path === '/research/strategy') return workspaces[2]
  return workspaces.find(w => path === w.path || path.startsWith(w.path + '/'))
}
