---
title: Koma — Sprint 1 PRD
---

> **Sprint:** Sprint 1 — First Vertical Slice
> **Duration:** 2 weeks
> **Product:** Koma
> **Platform:** Chrome / Chromium — Manifest V3
> **Sprint Theme:** From raw manga image → translated DOM overlay
> **Status:** Planned

---

# 1. Sprint Goal

The objective of Sprint 1 is to prove Koma's **core technical loop** on one supported manga website.
By the end of the sprint, a developer should be able to:

```plain text
Install Koma locally
        ↓
Open a supported manga chapter
        ↓
Configure an AI provider
        ↓
Click "Translate"
        ↓
Koma detects a manga image
        ↓
Image is processed
        ↓
Text + bounding boxes are returned
        ↓
Translation appears over the manga
```

Sprint 1 is intentionally **not** about building the complete product.
The sprint validates the hardest early assumptions:

- Can the extension reliably detect manga content?
- Can an AI provider return usable OCR + coordinates + translation?
- Can Koma render stable overlays?
- Can all components communicate cleanly through a provider-independent architecture?
- Can basic contextual information be carried between translated images?

---

# 2. Sprint Success Definition

Sprint 1 is successful when the team can demonstrate the following flow on at least one supported website:

> Open chapter → enable Koma → translate at least three consecutive manga images → see readable translated overlays positioned approximately over the corresponding original text.
> The demo must not require:

- manually copying images;
- manually calling an API;
- manually inserting translated text;
- refreshing between each image.

---

# 3. Scope

## In Scope

- Chrome Extension Manifest V3 foundation
- Local development workflow
- One officially supported manga site
- Image detection
- One AI provider
- BYOK
- Standard provider abstraction
- OCR + translation result schema
- Bounding-box based DOM overlays
- Basic text fitting
- Translation triggering
- Basic local cache
- Minimal recent-dialogue context
- Error states
- Basic performance instrumentation

## Out of Scope

- Multiple websites
- Multiple cloud providers
- Advanced adaptive prefetch
- Full Context Engine
- Character recognition
- Chapter summaries
- Automatic glossary generation
- Inpainting
- SFX translation
- WebGPU/local inference
- Manga reader history
- Cloud accounts
- Payments
- Chrome Web Store publishing
- Production analytics

---

# 4. Technical Principle for Sprint 1

Even though only one provider will be implemented during Sprint 1, Koma must **not couple the application directly to that provider**.
The target architecture is:

```plain text
Website
   ↓
Site Adapter
   ↓
Koma Core
   ↓
Translation Provider Interface
   ↓
Provider Implementation
   ↓
Normalized Translation Result
   ↓
Overlay Renderer
```

This architectural boundary is one of the most important outcomes of Sprint 1.
---

# 5. GitHub Project / Kanban Structure

Recommended GitHub Project board:

```plain text
Backlog
   ↓
Ready
   ↓
In Progress
   ↓
In Review
   ↓
QA / Verification
   ↓
Done
```

Additional state:

```plain text
Blocked
```

A blocked issue should retain its normal workflow state through a GitHub field where possible rather than permanently becoming its own workflow category.
---

# 6. Recommended GitHub Project Fields

Create the following fields in GitHub Projects.
<table header-row="true">
<tr>
<td>Field</td>
<td>Values</td>
</tr>
<tr>
<td>Status</td>
<td>Backlog / Ready / In Progress / In Review / QA / Done</td>
</tr>
<tr>
<td>Sprint</td>
<td>Sprint 1</td>
</tr>
<tr>
<td>Priority</td>
<td>P0 / P1 / P2</td>
</tr>
<tr>
<td>Type</td>
<td>Feature / Engineering / Bug / Research</td>
</tr>
<tr>
<td>Area</td>
<td>Extension / Core / Provider / Adapter / Renderer / Context / QA</td>
</tr>
<tr>
<td>Size</td>
<td>XS / S / M / L / XL</td>
</tr>
<tr>
<td>Epic</td>
<td>Foundation / Translation / Rendering / Context / Quality</td>
</tr>
<tr>
<td>Blocked</td>
<td>Yes / No</td>
</tr>
</table>
Optional:
<table header-row="true">
<tr>
<td>Field</td>
<td>Purpose</td>
</tr>
<tr>
<td>Owner</td>
<td>Developer responsible</td>
</tr>
<tr>
<td>PR</td>
<td>Linked pull request</td>
</tr>
<tr>
<td>Target</td>
<td>Sprint / Stretch</td>
</tr>
<tr>
<td>Risk</td>
<td>Low / Medium / High</td>
</tr>
</table>
---
# 7. Recommended Labels
Repository labels:
```plain text
type:feature
type:engineering
type:bug
type:research

area:extension
area:core
area:provider
area:adapter
area:renderer
area:context
area:cache
area:qa

priority:p0
priority:p1
priority:p2

sprint:1

blocked
stretch
good-first-issue

````
Do not encode everything into labels if GitHub Project fields already represent it.
For example, use the **Sprint field** for Sprint assignment instead of maintaining dozens of sprint labels long term.
---
# 8. Epic Overview
Sprint 1 contains five workstreams.
```plain text
EPIC A — Project Foundation
│
├── KOMA-001 Repository & development foundation
└── KOMA-002 Chrome extension shell

EPIC B — Translation Pipeline
│
├── KOMA-003 Core domain contracts
├── KOMA-004 First site adapter
└── KOMA-005 AI provider integration

EPIC C — Rendering
│
├── KOMA-006 DOM overlay renderer
└── KOMA-007 End-to-end translation orchestration

EPIC D — Persistence & Context
│
├── KOMA-008 Translation cache
└── KOMA-009 Minimal context memory

EPIC E — Quality
│
└── KOMA-010 Smoke testing & performance instrumentation
````

Stretch:

```plain text
KOMA-011 Basic look-ahead prefetch
```

---

# 9. Sprint Backlog

---

## KOMA-001 — Initialize Repository & Development Foundation

**Type:** Engineering
**Priority:** P0
**Area:** Core
**Epic:** Foundation
**Size:** S
**Target:** Committed

### User / Developer Story

As a Koma developer, I want a consistent repository and development environment so that contributors can run, test, and build the project without undocumented setup.

### Scope

Create the initial project repository structure and shared tooling.
Suggested structure:

```plain text
koma/
├── extension/
├── core/
├── providers/
├── adapters/
├── shared/
├── tests/
└── docs/
```

Exact package boundaries may change as implementation begins.

### Acceptance Criteria

- [ ] Repository contains an initial README.
- [ ] README contains local setup instructions.
- [ ] Project can be installed from a clean checkout using one documented command sequence.
- [ ] A development build command exists.
- [ ] A production build command exists.
- [ ] Formatting rules are configured.
- [ ] Linting is configured.
- [ ] Type checking is configured.
- [ ] `.env.example` or equivalent documentation exists if environment variables are required.
- [ ] API keys are excluded by `.gitignore`.
- [ ] No API credential is committed to the repository.
- [ ] Pull request template exists.
- [ ] Issue template exists for bugs/features.

### Definition of Done

A new contributor can clone the project and successfully produce a build by following only the README.
---

## KOMA-002 — Create Chrome Manifest V3 Extension Shell

**Type:** Feature
**Priority:** P0
**Area:** Extension
**Epic:** Foundation
**Size:** M
**Dependencies:** KOMA-001
**Target:** Committed

### User Story

As a developer, I want a working Chrome extension shell so that Koma can execute code inside supported manga websites.

### Scope

Implement:

- Manifest V3;
- content script;
- background/service worker;
- popup or minimal control surface;
- extension settings foundation.

### Acceptance Criteria

- [ ] Extension can be loaded through Chrome's "Load unpacked" development flow.
- [ ] Manifest uses Manifest V3.
- [ ] Content script executes on a configured test domain.
- [ ] Service worker loads without errors.
- [ ] Extension popup opens.
- [ ] Popup can communicate with the active content script.
- [ ] Content script can send messages to the service worker.
- [ ] Reloading the extension does not require rebuilding manually beyond the documented dev workflow.
- [ ] Browser console contains no uncaught Koma errors on supported pages.
- [ ] Permissions are limited to those required by current Sprint 1 functionality.

### QA Scenario

1. Load extension.
2. Open supported website.
3. Open Koma popup.
4. Click diagnostic action.
5. Content script responds successfully.

---

## KOMA-003 — Define Koma Core Translation Contracts

**Type:** Engineering
**Priority:** P0
**Area:** Core
**Epic:** Translation
**Size:** M
**Dependencies:** KOMA-001
**Target:** Committed

### Developer Story

As a Koma developer, I want standardized internal interfaces so that providers, site adapters, and renderers do not depend directly on each other's implementation.

### Required Models

At minimum define:

```plain text
MangaImage
TranslationRequest
TranslationResult
Bubble
BoundingBox
ContextPacket
ProviderCapabilities
```

Example conceptual provider interface:

```typescript
interface TranslationProvider {
  capabilities(): ProviderCapabilities;

  translatePage(request: TranslationRequest): Promise<TranslationResult>;
}
```

### Acceptance Criteria

- [ ] Provider interface exists independently from any Gemini-specific code.
- [ ] `TranslationResult` is provider-independent.
- [ ] Bounding boxes use one documented coordinate convention.
- [ ] Source text and translated text are separate fields.
- [ ] Bubble IDs are unique within an image.
- [ ] Translation requests accept optional context.
- [ ] Provider capabilities can describe at minimum vision, OCR, translation, and bounding-box support.
- [ ] Error result/types are standardized.
- [ ] Interfaces contain no provider-specific field names.
- [ ] Unit tests validate at least one valid normalized translation result.
- [ ] Architecture decision is documented briefly.

### Architecture Constraint

The renderer must never consume raw Gemini/OpenAI/etc. responses directly.
---

## KOMA-004 — Implement First Manga Site Adapter

**Type:** Feature
**Priority:** P0
**Area:** Adapter
**Epic:** Translation
**Size:** M
**Dependencies:** KOMA-002, KOMA-003
**Target:** Committed

### User Story

As a Koma user, I want the extension to automatically recognize manga images on a supported reader so that I do not manually select images.

### Scope

Support **one website only** for Sprint 1.
The team should choose the simplest legally and technically appropriate target for development.
The adapter returns standardized `MangaImage` objects to Koma Core.

### Acceptance Criteria

- [ ] Adapter identifies the primary manga images on the selected site.
- [ ] Navigation/UI assets such as logos, avatars, thumbnails, and ads are excluded.
- [ ] Each detected manga image receives a stable identifier for the current page session.
- [ ] Images are returned in reading order.
- [ ] Image dimensions are available after loading.
- [ ] Lazy-loaded images are detected once available.
- [ ] Running detection multiple times does not create duplicate image entries.
- [ ] Adapter logic is isolated from Koma Core.
- [ ] Unsupported pages fail gracefully.
- [ ] Developer debug mode can display the number of detected manga images.

### QA Scenario

On a known chapter:

```plain text
Expected manga images: N
Detected manga images: N
False positives: 0
```

Small deviations may be documented during Sprint 1 if the reader contains unusual assets.
---

## KOMA-005 — Implement First Multimodal Translation Provider

**Type:** Feature
**Priority:** P0
**Area:** Provider
**Epic:** Translation
**Size:** L
**Dependencies:** KOMA-003
**Target:** Committed

### User Story

As a Koma user, I want my selected AI provider to analyze a manga image and return translated dialogue with positions so that Koma can display the translation in place.

### Scope

Implement one multimodal provider for Sprint 1.
Provider should support:

```plain text
image
 ↓
text detection
 ↓
OCR
 ↓
translation
 ↓
bounding boxes
```

The provider implementation converts its response into Koma's normalized `TranslationResult`.

### Acceptance Criteria

- [ ] Provider conforms to `TranslationProvider`.
- [ ] User can supply their own API key.
- [ ] API key is never committed or logged.
- [ ] API key can be stored for at least the active session.
- [ ] One manga image can successfully be submitted.
- [ ] Provider returns structured bubble results.
- [ ] Every valid bubble contains a bounding box.
- [ ] Every valid bubble contains source text where detectable.
- [ ] Every valid bubble contains translated text.
- [ ] Malformed model responses are handled without crashing the extension.
- [ ] Provider timeout results in a standardized error.
- [ ] API rate-limit errors are recognized.
- [ ] Provider response is validated before reaching the renderer.
- [ ] Raw provider response is not exposed directly to downstream components.
- [ ] At least three representative test images are manually verified.

### Minimum Translation Quality Requirement

Sprint 1 does not require production-grade accuracy.
The result must be good enough that reviewers can recognize that the correct dialogue region has been detected and translated.
---

## KOMA-006 — Implement DOM Overlay Renderer

**Type:** Feature
**Priority:** P0
**Area:** Renderer
**Epic:** Rendering
**Size:** L
**Dependencies:** KOMA-003
**Target:** Committed

### User Story

As a reader, I want translations displayed over the corresponding manga dialogue so that I can read without leaving the webpage.

### Scope

Implement overlay rendering for ordinary speech/narration regions.

### Acceptance Criteria

- [ ] Renderer accepts normalized `TranslationResult`.
- [ ] Bounding boxes are converted correctly to image-relative coordinates.
- [ ] Each translation is positioned over its corresponding region.
- [ ] Overlay moves with the manga image during normal scrolling.
- [ ] Overlay remains approximately aligned after window resizing.
- [ ] Overlay remains approximately aligned after supported browser zoom changes.
- [ ] Text is centered or aligned according to normalized result data.
- [ ] Font size decreases when translated text exceeds available space.
- [ ] Text does not intentionally modify the original manga image.
- [ ] Renderer can remove all overlays without reloading the page.
- [ ] Re-rendering the same result does not create duplicate overlays.
- [ ] Overlay DOM elements use Koma-specific class/data prefixes to reduce CSS conflicts.
- [ ] Website CSS does not unintentionally override core overlay styling under normal conditions.

### Sprint 1 Visual Tolerance

Overlay does not need scanlation-quality typography.
It must be:

- readable;
- approximately positioned;
- stable while scrolling.

---

## KOMA-007 — Implement End-to-End Translation Orchestrator

**Type:** Feature
**Priority:** P0
**Area:** Core
**Epic:** Rendering
**Size:** L
**Dependencies:** KOMA-002, KOMA-004, KOMA-005, KOMA-006
**Target:** Committed

### User Story

As a user, I want one translation action to trigger the full Koma pipeline automatically.

### Desired Flow

```plain text
User presses Translate
        ↓
Content detected
        ↓
Image selected
        ↓
Translation requested
        ↓
Result normalized
        ↓
Overlay rendered
```

### Acceptance Criteria

- [ ] Popup exposes a Translate action.
- [ ] Translate action reaches the active supported page.
- [ ] Koma selects an untranslated manga image.
- [ ] Image is sent through the configured provider.
- [ ] Loading state is visible while translation occurs.
- [ ] Valid results automatically render.
- [ ] Successful translation is marked as completed internally.
- [ ] Pressing Translate repeatedly does not duplicate requests for already completed images.
- [ ] Provider errors do not remove the original manga.
- [ ] User receives a visible non-blocking error state.
- [ ] Retry is possible after a failed request.
- [ ] At least three consecutive manga images can be translated without manually manipulating internal state.
- [ ] Entire flow works without developer console commands.

### Sprint Demo Requirement

This issue cannot be considered Done until the team records or demonstrates the complete workflow.
---

## KOMA-008 — Implement Basic Translation Cache

**Type:** Feature
**Priority:** P1
**Area:** Cache
**Epic:** Context
**Size:** M
**Dependencies:** KOMA-003, KOMA-007
**Target:** Committed if capacity permits

### User Story

As a reader, I do not want Koma to spend time or API usage retranslating an image it already translated.

### Scope

Implement local session/persistent caching for normalized translation results.

### Acceptance Criteria

- [ ] Manga images receive a deterministic cache identifier.
- [ ] Completed translations can be retrieved from local cache.
- [ ] Re-requesting the same image with identical relevant parameters uses cached data.
- [ ] Cache lookup happens before provider invocation.
- [ ] Cache hit prevents unnecessary API request.
- [ ] Cached result can recreate overlays after overlay removal.
- [ ] Target language is included in cache identity.
- [ ] Provider/model identity can be included where required.
- [ ] Corrupted cache entries fail gracefully.
- [ ] A developer can clear Koma's translation cache.

### Verification

For one image:

```plain text
First translation:
Provider requests = 1

Second identical translation:
Provider requests = 0
```

---

## KOMA-009 — Implement Minimal Context-Aware Translation

**Type:** Feature
**Priority:** P1
**Area:** Context
**Epic:** Context
**Size:** M
**Dependencies:** KOMA-003, KOMA-005, KOMA-007
**Target:** Committed if capacity permits

### User Story

As a reader, I want Koma to remember recent dialogue so that translations have more narrative context than isolated image translation.

### Sprint 1 Scope

Do **not** implement the full Context Engine yet.
Implement only:

```plain text
recent translated dialogue
+
basic glossary structure
```

### Context Packet

Minimum:

```typescript
interface ContextPacket {
  recentDialogue: DialogueEntry[];
  glossary: GlossaryEntry[];
}
```

### Acceptance Criteria

- [ ] Successful translations append dialogue to local context.
- [ ] Context retains dialogue from previous translated images.
- [ ] Context has a configurable maximum size.
- [ ] Older dialogue is removed when the maximum is exceeded.
- [ ] Subsequent translation requests receive recent dialogue context.
- [ ] Provider prompt distinguishes contextual hints from current source text.
- [ ] Context is never rendered as if it belonged to the current page.
- [ ] Basic glossary data structure exists.
- [ ] At least one manually inserted glossary item can be supplied to the provider.
- [ ] Reset-context action exists in developer settings or debug UI.
- [ ] Translation still works when no context exists.
- [ ] Failed translations do not pollute context.

### Initial Default

Suggested:

```plain text
Last 10–20 dialogue bubbles
```

Exact value should be configurable during development.
---

## KOMA-010 — Add Debugging, Smoke Tests & Performance Instrumentation

**Type:** Engineering
**Priority:** P1
**Area:** QA
**Epic:** Quality
**Size:** M
**Dependencies:** KOMA-007
**Target:** Committed

### Developer Story

As a Koma developer, I want visibility into the translation pipeline so that we can identify whether failures originate from detection, API processing, normalization, or rendering.

### Required Measurements

At minimum:

```plain text
image detection time
provider request duration
normalization duration
render duration
total cold translation duration
cache hit / miss
```

### Acceptance Criteria

- [ ] Development mode can log pipeline stages.
- [ ] API keys are never included in logs.
- [ ] Provider duration is measurable.
- [ ] End-to-end translation duration is measurable.
- [ ] Cache hit/miss is visible in debug output.
- [ ] Error messages identify the failed pipeline stage.
- [ ] A documented smoke-test checklist exists.
- [ ] Team has at least three reference manga images/pages for regression testing.
- [ ] Main happy path is manually verified in Chrome.
- [ ] Unsupported site test does not cause a page crash.
- [ ] Failed API request test does not cause a page crash.

---

# 10. Stretch Story

## KOMA-011 — Basic Look-Ahead Translation Prefetch

**Type:** Feature
**Priority:** P2
**Area:** Core
**Epic:** Translation
**Size:** M
**Label:** `stretch`

### User Story

As a reader, I want Koma to start processing upcoming content before I reach it so translation feels faster.

### Sprint 1 Scope

This is **not** adaptive prediction yet.
Only implement simple look-ahead.
Example:

```plain text
Visible image      → Priority 0
Next image         → Priority 1
Next-next image    → Priority 2
```

### Acceptance Criteria

- [ ] Koma knows which detected image is nearest to the viewport.
- [ ] Current visible image receives highest priority.
- [ ] At least one upcoming image may be queued.
- [ ] Same image cannot exist multiple times in queue.
- [ ] User-triggered visible translation outranks background work.
- [ ] Prefetch respects a configurable maximum concurrency.
- [ ] Prefetch stops when translation is disabled.
- [ ] Provider failure does not stop the entire queue.
- [ ] Cache is checked before queuing provider work.

### Important

This story should be dropped before any P0 issue if sprint capacity becomes constrained.
---

# 11. Dependency Graph

```plain text
KOMA-001
├─────────────┐
▼             ▼
KOMA-002    KOMA-003
│             │
│       ┌─────┼─────────────┐
│       ▼     ▼             ▼
│    KOMA-004 KOMA-005   KOMA-006
│       │       │             │
└───────┴───────┴─────────────┘
                │
                ▼
             KOMA-007
             │   │
        ┌────┘   └───────┐
        ▼                ▼
     KOMA-008         KOMA-009
        │                │
        └──────┬─────────┘
               ▼
            KOMA-010

Stretch:
KOMA-007 + KOMA-008
        ↓
     KOMA-011
```

---

# 12. Priority Order

If sprint capacity is smaller than expected, work should be protected in this order:

```plain text
1. KOMA-001
2. KOMA-002
3. KOMA-003
4. KOMA-004
5. KOMA-005
6. KOMA-006
7. KOMA-007
────────────────────
Sprint Goal achieved
────────────────────
8. KOMA-010
9. KOMA-008
10. KOMA-009
11. KOMA-011
```

KOMA-009 is strategically important to Koma, but the first sprint must establish a stable translation pipeline before building sophisticated context behavior.
---

# 13. Suggested Sprint Timeline

## Days 1–2

Foundation work.

```plain text
KOMA-001
KOMA-002
KOMA-003
```

Development can begin in parallel once basic repository structure exists.
---

## Days 3–5

Core pipeline components.

```plain text
KOMA-004 Site Adapter
KOMA-005 Provider
KOMA-006 Renderer
```

These can largely progress in parallel because KOMA-003 defines their contract.
---

## Days 6–7

Integration.

```plain text
KOMA-007
```

Objective:

> first complete raw-image → translation → overlay demo.

---

## Days 8–9

Stabilization.

```plain text
KOMA-008
KOMA-009
KOMA-010
```

Focus on:

- duplicate requests;
- malformed responses;
- cache;
- context;
- overlay problems.

---

## Day 10

Sprint verification and demo.
Activities:

- full happy-path test;
- bug fixes;
- PR cleanup;
- smoke test;
- benchmark capture;
- sprint demo;
- retrospective;
- create Sprint 2 backlog.
  No major new feature should begin on the final day.

---

# 14. Branch & Pull Request Workflow

Recommended workflow:

```plain text
main
 │
 ├── feat/KOMA-004-site-adapter
 ├── feat/KOMA-005-provider
 ├── feat/KOMA-006-overlay-renderer
 └── ...
```

PR title:

```plain text
[KOMA-005] Add initial translation provider
```

Commit examples:

```plain text
feat(provider): add multimodal translation adapter
fix(renderer): correct normalized bounding box scaling
test(core): validate translation result schema
```

Every PR should link its issue:

```plain text
Closes #123
```

or:

```plain text
Part of #123
```

depending on whether the PR completes the entire issue.
---

# 15. Card Movement Rules

## Backlog → Ready

An issue can enter `Ready` when:

- requirements are understandable;
- ACs exist;
- dependencies are resolved or actively available;
- there is no unanswered architectural blocker.

---

## Ready → In Progress

Move when a developer begins implementation.
Each developer should ideally have **one primary In Progress issue** at a time.
---

## In Progress → In Review

Requires:

- implementation complete;
- developer self-test completed;
- PR created;
- relevant ACs checked locally.

---

## In Review → QA

Requires:

- review approved;
- CI checks passing;
- branch merged or deployable/testable according to team workflow.

---

## QA → Done

Requires:

- all required ACs verified;
- no known P0 bug;
- issue links relevant PR;
- Definition of Done satisfied.

---

# 16. Global Definition of Done

Every Sprint 1 issue marked Done must satisfy:

- [ ] Code merged into the primary development branch.
- [ ] No known uncaught runtime error introduced.
- [ ] Relevant ACs verified.
- [ ] Type checking passes.
- [ ] Linting passes.
- [ ] Tests pass where applicable.
- [ ] No credentials or secrets committed.
- [ ] PR reviewed by at least one other team member where team size permits.
- [ ] Documentation updated when behavior or setup changes.
- [ ] GitHub issue linked to implementing PR.
- [ ] No unresolved blocker remains for that issue.

---

# 17. Sprint Demo Script

The Sprint 1 review should demonstrate the product, not individual code modules.
Recommended demo:

```plain text
1. Clone/build Koma.

2. Load unpacked extension in Chrome.

3. Open supported manga chapter.

4. Open Koma.

5. Configure provider key.

6. Koma reports detected manga images.

7. Click Translate.

8. Loading state appears.

9. Provider processes image.

10. Translation overlays appear.

11. Scroll page.
    → overlays remain positioned.

12. Translate next image.

13. Show recent dialogue being included as context.

14. Remove/re-render translation.
    → cached result appears without another provider call.

15. Trigger a simulated API failure.
    → original manga remains usable.
```

---

# 18. Sprint-Level Acceptance Criteria

The **entire Sprint 1** is accepted only when:

- [ ] Koma can be installed locally as a Chrome extension.
- [ ] At least one real manga website is supported.
- [ ] Manga images are automatically identified.
- [ ] At least one multimodal AI provider functions through Koma's provider abstraction.
- [ ] The user can configure BYOK credentials.
- [ ] At least three consecutive manga images can be translated.
- [ ] Translation results contain normalized text and bounding boxes.
- [ ] Translations render as DOM overlays.
- [ ] Overlays remain usable while scrolling.
- [ ] Translation failure does not break the manga reader.
- [ ] Provider-specific responses never reach renderer code directly.
- [ ] Basic pipeline timing can be observed.
- [ ] No secrets exist in the repository.

### Preferred, but not required to declare Sprint 1 successful

- [ ] Local cache works.
- [ ] Recent-dialogue context works.
- [ ] Basic look-ahead prefetch works.

---

# 19. Expected Sprint 1 Outcome

Sprint 1 is **not expected to produce a publishable Chrome extension**.
It should produce something more valuable:

> **Evidence that Koma's architecture and core reading experience actually work.**
> At the end of Sprint 1, the team should know whether the following thesis is technically viable:
> Koma can identify manga content, send it through a provider-independent translation pipeline, preserve basic narrative context, and display readable translations directly inside the browser.
> If that thesis is validated, Sprint 2 can shift toward:

```plain text
better context
+
better caching
+
adaptive prefetch
+
overlay quality
+
real reading UX
```

instead of spending Sprint 2 fixing foundational architecture.
