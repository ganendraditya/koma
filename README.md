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

> **Security Note**: Never commit `.env` files or API credentials. In standard usage, Koma uses Bring Your Own Key (BYOK) stored locally in `chrome.storage.local`.

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

---

## Architecture Principles

The first supported reader is MangaDex. See [MangaDex adapter](docs/MANGADEX_ADAPTER.md)
for supported routes, lazy-loading behavior, and popup/console verification steps.

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
