# Changelog

## 3.1.0 — Core frontend refresh (unreleased)

- Updated Mermaid/Vega renderers, input normalization and shared theme configuration.
- Extracted math preprocessing/rendering; formula placeholders now respect fenced and inline code.
- Added spreadsheet/PDF parser Workers, progress-aware idle deadlines and main-thread fallbacks. DOM-based DOCX/PPTX readers yield periodically; their incompatible Worker paths were not included.
- Added separate browser/native keyboard drivers and an adapter for the existing chat scroll interface.
- Retained the public snapshot's conversation and local image storage contracts.
- Replaced duplicate top-level diagram implementations with compatibility exports.
- Made the backend origin explicit through VITE_API_BASE_URL; local development no longer automatically uses the official production service.
- Updated project/contribution documentation while retaining the complete system overview and architecture explanations.
- Removed unused backend/payment SDK dependencies and added core regression tests and a frontend CI workflow.

Backend implementations, commercial entitlement rules, production gateways and signing material are not part of this update. Browser/device and live-service checks must be reported separately from the Node suite and frontend build.
