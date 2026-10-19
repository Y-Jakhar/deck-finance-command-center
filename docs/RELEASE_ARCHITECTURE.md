# Release architecture

The React/Vite frontend calls a FastAPI application bound to loopback. `researchdesk.py` contains independent local research routes and composes optional Go-Terminal market services, DealLens legacy valuation, and StrategyLab strategy execution only when authorized checkouts are configured through `RESEARCHDESK_PROJECTS`. In standalone mode, `standalone_market.py` serves the built frontend and returns explicit 503 responses for unavailable market routes. Optional engines are not copied into this source package.

SQLite files and generated artifacts live under `RESEARCHDESK_DATA`, outside the source allowlist. Use a new empty directory for release tests. The v2 evidence workflow uses separate staging settings and does not write production historical acceptance. Frontend or API uploads are untrusted input; matching bytes or metadata do not prove that a disclosure supports a financial claim.

The release is source-only. The `PUBLIC_FILE_ALLOWLIST.json` manifest enumerates every included file and its SHA-256. Installed npm/Python packages, build output, sibling repositories, private records, frozen research, datasets, local logs, and credentials are excluded. Building the frontend emits bundled Space Grotesk and IBM Plex font assets; preserve their OFL notices when distributing those compiled assets. See [third-party notices](../THIRD_PARTY_NOTICES.md).

The server has no general authenticated multi-user boundary and is not intended for public internet exposure. Market data, AI providers, and optional engines have separate availability, licensing, and quality limits. See [features and limitations](FEATURES_AND_LIMITATIONS.md).
