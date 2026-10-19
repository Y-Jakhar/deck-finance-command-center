# Installation and clean standalone start

This guide applies to the source-only release candidate. The tested setup uses Python 3.13, Node.js 24/npm, and PowerShell on Windows. A fresh runtime must use an empty directory; do not point it at an existing research database.

## Windows PowerShell

From the candidate root:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
& .\.venv\Scripts\python.exe -m pip check
Push-Location frontend
npm ci
npm run build
Pop-Location
$env:RESEARCHDESK_DATA = (Join-Path $PWD 'local-runtime')
$env:RESEARCHDESK_PROJECTS = (Join-Path $PWD 'absent-optional-engines')
& .\.venv\Scripts\python.exe -m uvicorn researchdesk:app --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010/`. The backend creates the SQLite database in `local-runtime`. Keep that directory private and outside any later source archive. `start.ps1` is a convenience shortcut that installs `requirements.txt` and defaults to `data/`; set `RESEARCHDESK_DATA` first if using it.

## Expected first-run state

Home, Investment Banking, Quant & Trading, Portfolio & Risk, Research Journal, and Settings render without sibling projects. Market search and provider-backed routes return unavailable states. Strategy validation and runs require StrategyLab. AI controls report unconfigured providers until a backend credential is supplied. These are honest capability boundaries, not demonstration market data.

## Optional integrations

Set `RESEARCHDESK_PROJECTS` to the parent of authorized local Go-Terminal, DealLens, and StrategyLab checkouts if you have them. The release archive does not contain those repositories. Set provider keys only in backend environment variables, never in frontend source or `.env` files meant for GitHub. See [configuration](RELEASE_CONFIGURATION.md) and [troubleshooting](RELEASE_TROUBLESHOOTING.md).

## Verification commands

```powershell
& .\.venv\Scripts\python.exe -m pytest -q tests
Push-Location frontend
npm test
npm run lint
npm run build
npm audit --audit-level=low
Pop-Location
```

Run Python security auditing against `requirements-lock.txt` with `pip-audit`; the release report records the exact command and outcome. The app is loopback-only and has no general multi-user authentication boundary.
