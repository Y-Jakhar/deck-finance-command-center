# FCC — Finance Command Center

**Turn financial research into a record you can revisit.** FCC brings statements, valuation scenarios, strategy experiments, portfolio context, and research notes into one local workspace. It keeps sources, assumptions, and revisions close to the decision they support.

Built with React, TypeScript, and FastAPI, FCC runs on your computer with a private SQLite database. The light-themed interface has seven connected workspaces. It starts empty: screenshots below show the standalone app without live market data or illustrative financial results.

## See the workspace

**Overview** — move between research areas and open saved local valuations, experiments, and journal entries.

![FCC light-themed Overview showing an empty local research workspace](docs/release-screenshots/standalone-home.png)

**Investment Banking** — import statements, inspect evidence, and build source-linked valuation cases with explicit scenarios.

![FCC light-themed Investment Banking workspace showing financial import and evidence review](docs/release-screenshots/standalone-banking.png)

## Follow the research trail

- **Bring in financial statements.** Preview CSV, XLSX, or text-readable PDF files, then review mappings, units, periods, and source references before saving a snapshot.
- **Model with visible assumptions.** Work through independent three-statement and versioned FCFF cases, including bear, base, and bull scenarios. Keep evidence review separate from approval.
- **Retain your reasoning.** Link valuations and other research to journal entries that preserve revisions and exports.
- **See what is available.** Market feeds, legacy DealLens valuation, StrategyLab simulations, and AI providers identify when their optional engines or credentials are absent. FCC does not substitute demonstration figures for live results.

| Workspace | Standalone experience | Optional integration |
| --- | --- | --- |
| **Overview** | Navigation and saved local research records | None |
| **Market Intelligence** | Source and availability states | Go-Terminal for instruments, quotes, and history |
| **Investment Banking** | Statement import, evidence review, three-statement and versioned DCF previews | DealLens for legacy valuation |
| **Quant & Trading** | Dataset import controls and engine status | StrategyLab for validation and simulated runs |
| **Portfolio & Risk** | Empty and saved-record views | Validated datasets for new metrics |
| **Research Journal** | Local entries, revisions, and exports | None |
| **Settings** | Storage and provider status | Backend credentials for AI Copilot |

Read the [feature boundaries](docs/FEATURES_AND_LIMITATIONS.md) before using outputs in research. Simulated fills are not orders; financial inputs and assumptions require independent review.

## Run FCC locally

The verified setup uses **Python 3.13**, **Node.js 24/npm**, and **Windows PowerShell**. From a fresh clone:

```powershell
git clone https://github.com/Y-Jakhar/deck-finance-command-center.git
Set-Location deck-finance-command-center
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
Push-Location frontend
npm ci
npm run build
Pop-Location
$env:RESEARCHDESK_DATA = (Join-Path $PWD 'local-runtime')
$env:RESEARCHDESK_PROJECTS = (Join-Path $PWD 'absent-optional-engines')
& .\.venv\Scripts\python.exe -m uvicorn researchdesk:app --host 127.0.0.1 --port 8010
```

Open **http://127.0.0.1:8010/**. FCC creates a new local SQLite database in `local-runtime`. Keep that directory private. The server listens on loopback and is not designed as an authenticated public service. For optional engines and credentials, use the [installation](docs/INSTALLATION.md) and [configuration](docs/RELEASE_CONFIGURATION.md) guides.

## Verify the source

Run `python -m pytest -q tests`, `python -m ruff check .`, and `python -m pip check` in the Python environment. In `frontend`, run `npm test`, `npm run lint`, `npm run build`, and `npm audit --audit-level=low`. The [light-theme release verification](docs/LIGHT_THEME_RELEASE.md) records the completed checks and workflows that could not be exercised without optional providers.

## Source, privacy, and license

This public repository contains source and empty-session screenshots. It does not bundle production databases, private research, licensed market datasets, optional sibling engines, installed dependencies, or built frontend assets. The Overview displays saved application state; its empty screenshot contains no fabricated financial figures.

FCC was previously named Deck; the repository URL and history are preserved. Copyright © 2026 Yash Jakhar. Owner-controlled source is licensed under [MIT](LICENSE); dependencies and fonts retain their own terms in [third-party notices](THIRD_PARTY_NOTICES.md). No investment result, market feed, backtest, or AI response is guaranteed.
