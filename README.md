# 📖 Koma — Real-Time Manga & Manhwa Translator

Koma is a lightweight, in-browser translation extension (Chrome Manifest V3) for avid manga, manhwa, and manhua readers. It detects speech bubbles in raw manga chapters and overlays translated dialogue directly on the page without modifying original artwork.

---

## 🏗 Repository Structure

```
koma/
├── extension/          # Chrome Extension shell (Manifest V3, Service Worker, Content Script, Popup)
├── core/               # Domain contracts, translation pipeline orchestrator, cache & context
├── providers/          # AI translation provider integrations (Gemini, OpenAI, etc.)
├── adapters/           # Website-specific manga image extractors (MangaDex, etc.)
├── shared/             # Shared types, constants, and utilities
├── tests/              # Unit, integration, and smoke test suites
├── docs/               # Architecture and technical design documentation
└── .github/            # GitHub issue templates and PR template
```

---

## 🚀 Quick Start (Local Setup)

### Prerequisites

- **Node.js**: `v20.0.0` or later (tested on `v22.x`)
- **npm**: `v10.x` or later
- **Google Chrome** or any Chromium-based browser (Brave, Edge, Arc)

### 1. Clone & Install

```bash
git clone https://github.com/ganendraditya/koma.git
cd koma
npm install
```

### 2. Environment Variables (Optional for Development)

Copy the example environment file if you plan to run automated scripts with API keys:

```bash
cp .env.example .env
```

> **Security Note**: Never commit `.env` or your API keys. In production, Koma uses Bring Your Own Key (BYOK) stored securely in `chrome.storage.local`.

---

## 🛠 Available Scripts

| Command                | Description                                                   |
| :--------------------- | :------------------------------------------------------------ |
| `npm run dev`          | Starts Vite in watch mode for development                     |
| `npm run build`        | Runs type-checking and builds production extension to `dist/` |
| `npm run typecheck`    | Runs TypeScript compiler check (`tsc --noEmit`)               |
| `npm run lint`         | Lints codebase with ESLint                                    |
| `npm run lint:fix`     | Automatically fixes ESLint warnings and errors                |
| `npm run format`       | Formats all files with Prettier                               |
| `npm run format:check` | Verifies formatting with Prettier                             |
| `npm run test`         | Runs test suite once with Vitest                              |
| `npm run test:watch`   | Runs Vitest in interactive watch mode                         |

---

## 🔌 Loading Extension in Chrome

1. Run the build command:
   ```bash
   npm run build
   ```
2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `dist/` folder inside the `koma` project directory.
6. The **Koma** extension icon will appear in your Chrome toolbar!

---

## 📐 Architecture Principles

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full architectural guidelines.

- **Provider Independence**: Renderers and orchestrators communicate exclusively with normalized domain models (`TranslationResult`, `BoundingBox`).
- **DOM Text Overlay**: Dialogue is rendered using CSS-positioned DOM patches instead of re-encoding or inpainting full images, ensuring zero scroll latency and high visual fidelity.
- **Safety First**: No user data, images, or credentials are saved on third-party servers.

---

## 🤝 Contributing

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/KOMA-xxx-feature-name
   ```
2. Ensure all checks pass:
   ```bash
   npm run typecheck && npm run lint && npm run test && npm run build
   ```
3. Open a Pull Request using the provided PR template.

---

## 📄 License

MIT License.
