# Configuration

`RESEARCHDESK_PROJECTS` optionally points to authorized Go-Terminal, DealLens, and StrategyLab checkouts. When unset, the app starts in standalone mode and missing engines report 503. `RESEARCHDESK_DATA` should point to an empty writable private directory for a clean run; never use production data for a release test.

Optional AI keys: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`, supplied on the backend. `RESEARCHDESK_OPENROUTER_KEY_FILE` is an explicit opt-in path to a locally held key. Copilot should report an unconfigured provider as unavailable.

Isolated evidence review uses `RESEARCHDESK_EVIDENCE_STAGING_ROOT`, `RESEARCHDESK_EVIDENCE_TOKEN_SHA256`, and `RESEARCHDESK_EVIDENCE_REVIEWER_ID` set on the server. A browser-supplied name is not identity proof. These settings do not enable production historical acceptance.

[.env.example](../.env.example) contains only placeholder values. Do not expose the local server publicly without a separate security design and review.
