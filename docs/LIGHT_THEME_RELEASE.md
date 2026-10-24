# FCC light-theme release verification — 24 October 2026

This document records verification of the source-only redesign on `feature/light-theme-redesign`. The earlier [publication clearance](FINAL_GITHUB_RELEASE_APPROVAL.md) describes the original 19 October source release and remains a historical record.

## Interface and feature preservation

The seven sidebar destinations rendered in the local browser: Overview, Market Intelligence, Investment Banking, Quant & Trading, Portfolio & Risk, Research Journal, and Settings. Overview reads saved valuation, experiment, and journal records from `/api/desk`; empty records show empty states. Banking retained statement import, three-statement evidence review, integrated modeling, versioned FCFF scenarios, and legacy comparables. The BEAR scenario disclosure opened in the browser. Copilot opened and accurately reported that its backend credential was missing. The tablet sidebar opened and closed at an 820-pixel emulated width. The design uses `prefers-reduced-motion` to suppress transitions and animations.

The existing standalone backend tests exercise synthetic statement save and analysis, versioned FCFF preview and numerical assertions, journal creation, optional-provider responses, and database integrity. A fresh synthetic CSV upload to `/api/desk/financials/preview` returned two unverified candidates with their source-row references. Existing frontend tests cover navigation, market, strategy, portfolio, evidence, Copilot, and other controls. No production financial dataset was used.

## Release checks

| Check | Result |
| --- | --- |
| Frontend tests | 43 passed in 16 files |
| TypeScript (`npm run lint`) | Passed; this script runs `tsc -b` |
| Production build | Passed |
| npm audit (`--audit-level=low`) | Zero reported vulnerabilities |
| Backend tests | 5 passed; one Starlette test-client deprecation warning |
| Ruff and pip dependency consistency | Passed |
| Python locked-package audit | No known vulnerabilities after updating certifi to 2026.10.23, Pillow to 13.0.0, and pypdf to 6.21.2 |
| Public source inventory | 119 files, 118 hashed manifest entries; zero verifier findings |

The inventory excludes `.venv`, `frontend/node_modules`, `frontend/dist`, runtime SQLite data, optional sibling repositories, private research, uploaded filings, and the OpenDesign prototype. The two README screenshots were captured from an empty local session and reviewed visually. No financial figure in the redesigned Overview is fabricated; saved figures appear only from local application state. The user-facing FCC name does not change the existing repository URL or project history. Existing MIT and third-party notices remain in place.

## Limits of this verification

Optional Go-Terminal, DealLens, StrategyLab, and AI provider credentials or engines were unavailable in the isolated local runtime, so live quotes, legacy valuation execution, StrategyLab backtests, and provider-generated Copilot answers could not be tested end to end. Their unavailable states are expected. Live financial inputs and real investment outcomes were not validated. The backend is intended for loopback use. The Python lock remains version-pinned without distribution artifact hashes.
