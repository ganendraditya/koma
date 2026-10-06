# Koma

In-browser translation runtime for manga, manhwa, and webtoons built on Chrome Manifest V3. Koma detects speech bubbles across supported reader pages and renders translated dialogue as responsive DOM overlays without modifying original page artwork.

---

## Repository Structure

```
koma/
├── extension/          # Extension shell (Manifest V3, Service Worker, Content Script, Popup)
├── core/               # Domain contracts, translation pipeline orchestrator, cache & context
├── providers/          # AI translation provider integrations (Gemini, OpenAI, etc.)
├── adapters/           # Reader-specific DOM extractors (e.g. MangaDex)
├── shared/             # Shared types, constants, and utilities
├── tests/              # Unit and integration test suites
├── docs/               # Architecture decisions and technical specifications
└── .github/            # GitHub Actions CI, issue templates, and pull request template
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.0.0` or later (tested on `v22.x`)
- **npm**: `v10.x` or later
- **Google Chrome** or any Chromium-based browser (Brave, Edge, Arc)

### 1. Installation

```bash
git clone https://github.com/ganendraditya/koma.git
cd koma
npm install
```

### 2. Environment Configuration (Optional)

For local development or testing CLI integration scripts, copy the example environment file:

```bash
cp .env.example .env
```

Never commit `.env` files or API credentials. Koma supports Gemini, OpenAI, and custom OpenAI-compatible BYOK endpoints. Keys can be kept for the browser session or remembered in unencrypted extension local storage. See [BYOK provider setup](docs/BYOK_PROVIDERS.md) for configuration, reasoning models, and storage behavior.

---

## Available Scripts

| Command                | Description                                                       |
| :--------------------- | :---------------------------------------------------------------- |
| `npm run dev`          | Starts Vite in watch mode for development                         |
| `npm run build`        | Performs type checking and builds the production extension bundle |
| `npm run typecheck`    | Runs TypeScript compiler check (`tsc --noEmit`)                   |
| `npm run lint`         | Analyzes source code with ESLint                                  |
| `npm run lint:fix`     | Automatically fixes ESLint rule violations                        |
| `npm run format`       | Formats code with Prettier                                        |
| `npm run format:check` | Verifies code formatting against Prettier rules                   |
| `npm run test`         | Executes unit test suites with Vitest                             |
| `npm run test:watch`   | Runs Vitest in interactive watch mode                             |

---

## Loading the Extension in Chrome

1. Build the production bundle:
   ```bash
   npm run build
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** via the toggle in the upper right.
4. Click **Load unpacked**.
5. Select the `dist/` directory generated within the project root.
6. The Koma extension will appear in the Chrome toolbar.

### Reading controls

Open a MangaDex chapter, configure and save your provider settings, then click **Translate**.
Koma translates the page nearest the viewport and up to two upcoming loaded pages, one request at a time. Scrolling or loading more images updates that window.

An in-reader status panel keeps activity, ready/active/queued counts, errors and cooldown visible after you close the popup. You can Pause/Resume or explicitly retry there. **Hide Status** (or Escape while focused inside the panel) collapses it to a small live status button; activate that button to expand it again. See [reader-status verification](docs/READER_STATUS_VERIFICATION.md).

- **Pause** cancels pending image/provider work and clears the queue. Accepted translations stay available. **Resume** continues from your current viewport.
- **Hide Overlays** shows the original artwork. **Show Overlays** restores accepted translations without another provider request. Translation can continue while overlays are hidden; use Pause to stop requests.
- Hidden tabs stop dispatch and cancel active work. Returning to an enabled reader recalculates its window.
- Failed pages require **Retry Pages**, which retries failures in the visible-plus-two reading window. Rate limits delay the remaining eligible queue according to `Retry-After`, or use a 30-second fallback. See [session verification and cooldown policy](docs/READING_SESSION_VERIFICATION.md).

---

## Architecture Principles

The first supported reader is MangaDex. See [MangaDex adapter](docs/MANGADEX_ADAPTER.md)
for supported routes, lazy-loading behavior, and popup/console verification steps.
Use the [Sprint 1 smoke-test checklist](docs/SMOKE_TEST.md) to record Chrome regression results and pipeline timings.

For complete technical specifications, refer to [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ADR-001-translation-contracts.md`](docs/ADR-001-translation-contracts.md).

- **Provider Independence**: Renderers and core pipeline orchestrators communicate strictly through normalized domain contracts (`TranslationResult`, `BoundingBox`), decoupling UI logic from specific AI provider responses.
- **DOM Text Overlay**: Translations are rendered using CSS-positioned absolute containers over original images, eliminating image re-encoding overhead and preserving responsive page scroll.
- **Client-Side Processing**: Image preprocessing, caching, and credential storage execute locally on the client without routing user traffic through third-party intermediary servers.

---

## Contributing

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/KOMA-xxx-feature-name
   ```
2. Verify all local checks pass:
   ```bash
   npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
   ```
3. Submit a Pull Request targeting `main`. Pull requests require passing CI checks and at least one peer approval before merging.
