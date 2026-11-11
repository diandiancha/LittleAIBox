# Changelog

## Unreleased — Canvas workbench sync

- Copied the complete project's Canvas cards, source editor, code chunks/highlight Worker, drawer lifecycle and preview registry. Included HTML, SVG, Markdown, React/Vue component, p5 and Markmap preview renderers and their existing local runtime assets.
- Ported Canvas mode selection and the `context_mode: "canvas"` request flag, protocol normalization, stable message/artifact identity and source-preserving export into the public frontend. Generation still requires a compatible backend; no model service or commercial implementation is included.
- Copied the generic streaming runtime and required frontend helpers; retained a small compatibility adapter for the public snapshot's existing stream/image callers. Updated the Markdown/math helpers needed by the copied preview runtime and adapted its chart-renderer import paths.
- Copied existing Canvas/sideloading layout styles and the application chunk policy; connected close/theme handling to the older public UI. Dedicated Canvas deep links and the newer conversation/cloud integration are outside this migration.
- Added Canvas labels from the complete project to all seven existing UI locales. Updated the six README languages and their architecture diagrams without adding a standalone feature guide.
- Validated with local Node checks, desktop/mobile Chrome fixtures using simulated backend responses and the production Vite/PWA build. Fixtures and screenshots remain local under ignored `tests/`.

## Unreleased — CJK Markdown emphasis sync

- Copied `src/mathrender/markdown-cjk-emphasis.js` unchanged from the complete project and installed it at the existing chat and Markdown file-preview parsing entrypoints.
- Support the original extension's CJK emphasis boundary cases, such as `前文**（重点）**后文`, while retaining its existing scope and fallback behavior.
- Retained the bundled Marked version, code/math protection and HTML sanitization flow; no backend or commercial implementation is included.
- Added a brief feature description to all six README languages. Validation fixtures remain local under ignored `tests/`.

## Unreleased — Stream rendering core sync

- Copied `src/stream-pacer.js` from the complete project without changing its implementation.
- Ported pacing call sites from the complete project's `src/stream-render-runtime.js`: arrival sampling, start/resume buffering, frame consumption, EOF draining and hidden-page queue draining. Adapted visibility checks to the public snapshot's existing interface; retained its image, scroll and response contracts.
- Copied `src/stream-text-update.js` and `src/mathrender/display-math-state.js` unchanged from the complete project. Ported DOM planning/commit and formula-state capture/restore call sites into the public renderer; unchanged prefixes and supported text tails reuse existing nodes, while uncertain structures fall back to replacement.
- Retained the public snapshot's image synchronization and scroll coordination. The complete project's newer selection-restoration and image-registry integrations are not part of this migration.
- Left Canvas, native background services, shared image-protocol dependencies and backend/commercial implementations outside this migration. The existing public SSE reader remains in place.
- Briefly documented the update in all six README languages and all five existing contribution guides.
- Kept validation fixtures local and removed `tests/` from version control. Public CI installs dependencies and verifies the production build.

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

Backend implementations, commercial entitlement rules, production gateways and signing material are not part of this update. Browser/device and live-service checks must be reported separately from local validation and the frontend build.
