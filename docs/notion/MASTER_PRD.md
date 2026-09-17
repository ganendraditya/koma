---
title: Koma — Open, Context-Aware Manga & Manhwa Translator
---

> **Document Status:** Draft / In Review
> **Authors:** Ganendra & Team
> **Working Product Name:** Koma _(name subject to change)_
> **Target Platform:** Chrome / Chromium-based Browsers — Manifest V3
> **Initial Release:** MVP / Public Beta
> **License Strategy:** Open Source
> **Primary Product Pillars:** Fast, Context-Aware, Model-Agnostic, Open

---

# 1. Executive Summary

## 1.1 Problem Statement

Readers of manga, manhwa, and manhua frequently encounter new chapters that are available only in their original language.
Official translations and community scanlations may arrive hours, days, or even weeks later. Readers who want immediate access often rely on general-purpose image translators or existing manga translation extensions.
Current solutions commonly suffer from several limitations:

- Translation latency interrupts the reading experience.
- Translation is frequently performed page-by-page or bubble-by-bubble without sufficient narrative context.
- Character names, pronouns, terminology, and speech style may become inconsistent across pages.
- Users may be locked into one AI provider.
- Hosted translation services often impose credits, subscription limits, or expensive usage tiers.
- Closed-source architectures make it difficult for the community to add support for new manga websites or AI providers.
- Translation overlays may become misaligned during scrolling, zooming, responsive resizing, or long-strip webtoon reading.
  The primary problem Koma addresses is therefore not simply:

> “How can AI translate manga?”
> but:
> **“How can translated manga feel almost as seamless and contextually consistent as reading a native translation?”**

---

# 2. Product Vision

Koma is an **open-source, model-agnostic browser translation engine for comics**.
It automatically detects manga or webtoon content, extracts and interprets dialogue, translates it using a user-selected AI provider, and renders translated text directly over the original page.
Koma differentiates itself through three core pillars:

### ⚡ Fast

Translation should ideally be prepared **before the reader reaches the next panel** through adaptive prefetching, intelligent scheduling, caching, image optimization, and asynchronous processing.

### 🧠 Context-Aware

Translation should understand more than the current speech bubble.
Koma maintains lightweight contextual memory including:

- recent dialogue;
- established character names;
- character aliases;
- terminology;
- chapter context;
- scene summaries;
- translation preferences;
- user-confirmed glossary entries.
  This context is carried between pages and remains independent of the selected AI model.

### 🔌 Open

Koma should not depend on one AI provider or proprietary backend.
Users may use:

- cloud multimodal models;
- OpenAI-compatible APIs;
- third-party routing providers;
- local models;
- future WebGPU or offline pipelines.
  The software itself remains open-source and extensible.

---

# 3. Product Positioning

## 3.1 Product Statement

> **Fast manga translation that actually remembers what you're reading.**
> Alternative technical positioning:
> **An open-source, provider-independent translation runtime for manga, manhwa, and comics.**

---

## 3.2 Differentiation

Koma should compete primarily through its translation runtime and reading experience rather than through exclusive access to a particular AI model.
Key differentiators:

1. **Context Engine**
   - Persistent character, terminology, scene, and dialogue context.
2. **Model-Agnostic Provider Layer**
   - Users may switch AI providers without losing context.
3. **Adaptive Translation Scheduler**
   - Predictively processes content ahead of the reader.
4. **Transparent BYOK**
   - Users may use their own API key and pay providers directly.
5. **Open Source**
   - Community-maintained site adapters, translation providers, OCR modules, and rendering strategies.
6. **Local-First Caching**
   - Previously processed content should not require repeated inference.

---

# 4. Goals & Non-Goals

## 4.1 Product Goals

Koma aims to:

- enable users to read untranslated manga with minimal interruption;
- produce more contextually consistent translations than stateless page translators;
- minimize perceived translation latency;
- support multiple AI providers through a standardized interface;
- remain lightweight enough for normal consumer laptops;
- reduce unnecessary API calls through caching and prefetching;
- provide transparent API usage;
- support community extensions for new sites and providers;
- avoid requiring users to install Python, CUDA, or local ML environments for the default experience.

---

## 4.2 MVP Non-Goals

The MVP will **not** attempt to:

- perfectly replace professional human translation;
- translate complex sound effects embedded into artwork;
- perform full generative image restoration;
- support every manga website at launch;
- guarantee perfect OCR accuracy;
- guarantee completely offline translation;
- support mobile browsers;
- recreate original manga typography perfectly;
- automatically identify every speaker with absolute confidence.
  These capabilities may be explored after the core reading experience is validated.

---

# 5. Target Users

## Persona 1 — The Raw Chaser

**Name:** Dito
**Profile:** University student who follows weekly manga releases.

### Pain Points

- Spoilers appear before translated chapters.
- Existing translators are slow.
- Translation quality varies between pages.
- Character references or pronouns are sometimes incorrect.

### Needs

- Immediate access to raw chapters.
- Translation ready before reaching the next panel.
- Consistent names and terminology.

---

## Persona 2 — The Webtoon Binge Reader

**Name:** Siti
**Profile:** Office worker who reads long-strip Korean webtoons.

### Pain Points

- Long scrolling pages cause translation overlays to appear late.
- Existing translators may process the page only after content enters the viewport.
- Translation inconsistency becomes noticeable during long reading sessions.

### Needs

- Seamless continuous scrolling.
- Predictive translation ahead of the viewport.
- Stable overlays that follow responsive layouts.

---

## Persona 3 — The Technical Power User

**Name:** Arya
**Profile:** Developer or AI enthusiast.

### Pain Points

- Does not want to pay markup on proprietary translation credits.
- Wants to use their preferred model or API.
- Wants control over cost and privacy.

### Needs

- Bring Your Own Key.
- Multiple provider support.
- Local or self-hosted options.
- Transparent API usage and caching.

---

# 6. Success Metrics

Koma should distinguish **model processing latency** from **perceived user latency**.

## 6.1 Primary MVP KPIs

<table header-row="true">
<tr>
<td>Metric</td>
<td>MVP Target</td>
</tr>
<tr>
<td>Translation ready before entering viewport</td>
<td>≥ 85% during normal reading</td>
</tr>
<tr>
<td>P50 cold translation latency</td>
<td>\< 4 seconds</td>
</tr>
<tr>
<td>P95 cold translation latency</td>
<td>\< 8 seconds</td>
</tr>
<tr>
<td>Cached translation retrieval</td>
<td>\< 100 ms</td>
</tr>
<tr>
<td>Overlay positional drift</td>
<td>≤ 2% of image dimensions</td>
</tr>
<tr>
<td>Translation request failure rate</td>
<td>\< 2%</td>
</tr>
<tr>
<td>Extension-induced page crash rate</td>
<td>\< 0.5%</td>
</tr>
<tr>
<td>Previously translated page cache hit</td>
<td>\> 90% when revisiting</td>
</tr>
<tr>
<td>Context terminology consistency</td>
<td>\> 90% on established glossary terms</td>
</tr>
</table>
Future targets may become stricter after real telemetry is collected.
---
# 7. High-Level Architecture
```plain text
┌──────────────────────────────────────────────┐
│             Manga / Webtoon Website          │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Site Adapter Layer              │
│                                              │
│ Detect images / canvas / reader structure    │
│ Normalize content into MangaPage objects     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│          Translation Scheduler               │
│                                              │
│ - viewport tracking                          │
│ - reading velocity                           │
│ - queue prioritization                       │
│ - concurrency control                        │
│ - rate-limit awareness                       │
│ - prefetch distance                          │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│             Local Cache Layer                │
│                                              │
│ image hash                                   │
│ OCR result                                   │
│ bubble coordinates                           │
│ translations                                 │
│ context                                      │
└───────────────┬──────────────────────────────┘
                │ cache miss
                ▼
┌──────────────────────────────────────────────┐
│             Provider Adapter                 │
│                                              │
│ Gemini / OpenAI / Anthropic /                │
│ OpenRouter / OpenAI-compatible /             │
│ Ollama / Local Pipeline                      │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│             Context Engine                   │
│                                              │
│ recent dialogue                              │
│ character memory                             │
│ terminology                                  │
│ chapter summary                              │
│ scene state                                  │
│ user-pinned glossary                         │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│             Overlay Renderer                 │
│                                              │
│ bubble classification                        │
│ text fitting                                 │
│ responsive positioning                       │
│ hover original                               │
└──────────────────────────────────────────────┘
```
---
# 8. Provider-Agnostic Translation Layer
The Koma core must not depend directly on Gemini, OpenAI, or any single model.
Providers implement a standardized interface.
Conceptual interface:
```typescript
interface TranslationProvider {
  capabilities(): ProviderCapabilities;

translatePage(
image: ImageInput,
context: ContextPacket,
options: TranslationOptions
): Promise<TranslationResult>;
}

````
Example provider capabilities:
```typescript
interface ProviderCapabilities {
  vision: boolean;
  ocr: boolean;
  translation: boolean;
  boundingBoxes: boolean;
  local: boolean;
}
````

Example:

```plain text
Gemini Multimodal
✓ vision
✓ OCR
✓ translation
✓ bounding boxes

Translation-only provider
✗ vision
✗ OCR
✓ translation

Local OCR + Cloud Translation
✓ OCR
✓ translation
✗ unified vision
```

The architecture must allow multiple pipeline configurations.
---

# 9. Context Engine

## 9.1 Purpose

The Context Engine exists to prevent translation from treating every speech bubble as an isolated sentence.
Its responsibilities include maintaining:

- canonical character names;
- character aliases;
- inferred speaker information;
- recent dialogue;
- recurring terminology;
- current chapter context;
- scene summary;
- user preferences;
- translation style.

---

## 9.2 Context Hierarchy

```plain text
Series Memory
│
├── Characters
├── Canonical names
├── Glossary
├── Translation style
│
▼
Chapter Context
│
├── Current story summary
├── Important events
├── Active characters
│
▼
Recent Dialogue
│
├── Last N translated bubbles
├── Potential speakers
│
▼
Current Page
│
├── Image
├── Detected bubbles
└── OCR
```

---

# 10. Hard Memory vs Soft Memory

Context should not treat every AI inference as permanent truth.

## Hard Memory

High-confidence or user-confirmed information.
Examples:

- user-pinned terminology;
- manually corrected character names;
- official character names;
- user-selected translation preferences.
  Providers should follow hard memory unless explicitly overridden.

---

## Soft Memory

AI-inferred information.
Examples:

- speaker identity;
- gender;
- relationship;
- current emotional state;
- scene interpretation;
- pronoun assumptions.
  Soft memory includes a confidence score.
  Example:

```json
{
  "character": "Aki",
  "property": "pronouns",
  "value": "she/her",
  "confidence": 0.68,
  "source": "model_inference"
}
```

Soft memory may be replaced when stronger evidence becomes available.
---

# 11. Context Update Pipeline

Each translation request may optionally return a **context delta**.
Example:

```json
{
  "translations": [...],

  "context_delta": {
    "characters_discovered": [],
    "character_updates": [],
    "glossary_updates": [],
    "scene_summary": "..."
  }
}
```

Processing flow:

```plain text
Existing Context
      │
      ▼
Current Page
      │
      ▼
Translation Provider
      │
      ├── Translation Result
      │
      └── Context Delta
                │
                ▼
         Context Validator
                │
                ▼
        Updated Context Store
```

---

# 12. Context Compression

Koma should not send the entire reading history to the model.
Context should be hierarchically compressed.
Example request context:

```plain text
Series summary
~200–400 tokens

Character memory
~100–300 tokens

Glossary
~100–300 tokens

Chapter summary
~200–400 tokens

Recent dialogue
~10–20 bubbles

Current page
full image
```

Older information should progressively be summarized.
---

# 13. Translation Scheduling & Prefetching

Static `Page N+1 / N+2` prefetching is insufficient for long-strip webtoons.
Koma uses a viewport-aware scheduler.
Inputs may include:

- scroll velocity;
- viewport distance;
- observed model latency;
- provider rate limits;
- current queue length;
- network state;
- available concurrency;
- whether content is already cached.
  Example:

```plain text
Current viewport
████████████████

Next ~2 screens
▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     HIGH PRIORITY

Further below
░░░░░░░░░░░░░░░░     LOW PRIORITY

Far away
                         NOT QUEUED
```

As user reading speed increases, Koma increases its translation look-ahead window.
---

# 14. Context vs Parallelism

Context-aware translation creates a tradeoff between sequential consistency and maximum throughput.
OCR and visual analysis may happen concurrently.
Narrative translation may use bounded parallelism.
Example:

```plain text
Page 10
  │
  ├── OCR Page 11 ─┐
  ├── OCR Page 12 ─┼── parallel
  └── OCR Page 13 ─┘
  │
  ▼
Translate Page 10
  │
Update Context
  │
  ▼
Translate upcoming pages
```

The scheduler may use context snapshots when translating pages concurrently.
---

# 15. Functional Requirements

## P0 — Core Reader

### FR-01 — Manga Image Detection

The extension must identify target manga/webtoon content through a site adapter.
Supported source types:

- `<img>`;
- responsive image elements;
- lazy-loaded images;
- supported `<canvas>` implementations.
  The MVP officially supports **one target platform first**.

---

### FR-02 — Site Adapter Architecture

Website-specific behavior must be isolated from Koma core logic.
Concept:

```plain text
adapters/
├── generic
├── mangadex
├── webtoon
└── community adapters
```

Community contributors should be able to add website support without modifying the translation engine.
---

### FR-03 — Stable Overlay Positioning

Translation overlays must remain aligned during:

- vertical scrolling;
- browser resizing;
- browser zoom;
- image resizing;
- responsive layout changes;
- lazy loading.
  Target:

> Overlay positional drift ≤2% of image dimensions.

---

### FR-04 — Text Auto-Fitting

Rendered text must automatically adapt to available bubble space.
The renderer may adjust:

- font size;
- line height;
- line breaks;
- text alignment;
- padding.

---

# 16. Translation Pipeline Requirements

### FR-05 — Multimodal Translation

Supported providers may perform:

- text region detection;
- OCR;
- reading-order estimation;
- translation;
- bounding-box generation.

---

### FR-06 — Structured Translation Output

Provider results must be normalized into Koma' internal format regardless of provider.
Example:

```json
{
  "bubble_id": "bubble_001",
  "box": [145, 620, 280, 750],
  "source_text": "何をしているんだ？",
  "translated_text": "Kamu sedang apa?",
  "confidence": 0.94,
  "bubble_type": "speech"
}
```

Coordinates use normalized values where practical.
---

### FR-07 — Context-Aware Translation

Every eligible translation request should include the available Koma Context Packet.
Minimum MVP context:

- previous translated dialogue;
- persistent glossary;
- established character names.

---

### FR-08 — Persistent Series Context

Context persists locally between pages and reading sessions.
Switching AI providers must not erase Koma context.
---

# 17. User Experience Requirements

### FR-09 — Translation Toggle

Users may toggle overlays globally or for the current page.
Possible controls:

- floating button;
- keyboard shortcut;
- extension popup.

---

### FR-10 — Reveal Original

Hovering over or selecting translated text may temporarily reveal the original content.
---

### FR-11 — Target Language Selector

Initial languages:

- Indonesian;
- English.
  Architecture must allow additional languages later.

---

### FR-12 — Series Context Viewer

Users may inspect relevant context.
Example:

```plain text
Characters
──────────────
Yuki
Ken
Takahashi

Glossary
──────────────
先輩 → senpai
生徒会 → student council

Translation Style
──────────────
Natural
Preserve honorifics ✓
```

---

### FR-13 — User-Pinned Glossary

Users may override terminology.
Pinned glossary entries become hard context.
Example:

```plain text
覇気 → Haki
```

Koma should consistently preserve this term.
---

# 18. API & Provider Configuration

### FR-14 — BYOK

Users may provide their own supported provider API credentials.
Users should clearly understand that API requests are sent directly to their chosen provider.
---

### FR-15 — Key Storage Modes

Koma offers:
**Session Mode**

- API credentials live only for the browser session.
  **Remember Key**
- credential persistence is optional;
- users receive a clear security explanation.
  The PRD must not describe ordinary browser extension local storage as encrypted secure storage.

---

### FR-16 — Provider Selection

Users may choose among installed/supported providers.
Example:

```plain text
Provider
────────────
Gemini
OpenAI
OpenRouter
Local
Custom OpenAI-compatible
```

---

# 19. Local Cache

Koma should avoid unnecessary repeat processing.
Image content is identified using a deterministic image fingerprint/hash.
Conceptual cache structure:

```plain text
imageHash
│
├── detection
│
├── OCR
│
├── translations
│   ├── Indonesian
│   ├── English
│   └── other
│
└── layout
```

Cache keys may include:

- image hash;
- source language;
- target language;
- provider;
- model;
- prompt version;
- context version when necessary.

---

# 20. Resource Lifecycle

Large image buffers must not be retained longer than necessary.

```plain text
Image loaded
   ↓
Temporary decode
   ↓
Processing
   ↓
Structured result stored
   ↓
Image buffer released
```

The extension should retain lightweight structured data rather than unnecessary base64 or canvas buffers.
---

# 21. Performance Requirements

Koma should prioritize **perceived performance**.
Optimizations include:

- image resizing before upload;
- appropriate image compression;
- prefetch scheduling;
- response caching;
- concurrent OCR where appropriate;
- translation queue prioritization;
- lazy processing;
- buffer cleanup;
- request batching where supported.
  Performance measurements should include:

```plain text
time-to-first-overlay
cold inference latency
prefetch hit rate
cache hit rate
bytes uploaded
API requests/page
translation failures
overlay drift
```

---

# 22. Error Handling

If translation fails:

- original manga remains visible;
- failed overlays are not rendered;
- a lightweight retry indicator appears;
- exponential backoff may be used;
- other successfully translated pages remain functional.
  A failed API request must never break the original manga reader.

---

# 23. Privacy & Security

## Principles

- Reading history should remain local by default.
- Koma does not require a Koma account for BYOK mode.
- Images are sent only to the provider selected by the user.
- No manga images are stored on Koma-operated servers in BYOK mode.
- Sensitive API credentials must never be logged.
- Telemetry should be opt-in or privacy-preserving.
  Users must be clearly informed when manga images are being sent to an external AI provider.

---

# 24. Open-Source Strategy

Koma core should be publicly auditable and extensible.
Potential extension interfaces include:

```plain text
providers/
adapters/
renderers/
ocr/
context/
```

Community contribution opportunities:

- additional website adapters;
- additional AI providers;
- translation prompts;
- OCR pipelines;
- performance optimizations;
- local AI backends;
- language-specific translation rules.

---

# 25. Suggested Repository Architecture

```plain text
Koma/
│
├── extension/
│   ├── content/
│   ├── background/
│   ├── popup/
│   └── settings/
│
├── core/
│   ├── scheduler/
│   ├── cache/
│   ├── context/
│   ├── rendering/
│   └── translation/
│
├── providers/
│   ├── gemini/
│   ├── openai/
│   ├── openrouter/
│   ├── ollama/
│   └── openai-compatible/
│
├── adapters/
│   ├── generic/
│   └── mangadex/
│
├── shared/
│
├── tests/
│
└── benchmarks/
```

---

# 26. Rendering Strategy

The MVP uses DOM-based overlays.
Bubble categories:

```plain text
speech
narration
thought
unknown
```

For MVP:

### Supported

- normal speech bubbles;
- simple narration boxes.

### Deferred

- text directly embedded into artwork;
- stylized sound effects;
- irregular effects text;
- destructive image editing.
  Future releases may use image inpainting for these categories.

---

# 27. Canvas & Image Fallback Strategy

Image extraction should use a fallback hierarchy.

```plain text
Readable <img>
      ↓
Original image fetch

otherwise

Readable Canvas
      ↓
Canvas extraction

otherwise

Browser-supported visible capture
      ↓
Crop target region

otherwise

Unsupported reader
```

Koma should never assume that every canvas can be directly exported.
---

# 28. Cost Transparency

Where technically possible, the UI should expose provider usage information.
Example:

```plain text
Current Chapter

Pages processed: 42
Cached: 17
Provider requests: 11
Estimated usage: $0.04
```

Exact monetary estimates may only be displayed when provider pricing information is known reliably.
---

# 29. Business Model Hypothesis

The open-source product remains fully usable through BYOK.
Future monetization may focus on convenience rather than intentionally degrading the open-source edition.
Potential future offering:

### Koma Open

- free;
- open source;
- BYOK;
- local caching;
- model-agnostic;
- community providers.

### Koma Cloud

Potential future service:

- no API key setup;
- managed inference;
- synchronized context;
- optimized models;
- cloud translation cache;
- cross-device settings.
  This is a future hypothesis and is not required for MVP validation.

---

# 30. MVP Scope

The first MVP intentionally remains narrow.

## Included

- Chrome extension Manifest V3;
- one officially supported manga platform;
- Japanese source language;
- Indonesian and English output;
- one multimodal provider;
- BYOK;
- manga image detection;
- speech bubble detection;
- DOM overlays;
- local cache;
- previous-dialogue context;
- persistent glossary;
- basic adaptive prefetch;
- translation toggle;
- API failure recovery.

## Excluded

- advanced inpainting;
- SFX translation;
- offline WebGPU inference;
- automatic speaker recognition;
- dozens of site adapters;
- mobile support;
- Koma-hosted inference.

---

# 31. Release Roadmap

## Milestone 0 — Technical Spike

Goal:
Validate the hardest assumptions.
Deliverables:

- process one manga page;
- obtain OCR + bounding boxes;
- translate text;
- place responsive overlays;
- benchmark real-world latency.
  Success condition:

> One manga page can be reliably translated and rendered.

---

## Milestone 1 — Reading PoC

Deliverables:

- Chrome extension;
- support one site;
- provider integration;
- BYOK;
- multiple-page reading;
- overlay renderer;
- local cache;
- simple recent-dialogue context.
  Success condition:

> A user can read a full chapter without manually triggering every page.

---

## Milestone 2 — Context Engine

Deliverables:

- persistent character names;
- glossary;
- recent dialogue;
- chapter summary;
- context delta;
- hard/soft memory;
- user corrections.
  Success condition:

> Translation consistency visibly improves compared with stateless translation.

---

## Milestone 3 — Performance Engine

Deliverables:

- viewport observer;
- adaptive prefetch;
- reading velocity prediction;
- concurrent preprocessing;
- queue prioritization;
- provider rate-limit awareness;
- performance benchmarks.
  Success condition:

> Most translated content is ready before reaching the viewport during normal reading.

---

## Milestone 4 — Provider Ecosystem

Deliverables:

- provider interface stabilized;
- additional cloud providers;
- OpenAI-compatible provider;
- local provider support;
- community provider documentation.

---

## Milestone 5 — Public Beta

Deliverables:

- Chrome Web Store release;
- telemetry;
- crash reporting;
- adapter documentation;
- contributor guide;
- public benchmarks.

---

# 32. Key Risks & Mitigation

<table header-row="true">
<tr>
<td>Risk</td>
<td>Impact</td>
<td>Mitigation</td>
</tr>
<tr>
<td>AI produces inaccurate OCR</td>
<td>Wrong translation</td>
<td>Preserve source text, confidence tracking, retry/provider switching</td>
</tr>
<tr>
<td>Model misunderstands narrative context</td>
<td>Incorrect pronouns/meaning</td>
<td>Context Engine, recent dialogue, glossary</td>
</tr>
<tr>
<td>Wrong context becomes persistent</td>
<td>Repeated translation errors</td>
<td>Hard vs soft memory, confidence scores, user corrections</td>
</tr>
<tr>
<td>Translation slower than reading</td>
<td>Poor UX</td>
<td>Adaptive prefetch and cache</td>
</tr>
<tr>
<td>Rate limits</td>
<td>Translation stalls</td>
<td>Queue throttling and provider awareness</td>
</tr>
<tr>
<td>Provider disappears or changes</td>
<td>Product breaks</td>
<td>Model-agnostic provider interface</td>
</tr>
<tr>
<td>Manga site changes DOM</td>
<td>Adapter breaks</td>
<td>Site adapter architecture</td>
</tr>
<tr>
<td>Canvas cannot be directly extracted</td>
<td>Missing images</td>
<td>Fallback extraction strategy</td>
</tr>
<tr>
<td>Long webtoons consume excessive API calls</td>
<td>High cost</td>
<td>Viewport scheduling and request prioritization</td>
</tr>
<tr>
<td>User API key exposure</td>
<td>Security issue</td>
<td>Session key option, no logging, explicit threat model</td>
</tr>
<tr>
<td>Community adapters introduce instability</td>
<td>Reader failures</td>
<td>Adapter API validation and automated testing</td>
</tr>
<tr>
<td>AI context increases token usage</td>
<td>Higher cost/latency</td>
<td>Hierarchical context compression</td>
</tr>
</table>
---
# 33. Translation Result Schema
Example normalized provider response:
```json
{
  "page_id": "page_001",
  "source_language": "ja",
  "target_language": "id",
  "bubbles": [
    {
      "id": "bubble_001",
      "box_2d": [145, 620, 280, 750],
      "bubble_type": "speech",
      "source_text": "何をしているんだ？",
      "translated_text": "Kamu sedang apa?",
      "speaker": null,
      "confidence": {
        "ocr": 0.96,
        "translation": 0.91
      }
    }
  ],
  "context_delta": {
    "characters": [],
    "glossary_updates": [],
    "scene_summary": null
  }
}
```
---
# 34. Initial Context Packet Schema
```json
{
  "series": {
    "title": "Unknown",
    "source_language": "ja"
  },

"characters": [],

"glossary": {},

"chapter": {
"summary": null
},

"recent_dialogue": [],

"preferences": {
"target_language": "id",
"translation_style": "natural",
"preserve_honorifics": true
}
}

````
---
# 35. Core Product Principle
Koma should never optimize only for:
> “How quickly can we call an AI model?”
Instead, the product should optimize for:
> **“How rarely does the reader notice that translation is happening at all?”**
The ideal experience is:
```plain text
Open Raw Chapter
       ↓
Enable Koma
       ↓
First visible content translates
       ↓
Start reading
       ↓
Upcoming content processes automatically
       ↓
Characters and terminology remain consistent
       ↓
Reader keeps scrolling
       ↓
Translation is already there
````

When the translation system becomes effectively invisible to the user, Koma has achieved its intended experience.
---

# 36. MVP Validation Questions

Before expanding the product, the team should validate:

1. Does context-aware translation produce a noticeable improvement to readers?
2. Can adaptive prefetch make translation feel substantially faster than existing tools?
3. Are users willing to configure BYOK?
4. Which provider produces the best speed/cost/quality balance?
5. Which translation errors annoy readers the most?
6. How frequently do users manually correct terminology?
7. Can site adapters remain maintainable?
8. How much context can be included before latency or API cost becomes problematic?
9. Does a model-agnostic architecture provide meaningful user value?
10. Will users choose Koma over existing translators specifically because of context, speed, openness, or some combination of the three?

---

# 37. Definition of MVP Success

The MVP should be considered successful when a user can:

1. Install Koma.
2. Open a supported raw manga chapter.
3. Configure their provider.
4. Enable translation.
5. Begin reading within seconds.
6. Scroll naturally without manually translating each page.
7. Encounter mostly pre-translated upcoming content.
8. See consistent terminology and character references across multiple pages.
9. Revisit previously translated content without another API request.
10. Finish a chapter without the translation tool becoming the dominant part of the reading experience.
    The MVP does **not** need to produce perfect scanlation-quality output.
    It needs to prove that:

> **Fast + context-aware + model-agnostic translation creates a meaningfully better manga reading experience than existing stateless or slow alternatives.**
> <empty-block/>
