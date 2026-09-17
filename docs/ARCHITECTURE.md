# Koma Architecture & Technical Principles

## Overview

Koma is an in-browser manga & manhwa real-time translator built as a Chrome Extension (Manifest V3).

The core thesis of Koma is to translate manga speech bubbles into seamless DOM overlays without modifying original artwork or requiring heavyweight desktop setups.

## Core Architectural Boundary

Koma enforces strict separation of concerns:

```
[ Web Page (Manga Site) ]
         │
         ▼
[ Site Adapter (adapters/) ]
   - Extracts MangaImage objects
   - Filters out UI, avatars, ads
         │
         ▼
[ Koma Core (core/) ]
   - Pipeline orchestrator
   - Cache manager
   - Context manager
         │
         ▼
[ Translation Provider Interface (providers/) ]
   - Translates MangaImage with optional Context
   - Normalizes raw model output to standard TranslationResult
         │
         ▼
[ DOM Overlay Renderer (core/renderer / extension/content) ]
   - Calculates relative coordinates
   - Renders position: absolute <div> / SVG patches
   - Handles zoom, resize, and scroll tracking
```

### Critical Rules

1. **Provider Independence**: Downstream renderers and core orchestrators MUST NEVER consume raw responses from LLMs/providers directly (e.g. Gemini, OpenAI, Claude). All providers must map to `TranslationResult`.
2. **Adapter Isolation**: Website-specific DOM scraping and heuristics belong strictly inside `adapters/`.
3. **No Artwork Destruction**: Translations are applied as non-destructive DOM overlays so users can toggle or inspect original text anytime.

---

## Engineering & Design Principles

### 1. Tell, Don't Ask & Law of Demeter

Components should command collaborators to perform domain actions rather than querying internal state and making procedural decisions externally.

- _Good:_ `orchestrator.translatePage(mangaImage)`
- _Avoid:_ `popup` inspecting adapter internals, extracting base64 data, verifying API keys, and manually invoking renderer subroutines.

### 2. Orthogonality

Modules must be loosely coupled so that modifications in one domain do not ripple into unrelated layers:

- Alterations in manga reader DOM layouts only affect the relevant file in `adapters/`.
- Switching or upgrading an AI provider model only touches `providers/`.
- Changing CSS overlay styles only affects the renderer in `extension/content/` or `core/renderer/`.

### 3. Reversibility & Dependency Inversion (DIP)

High-level modules must depend on abstractions, not concrete vendor implementations. All AI interactions go through `TranslationProvider`. Switching from Gemini to DeepL or a local offline model requires zero refactoring of downstream renderers or cache stores.

### 4. DRY (Don't Repeat Yourself) Without Indirection

Consolidate single sources of truth (e.g. domain models in `core/contracts/`). Avoid redundant pass-through layers or empty re-export directories that add navigation friction without providing abstraction value.

### 5. YAGNI (You Aren't Gonna Need It)

Build strictly for the active sprint's acceptance criteria. Favor simple constructor parameter injection over heavyweight runtime DI containers.
