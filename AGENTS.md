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

---

## Agent Guardrails & Operating Rules

### 1. Code Review Scientific Verification Protocol & Anti-Sycophancy

When conducting AI Code Reviews (via `ocr review`, model evaluations, or diff inspection), the agent **MUST NOT ACCEPT REVIEWER FINDINGS AT FACE VALUE OR ACT AS A SYCOPHANT TO REVIEW BOTS**:

- **Never Assume Validity:** Treat automated review findings with skepticism. LLM reviewers frequently misread diffs, hallucinate obsolete vendor API limitations, or flag stylistic non-issues as critical bugs.
- **Define the Concrete Failure Scenario:** Before presenting any issue to the user, explicitly define:
  _"Under what exact user interaction, input payload, DOM/network state, or concurrency sequence does this defect occur, and what is its measurable impact on the reader/user?"_
- **Empirical Verification (Show, Don't Just Tell):**
  - Run a minimal reproduction script or Vitest assertion to test the failure hypothesis.
  - If reproduction confirms an actual runtime crash, data loss, dead click, or contract violation: classify as **CONFIRMED REAL ISSUE** with terminal/test evidence.
  - If reproduction shows the code works correctly, or the claim is based on truncated files, obsolete vendor specs, or false assumptions: classify as **FALSE POSITIVE / REJECTED** with concrete proof of why it is harmless or invalid.
- **Measurable Impact & Concrete Mechanism:**
  - Clearly explain whether the issue occurs immediately upon user action (e.g. dead button, crash) or cumulatively over time (e.g. duplicate API calls doubling token cost, memory leak, stale cache).
- **No Sycophancy (Stand on Facts, Not Pleasing the User):**
  - Do NOT reflexively fold, apologize, or claim "I was wrong" just because challenged.
  - Stand by verified findings with empirical test proof; transparently discard disproven claims with explanation.
- **Structured Reporting Scorecard:**
  Always report code review findings in distinct sections:
  1. `### 1. Temuan False Positive / Ditolak (Hallucinated / Non-Issues) ❌` (with proof of why it's rejected).
  2. `### 2. Temuan Nyata & Terbukti Empiris (Confirmed Real Issues) ✅` (with user scenario, reproduction proof, measurable impact, and surgical recommendation).

### 2. Don't Assume — Ask First (Communication & Clarification)

- **Do not fill in the blanks with silent assumptions:** When requirements, implementation details, edge cases, user preferences, or error handling behaviors are ambiguous or unspecified, **STOP and ASK the user**.
- **Proactive confirmation on gaps:** Even when an instruction seems complete at first glance, if there are unaddressed architectural trade-offs, edge cases, or breaking implications, highlight them and confirm before proceeding with code changes.
- **Ask via the `question` tool:** Whenever choices or directions need input, use the interactive question tool with clear options rather than guessing the user's intent.
- **Confirm before irreversible actions:** Never delete files, change major architectural patterns, rewrite public contracts, or post public reviews/comments without explicit confirmation.

### 3. Execution, Timeouts & Heavy Workflows (CLI & Review)

- **Harness Shell Timeout Vigilance:** The default harness shell timeout (120s / 2 minutes) is strictly inadequate for heavy tasks, reasoning models (Gemini Pro, Claude Opus, deep-thinking models), or large Git diffs.
  - When invoking `ocr review`, test suites with browser packaging, or heavy builds, **explicitly pass `timeout: 600000` (10 minutes)** or run with `background: true`. Never let default 120s cutoff waste tokens or interrupt reasoning mid-stream.
  - For `ocr review` with reasoning/deep models, pass `--effort low` (1 round) or focus `--exclude` on doc/lockfile noise to avoid unbounded round-trips while keeping token usage bounded.
  - Always direct heavy CLI outputs to a persistent file (`--output <path>`) so results are safely preserved even if network or session drops.
