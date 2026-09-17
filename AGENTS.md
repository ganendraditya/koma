# Agent Guidelines for Koma

<!-- antislop:start -->

## antislop

For UI, copy, people, mobile layout, or code comments work, load the antislop skill for the task:

- Core filter, always on: `antislop`
- UI / visual: `antislop-ui`
- Copy & text: `antislop-copywriting`
- People: `antislop-human`
- Mobile / responsive: `antislop-layoutmobile`
- Code comments: `antislop-code`
  Before starting, ask the user when antislop applies: during the work, or after it is done.

<!-- antislop:end -->

---

## Single Source of Truth: Product Requirements & Vision

All product specifications, feature boundaries, and sprint planning MUST strictly refer to the two official Notion documents. NEVER reference, cite, or hallucinate from any earlier draft PRDs (such as the legacy MangaLens draft or obsolete 1.5 references).

### Official Notion Documents:

1. **Master PRD (Vision, Architecture, Context Engine, Long-term Roadmap):**
   - **URL:** https://app.notion.com/p/Koma-Open-Context-Aware-Manga-Manhwa-Translator-3dd34a9faea380ebb1d1cf8d15f7853b
   - **Notion Page ID:** `3dd34a9faea380ebb1d1cf8d15f7853b`
   - **Local Snapshot:** `docs/notion/MASTER_PRD.md`

2. **Sprint 1 PRD (First Vertical Slice Backlog & Scope):**
   - **URL:** https://app.notion.com/p/Koma-Sprint-1-PRD-3dd34a9faea380fca850dffd82cced8a
   - **Notion Page ID:** `3dd34a9faea380fca850dffd82cced8a`
   - **Local Snapshot:** `docs/notion/SPRINT_1_PRD.md`

### CLI Sync & Verification:

- Always check `docs/notion/` for offline specifications.
- To re-fetch live contents from Notion directly via CLI, run:
  ```bash
  npm run sync:notion
  # or directly:
  /usr/local/bin/ntn pages get 3dd34a9faea380ebb1d1cf8d15f7853b
  /usr/local/bin/ntn pages get 3dd34a9faea380fca850dffd82cced8a
  ```

---

## Architectural Principles & Design Rules

Consult [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ADR-001-translation-contracts.md`](docs/ADR-001-translation-contracts.md) before writing or refactoring any code.

1. **Provider Independence (DIP):** Downstream renderers, orchestrators, and cache layers must communicate exclusively through normalized domain contracts (`TranslationResult`, `Bubble`, `BoundingBox`). Never expose raw vendor responses (Gemini, OpenAI, etc.) outside the provider boundary.
2. **Layer Isolation:** Website scraping and reader DOM specifics belong strictly in `adapters/`. AI vendor API logic belongs strictly in `providers/`. Core business logic belongs in `core/`.
3. **Tell, Don't Ask & Law of Demeter:** High-level components tell domain services what to do (e.g. `orchestrator.translateActivePage()`), rather than asking for internal state and manipulating it externally.
4. **Orthogonality:** Changes in reader site DOM (adapters) must not force changes in providers or renderers, and vice versa.
5. **YAGNI & DRY:** Keep implementations lightweight and focused on current sprint acceptance criteria. Avoid redundant abstraction layers (e.g. empty pass-through directories).
