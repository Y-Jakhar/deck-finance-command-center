# Final GitHub release approval — Deck / Finance Command Center

**Prepared 19 October 2026. Proposed repository:** `deck-finance-command-center`. **Recommendation: GO for owner review of this exact 117-file candidate; NO-GO to publish until the owner gives separate final publication approval.** This report is a clearance record, not a publication action. The source-only candidate contains no Git metadata or installed/build artifacts.

## Owner authorization and scope

The project owner explicitly confirmed that Go-Terminal, DealLens, and Deck originated from their own code and approved MIT distribution of code they own. The owner separately specified the public attribution **“Yash Jakhar, 2026.”** Accordingly, the root `LICENSE` is the standard MIT text with `Copyright (c) 2026 Yash Jakhar`. This statement covers owner-controlled original and adapted Deck source. It does not purport to relicense independently owned dependencies, fonts, external data, or assets.

The 24 flagged frontend files below were checked against the sibling paths, available local history, headers, and contribution clues. The Go-Terminal checkout shows three visible commits by the placeholder `Go-Terminal Local` identity during August 2026; DealLens has one August 2026 snapshot attributed to Yash Jakhar. No root license, per-file copyright/license header, or identified outside contribution was found in the reviewed sibling material. Those observations establish lineage clues, not rights by themselves; the owner's explicit statement supplies the MIT permission for their material. The visible histories are short snapshots and cannot prove that no undisclosed contributor exists. A later discovery of an independently owned contribution requires a fresh file-specific review.

## File-by-file rights matrix

`Exact` means byte-identical to the identified sibling file in the original review; `Overlap` records substantial normalized-line overlap. First/last commits are *visible local history* and their author labels are apparent commit identities. The decision column applies the owner's grant to the included candidate files; no sibling repository is itself included.

| Candidate file | Apparent source path and relationship | Visible development history / apparent author | Rights decision / attribution |
| --- | --- | --- | --- |
| `frontend/src/App.tsx` | Go-Terminal/`frontend/src/App.tsx`; Overlap 42.9% | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/AppFrame.test.tsx` | Go-Terminal/`frontend/src/components/AppFrame.test.tsx`; Overlap 88.2% | 1 commit(s), 2026-08-31 `b6711fc` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/CandlestickChart.tsx` | Go-Terminal/`frontend/src/components/CandlestickChart.tsx`; Overlap 56.5% | 2 commit(s), 2026-08-16 `9980689` → 2026-08-27 `9bd16fd`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/MarketPulseRail.tsx` | Go-Terminal/`frontend/src/components/MarketPulseRail.tsx`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/ResearchTabs.tsx` | Go-Terminal/`frontend/src/components/ResearchTabs.tsx`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/StatusBadge.tsx` | Go-Terminal/`frontend/src/components/StatusBadge.tsx`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/UniversalSearch.tsx` | Go-Terminal/`frontend/src/components/UniversalSearch.tsx`; Exact | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/components/WorkspaceRail.tsx` | Go-Terminal/`frontend/src/components/WorkspaceRail.tsx`; Overlap 96.0% | 1 commit(s), 2026-08-31 `b6711fc` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/main.tsx` | Go-Terminal/`frontend/src/main.tsx`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/DashboardPage.test.tsx` | Go-Terminal/`frontend/src/pages/DashboardPage.test.tsx`; Overlap 73.1% | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/DashboardPage.tsx` | Go-Terminal/`frontend/src/pages/DashboardPage.tsx`; Overlap 91.1% | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/InstrumentPage.test.tsx` | Go-Terminal/`frontend/src/pages/InstrumentPage.test.tsx`; Overlap 66.0% | 2 commit(s), 2026-08-16 `9980689` → 2026-08-27 `9bd16fd`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/InstrumentPage.tsx` | Go-Terminal/`frontend/src/pages/InstrumentPage.tsx`; Overlap 86.1% | 3 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/TodayPage.test.tsx` | Go-Terminal/`frontend/src/pages/TodayPage.test.tsx`; Exact | 1 commit(s), 2026-08-31 `b6711fc` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/pages/TodayPage.tsx` | Go-Terminal/`frontend/src/pages/TodayPage.tsx`; Exact | 1 commit(s), 2026-08-31 `b6711fc` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/services/instrumentService.test.ts` | Go-Terminal/`frontend/src/services/instrumentService.test.ts`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/services/instrumentService.ts` | Go-Terminal/`frontend/src/services/instrumentService.ts`; Overlap 96.8% | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/styles.css` | Go-Terminal/`frontend/src/styles.css`; Exact | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/test/fixtures.ts` | Go-Terminal/`frontend/src/test/fixtures.ts`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/test/setup.ts` | Go-Terminal/`frontend/src/test/setup.ts`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/types/market.ts` | Go-Terminal/`frontend/src/types/market.ts`; Exact | 2 commit(s), 2026-08-16 `9980689` → 2026-08-31 `b6711fc`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/types/valuation.ts` | DealLens/`frontend/src/types.ts`; Exact | 1 commit(s), 2026-08-31 `31438cf` → 2026-08-31 `31438cf`; Yash Jakhar | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |
| `frontend/src/vite-env.d.ts` | Go-Terminal/`frontend/src/vite-env.d.ts`<br>DealLens/`frontend/src/vite-env.d.ts`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local<br>1 commit(s), 2026-08-31 `31438cf` → 2026-08-31 `31438cf`; Yash Jakhar | Generic declaration present in both owner repositories; covered by owner MIT grant. |
| `frontend/vite.config.ts` | Go-Terminal/`frontend/vite.config.ts`; Exact | 1 commit(s), 2026-08-16 `9980689` → 2026-08-16 `9980689`; Go-Terminal Local | Owner-authorized MIT shared source; retain root MIT notice and acknowledge Go-Terminal/DealLens origin. |

## Independently owned material and notices

The specific inputs to a local Open Design prototype could not be established. The prototype PDF, derived `frontend/src/components/open-design.css`, corresponding prototype UI edits, and its earlier screenshots were **excluded**. The candidate restores the saved pre-prototype Deck interface and contains newly captured empty-session screenshots of that interface. This resolves the unconfirmed prototype right without assuming that a general Open Design FAQ covers those particular inputs. No externally sourced image, template, or hosted asset was found in the public file inventory.

`THIRD_PARTY_NOTICES.md` identifies the distinct package and font terms. `docs/licenses/` contains the full SIL Open Font License text and copyright notices for bundled Space Grotesk, IBM Plex Sans, and IBM Plex Mono emitted by a downstream frontend build. `docs/DEPENDENCY_LICENSE_INVENTORY.md` lists metadata for the 38 pinned Python and 206 locked npm packages. The source candidate contains their manifests but no installed dependency tree or compiled font binaries. Any future redistribution of `node_modules`, Python wheels, or built output needs the corresponding complete package licenses and notices; the source-only clearance does not itself clear a binary bundle. Optional Go-Terminal, DealLens, and StrategyLab checkouts and provider datasets are absent.

## Dependency security and checks

The original Python lock's Starlette 0.47.3 and pytest 8.4.1 advisories were remediated by applying the isolated trial: FastAPI **0.146.0**, Starlette **1.9.0**, pytest **9.1.1**, and added annotated-doc **0.0.5**. The final lock has 38 exact version pins. Starlette 1.9.0 exceeds the patched versions for the seven unique advisories in the earlier review, including [GHSA-7f5h-v6xp-fcq8](https://github.com/advisories/GHSA-7f5h-v6xp-fcq8). No advisory was suppressed. `pip-audit -r requirements-lock.txt --no-deps --disable-pip --format json` examined all 38 pins and reported **zero known vulnerabilities**. The version lock does not include distribution artifact hashes, a reproducibility limitation for future hardening.

The independent clean copy used Python 3.13, Node.js 24 and npm. Its runtime data directory was newly initialized, and its optional-project path deliberately contained no sibling engines. The following checks were run on that copy after the source and styling exclusions:

| Check | Result |
| --- | --- |
| `pip install -r requirements-lock.txt`; `pip check` | PASS; no broken requirements |
| `pip-audit` on exact lock | PASS; 38 dependencies, zero known vulnerabilities |
| `pytest -q tests` | PASS; 5 tests |
| `ruff check .` | PASS |
| `npm ci`; `npm test` | PASS; 43 tests in 16 files, with two test workers |
| `npm run lint` | PASS; TypeScript static check (`tsc -b --pretty false`); no separate ESLint ruleset is configured |
| `npm run build` | PASS; 74 modules transformed, production frontend generated in QA copy only |
| `npm audit --audit-level=low` | PASS; zero vulnerabilities |
| Synthetic backend/file smoke | PASS; fresh database, route status, CSV upload preview, journal create/update/stale revision/export, invalid valuation 422, HTML/assets, Range 206, missing asset 404, optional market/valuation/strategy/AI unavailable states |
| Browser sweep against isolated loopback backend | PASS; Home, Markets, Investment Banking, Quant & Trading, Portfolio & Risk, Research Journal, Settings, and Copilot controls reached; Market states “Market integration unavailable” for expected optional HTTP 503 |
| Screenshot review | PASS; both PNGs show empty local state and contain no account, research, credential, or market result |

One backend warning remains: Starlette's test client reports that its `httpx` compatibility path is deprecated in favor of `httpx2`; the five tests still pass. The empty standalone candidate cannot validate live provider feeds, real StrategyLab runs, licensed market data, or investment calculations with actual client records. Its backend is configured for loopback personal use, not an authenticated public server. The earlier full-suite timeout occurred under parallel worker contention during QA; rerunning with two workers completed all 43 tests.

## Standalone package and privacy verification

The new candidate was assembled from the 108-file standalone allowlist, then reviewed additions and changes were applied. Production databases, protected research, data directories, `.venv`, `node_modules`, `frontend/dist`, previous prototype assets, and optional sibling repositories are absent. A verifier compares every listed SHA-256 against `PUBLIC_FILE_ALLOWLIST.json`, rejects extra/missing files and prohibited formats/paths, and scans included text for key, private-key, email, and local-machine-path patterns. It does not prove absence of every kind of secret; the two screenshots were reviewed visually. The independent QA copy, not this candidate, holds installations and synthetic runtime artifacts.

## Exact publication file inventory

`PUBLIC_FILE_ALLOWLIST.json` contains the SHA-256 for every path below except itself. The verifier script is included as a source file. This inventory is the proposed publication set; any change requires regenerating the manifest and repeating checks.

- `.env.example`
- `.gitignore`
- `CONTRIBUTING.md`
- `LICENSE`
- `PUBLIC_FILE_ALLOWLIST.json`
- `README.md`
- `ResearchDesk.cmd`
- `THIRD_PARTY_NOTICES.md`
- `ai_providers.py`
- `backup_research_db.py`
- `copilot_api.py`
- `docs/DEPENDENCY_LICENSE_INVENTORY.md`
- `docs/FEATURES_AND_LIMITATIONS.md`
- `docs/FINAL_GITHUB_RELEASE_APPROVAL.md`
- `docs/INSTALLATION.md`
- `docs/RELEASE_ARCHITECTURE.md`
- `docs/RELEASE_CONFIGURATION.md`
- `docs/RELEASE_NOTES.md`
- `docs/RELEASE_TROUBLESHOOTING.md`
- `docs/licenses/IBM_PLEX_MONO_OFL.txt`
- `docs/licenses/IBM_PLEX_SANS_OFL.txt`
- `docs/licenses/SPACE_GROTESK_OFL.txt`
- `docs/release-screenshots/standalone-banking.png`
- `docs/release-screenshots/standalone-home.png`
- `finance_adapters.py`
- `financial_analysis.py`
- `financial_import.py`
- `frontend/index.html`
- `frontend/package-lock.json`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/components/AppFrame.test.tsx`
- `frontend/src/components/AppFrame.tsx`
- `frontend/src/components/CandlestickChart.tsx`
- `frontend/src/components/Copilot.test.tsx`
- `frontend/src/components/Copilot.tsx`
- `frontend/src/components/CopilotMarkdown.tsx`
- `frontend/src/components/MarketHistory.tsx`
- `frontend/src/components/MarketPulseRail.tsx`
- `frontend/src/components/ResearchTabs.tsx`
- `frontend/src/components/StatusBadge.tsx`
- `frontend/src/components/UniversalSearch.tsx`
- `frontend/src/components/WorkspaceRail.tsx`
- `frontend/src/components/copilot.css`
- `frontend/src/components/copilotContext.ts`
- `frontend/src/data/btcUsdFixture.ts`
- `frontend/src/main.tsx`
- `frontend/src/pages/CommandCenter.test.tsx`
- `frontend/src/pages/CommandCenter.tsx`
- `frontend/src/pages/DashboardPage.test.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/EvidenceReviewV2.tsx`
- `frontend/src/pages/FinancialImport.tsx`
- `frontend/src/pages/InstrumentPage.test.tsx`
- `frontend/src/pages/InstrumentPage.tsx`
- `frontend/src/pages/PortfolioLab.test.tsx`
- `frontend/src/pages/PortfolioLab.tsx`
- `frontend/src/pages/ResearchDesk.test.tsx`
- `frontend/src/pages/ResearchDesk.tsx`
- `frontend/src/pages/StrategyDatasetImport.test.tsx`
- `frontend/src/pages/StrategyDatasetImport.tsx`
- `frontend/src/pages/StrategyLibrary.test.tsx`
- `frontend/src/pages/StrategyLibrary.tsx`
- `frontend/src/pages/StrategyRunDetails.tsx`
- `frontend/src/pages/Technicals.tsx`
- `frontend/src/pages/ThreeStatementModel.test.tsx`
- `frontend/src/pages/ThreeStatementModel.tsx`
- `frontend/src/pages/TodayPage.test.tsx`
- `frontend/src/pages/TodayPage.tsx`
- `frontend/src/pages/TrustedEvidenceReview.test.tsx`
- `frontend/src/pages/TrustedEvidenceReview.tsx`
- `frontend/src/pages/VersionedValuation.tsx`
- `frontend/src/pages/WaccWorksheet.tsx`
- `frontend/src/pages/Watchlists.tsx`
- `frontend/src/pages/chartHistory.test.ts`
- `frontend/src/pages/chartHistory.ts`
- `frontend/src/pages/command-center.css`
- `frontend/src/pages/deskUtils.ts`
- `frontend/src/pages/researchdesk.css`
- `frontend/src/pages/statementDraft.test.ts`
- `frontend/src/pages/statementDraft.ts`
- `frontend/src/pages/v2EvidenceCase.ts`
- `frontend/src/pages/waccFormula.ts`
- `frontend/src/pages/waccWorksheet.test.ts`
- `frontend/src/services/instrumentService.test.ts`
- `frontend/src/services/instrumentService.ts`
- `frontend/src/styles.css`
- `frontend/src/test/fixtures.ts`
- `frontend/src/test/setup.ts`
- `frontend/src/types/market.ts`
- `frontend/src/types/valuation.ts`
- `frontend/src/vite-env.d.ts`
- `frontend/src/workspaces.ts`
- `frontend/tsconfig.app.json`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- `frontend/vite.config.ts`
- `portfolio_analytics.py`
- `pyproject.toml`
- `requirements-lock.txt`
- `requirements.txt`
- `research_strategies.py`
- `researchdesk.py`
- `standalone_market.py`
- `start.ps1`
- `strategy_import.py`
- `tests/test_standalone_release.py`
- `tests/test_trusted_evidence_review.py`
- `three_statement.py`
- `three_statement_v2.py`
- `three_statement_v2_api.py`
- `three_statement_v2_storage.py`
- `three_statement_workbook.py`
- `trusted_evidence_review.py`
- `verify_release_candidate.py`
- `versioned_valuation.py`
- `versioned_workbook.py`

## Final decision

**GO for final owner approval of the exact allowlisted source candidate. Publication remains NO-GO until that explicit approval is received.** The name `deck-finance-command-center` is only a proposal. No repository was created, Git initialized, change committed, code pushed, application deployed, or release published. The owner should approve the exact contents and MIT/third-party notices before any publication action; a later binary distribution or newly discovered third-party contribution needs separate clearance.
