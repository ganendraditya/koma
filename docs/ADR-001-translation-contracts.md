# ADR-001: Provider-Independent Translation & Coordinate Contracts

## Status

Accepted

## Context

Koma connects three distinct layers:

1. **Site Adapters** (`adapters/`) that extract raw manga images from various web readers (e.g. MangaDex).
2. **Translation Providers** (`providers/`) that interact with vision/OCR/translation models (e.g. Google Gemini, OpenAI, Claude, DeepL).
3. **DOM Overlay Renderers** (`extension/content/` / `core/renderer/`) that position translated text on top of speech bubbles without altering original artwork.

If downstream renderers or cache layers consume provider-specific payloads (such as raw Gemini response fields or OpenAI format), swapping or chaining providers would break the renderer and require sweeping changes. Furthermore, inconsistent coordinate spaces across different models (pixels vs ratios vs normalized integers) create visual misalignment and float rounding drift during browser scrolling and zoom.

## Decision

### 1. Provider-Agnostic Contract (`TranslationResult`)

All translation providers must implement `TranslationProvider` and normalize their outputs into `TranslationResult`. Downstream components (renderers, cache, and context engine) **MUST NEVER** consume raw provider response objects directly.

### 2. Normalized Integer Coordinate System [0, 1000]

All bounding boxes use the integer range `[ymin, xmin, ymax, xmax]` normalized to `[0, 1000]`:

- `(0, 0)` represents the top-left corner of the image.
- `(1000, 1000)` represents the bottom-right corner of the image.
- Coordinates are integers, avoiding floating-point precision issues across serialization boundaries.
- Conversion to CSS percentages is trivial: `top = ymin / 10 %`, `left = xmin / 10 %`.
- Conversion to rendered pixels: `top = (ymin / 1000) * renderedHeight`.

### 3. Separation of Source Text and Translated Text

Each `Bubble` retains both `sourceText` (original Japanese/Korean/Chinese) and `translatedText` (Indonesian/English) in distinct fields. This enables:

- "Hover to Reveal" original text functionality.
- Side-by-side comparison and translation inspection.
- Translation memory and glossary extraction.

### 4. Unique Bubble IDs per Image

Every detected bubble carries an `id` that is unique within its parent `MangaImage` (e.g. `bubble_001`, `bubble_002`), enabling targeted DOM patch updates and reconciliation without rerendering all bubbles.

### 5. Standardized Error Hierarchy

Errors originating from providers are normalized into typed subclasses of `KomaError` (`ProviderAuthError`, `ProviderRateLimitError`, `ProviderTimeoutError`, `InvalidProviderResponseError`, etc.). This allows the UI orchestrator to display actionable feedback (e.g. prompt user to check their API key, or back off on rate limit) without crashing the reader.

## Consequences

- **Positive:** Providers can be developed, tested, and swapped in isolation. Site adapters and DOM renderers can be developed in parallel without waiting for model API implementations.
- **Positive:** Eliminates floating-point coordinate drift when zooming and scrolling.
- **Trade-off:** Every new provider implementation must write a lightweight response normalizer to map its model-specific output to `TranslationResult`.
