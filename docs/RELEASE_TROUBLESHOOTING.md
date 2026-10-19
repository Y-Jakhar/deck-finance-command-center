# Troubleshooting

| Symptom | Check |
| --- | --- |
| Optional engine unavailable (HTTP 503) | Standalone mode is working. Set `RESEARCHDESK_PROJECTS` to authorized optional checkouts to enable that engine. Do not copy private engine code into the release. |
| UI unavailable after backend startup | Run `npm ci` and `npm run build` in `frontend`, then restart the loopback server. |
| Market source unavailable | Check provider status, network, terms, and cached coverage. Do not label a missing quote as live. |
| Copilot unavailable | Configure an optional backend key or leave it disabled. Never put a key in frontend code. |
| Evidence review refuses an action | Check isolated staging settings, source hash, period, units, classification, and verified reviewer identity. Review stages are independent. |
| Valuation reconciliation blocked | Inspect missing inputs and accounting differences. Do not substitute zero to force a pass. |
| Previous-run data appears | Use a new empty `RESEARCHDESK_DATA` directory. Do not reuse production databases during testing. |
