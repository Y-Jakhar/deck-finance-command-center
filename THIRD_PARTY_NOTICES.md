# Third-party notices

This source-only release candidate contains Deck application source, dependency manifests, documentation, and empty-data screenshots. It does not include installed Python/npm packages, built frontend assets, optional sibling repositories, market datasets, or private research. Deck code owned by Yash Jakhar is covered by the root MIT `LICENSE`; that grant does not replace the terms of independently owned dependencies and assets.

## Owner-controlled shared source

The owner has confirmed that the Go-Terminal and DealLens code they own, including exact and adapted frontend source in this candidate, may be distributed under MIT with Deck. The local counterpart paths and visible history of the 24 flagged files were reviewed in the ownership clearance record. No separate Go-Terminal or DealLens repository is bundled here. The visible local histories show only one placeholder Go-Terminal commit identity and Yash Jakhar for the DealLens snapshot; commit metadata alone was not used as a rights grant. No third-party contributor or file-level license header was found in those flagged files. Any later discovery of independently owned contributions requires separate review.

## Open Design prototype

The local Open Design prototype input provenance could not be established. Its derived `open-design.css`, corresponding UI edits, prototype PDF, and prototype-based screenshots are excluded. The candidate uses the saved pre-prototype Deck interface, and its two screenshots were recaptured from that interface. No Open Design artifact is intentionally redistributed.

## Fonts used by the frontend build

The npm build downloads these font packages and emits font software into `frontend/dist`. Their exact OFL-1.1 copyright and license texts are preserved here for any distribution of a compiled frontend:

| Package | Version in npm lock | Notice file |
| --- | --- | --- |
| `@fontsource-variable/space-grotesk` | 5.3.0 | [Space Grotesk OFL](docs/licenses/SPACE_GROTESK_OFL.txt) |
| `@fontsource/ibm-plex-sans` | 5.3.0 | [IBM Plex Sans OFL](docs/licenses/IBM_PLEX_SANS_OFL.txt) |
| `@fontsource/ibm-plex-mono` | 5.3.0 | [IBM Plex Mono OFL](docs/licenses/IBM_PLEX_MONO_OFL.txt) |

## Package dependencies

The exact Python and npm versions are in `requirements-lock.txt` and `frontend/package-lock.json`. Installation downloads separately licensed packages; do not relabel them as Deck MIT. The full metadata inventory reviewed for this candidate is in [dependency licenses](docs/DEPENDENCY_LICENSE_INVENTORY.md). Metadata labels can be incomplete and are not a substitute for the installed packages' complete license and `NOTICE` files. If `node_modules`, a wheel bundle, or compiled assets are distributed later, collect and include the exact corresponding license and attribution texts. `caniuse-lite` reports CC-BY-4.0; check whether its data is in any redistributed compiled artifact and include attribution if so. ReportLab and NumPy report multiple license components that require their complete upstream notices if their packages are redistributed.

StrategyLab is an optional external checkout and is not bundled. Its separate MIT notice would be needed only if its source is packaged in a future release. Provider market data and research files are excluded and must be assessed under their own terms before any later redistribution.
