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
