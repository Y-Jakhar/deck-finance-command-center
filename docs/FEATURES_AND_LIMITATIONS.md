# Features and limitations

Deck is a local research tool. These boundaries describe the standalone source candidate without optional engines or external credentials.

| Area | Available behavior | Limit |
| --- | --- | --- |
| Home | Workspace navigation and provider status | Status is not proof of live or complete market coverage. |
| Markets | Empty watchlists and explicit unavailable messages | Instruments, provider quotes, charts, and usable watchlist selection require Go-Terminal. Corporate-action completeness varies by source. |
| Investment Banking | Synthetic/local statement preview, independent versioned DCF and three-statement calculations, evidence views | Analyst mappings and assumptions require review. V2 historical acceptance and production valuation freeze remain disabled. DealLens v1 features need that engine. |
| Quant & Trading | Dataset import controls and engine status | StrategyLab is needed for validation, saving, and simulations. Backtest fills are modeled, not executable orders. |
| Portfolio & Risk | Empty and saved-record views | New metrics require validated datasets and can be sensitive to price adjustments, cost assumptions, and missing series. |
| Research Journal | Local entries, revisions, and export | User records may be private; no cloud sync or multi-user access control is included. |
| AI Copilot | Optional provider settings and contextual panel | Requires backend keys. Response accuracy and financial quality are not independently validated. |

The bundled BTC/USD chart fixture is synthetic UI demonstration data, not market history. No live quotes, broker execution, licensed provider dataset, private research case, or investment performance result is included. The server is for loopback personal use and should not be exposed as a public internet service without a separate security design.
