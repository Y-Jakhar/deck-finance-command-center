# Initial release notes — proposed v0.1.0

**Status:** prepared for owner publication approval; not yet published.

Deck / Finance Command Center provides a local standalone shell with an empty SQLite database, six research destinations, statement import and independent modeling previews, an evidence-linked journal with revisions, and explicit optional integration states. The frontend is React/TypeScript; the backend is FastAPI/Python. Setup and validation are documented for Python 3.13 and Node.js 24 on Windows.

The Python dependency pins were updated to FastAPI 0.146.0, Starlette 1.9.0, and pytest 9.1.1. The source package contains no installed dependencies or build output; it is accompanied by an explicit SHA-256 allowlist, MIT license for owner-controlled source, and third-party notices.

Go-Terminal, DealLens, and StrategyLab are optional local integrations and are not bundled. Market-provider availability, historical data completeness, modeled trading fills, AI answer quality, and investment outcomes are not validated or guaranteed. Protected research, production databases, keys, and licensed datasets are excluded. See the [features and limitations](FEATURES_AND_LIMITATIONS.md) and [release approval report](FINAL_GITHUB_RELEASE_APPROVAL.md).
