# Reading Context Persistence

This document records the storage and ordering policy for KOMA-014.

## Scope identity

Site adapters provide a normalized reading identity. The core receives the site, chapter ID, and an optional series ID; it does not inspect reader DOM details.

For MangaDex, the adapter accepts a series ID only when it finds one unique MangaDex `/title/<UUID>` identity on the page. If no series ID is available or the page contains conflicting IDs, Koma uses chapter-only scope. It does not guess a series from a title string.

Recent dialogue belongs to a chapter and target language. A glossary belongs to a known series and target language. If the adapter cannot identify a series, that chapter owns its glossary too. Provider and model IDs are not part of these keys, so switching providers keeps context when the reading and target-language scope stays the same.

## Ordering and bounds

Each accepted translation replaces the contribution for its image ID. The durable reader replay path uses chapter/page identity for this contribution, so rebinding an overlay to a new session image ID cannot duplicate dialogue. This makes cache replay and retry idempotent. Context packets for page `n` include only retained dialogue whose page index is less than `n`; results that arrive out of order cannot add later-page dialogue to an earlier request.

The dialogue window holds at most 15 entries, ordered by chapter page index and then within-page bubble order. The glossary holds at most 50 terms. Hard glossary entries take precedence over model updates. When all glossary slots contain hard entries, adding another new term is rejected; `addGlossaryEntry` returns `false` so a UI can report that limit.

## Storage and retention

Context records use the `koma_context:v1:` key prefix and schema version `1`. Chapter dialogue and series glossary use separate records when a series ID is available. At most 50 records are retained across both record types. Koma evicts the least recently used record when the limit is exceeded, with a stable key comparison for timestamp ties. Reading or updating a record refreshes its LRU timestamp.

Records remain until the user resets that reading scope, LRU eviction removes them, or the extension is uninstalled. A corrupt or unsupported record is discarded and treated as a cache miss. If storage is unavailable, translation continues with in-memory context.

Only normalized dialogue entries and glossary terms are stored. Provider credentials, raw provider responses, and image buffers are not included. Reset Context removes the active chapter's dialogue and the active glossary scope for the selected target language. It does not remove provider settings, translation cache entries, or unrelated series context.

KOMA-016 adds an optional persisted user glossary revision to context snapshots. Model soft updates leave this revision unchanged. Reset Context invalidates accepted cache replay eligibility for the related glossary scope before removing context records, without starting inference. See [Translation Cache](TRANSLATION_CACHE.md) for the replay and Clear Cache policy.

## Context viewer and pinned glossary editing (KOMA-015)

The popup exposes a Reading Context card. It reads the context through a `CONTEXT_COMMAND` session message with `view`, `save`, `setPinned` and `remove` operations; the reader session resolves the same manager that feeds the next request. The card shows the active chapter and target-language scope, the retained dialogue window, the glossary, and the configured limits.

Editing policy:

- Saving a term whose key already exists updates that entry; the dialog reports it as an update, not a second record.
- Pinning maps to `isHard`. Pinned terms are mandatory context, win over model soft updates, and cannot be replaced by them.
- Every changed add, update, pin, unpin or remove advances the context revision, which makes earlier replay records ineligible. The card then points at Retranslate Visible Page, and the visible overlays are never replaced automatically and no chapter-wide request is started.
- If the reading session has not started, the command loads the stored scope for the popup's selected target language before mutating, so the change still lands in the correct series or chapter record. A live session keeps its own scope; the viewer reports the session language, not the popup selection.
- Empty or whitespace values are rejected without writing. Removal of a term that is no longer present reports that state and returns the current view so the list resyncs.

Reviewer hardening from the KOMA-015 review: context commands are validated at the reader boundary, so unknown operations and malformed or over-length fields are rejected with a fixed message instead of falling into another branch. The popup ignores responses from superseded commands (a failed superseded action still reports its error) and keeps the term key fixed during an explicit edit, so renaming a term is Remove plus Add.

KOMA-015 also accepts a late acceptance instead of failing a rendered page: when the context revision or scope changes while a request is in flight, the reader keeps the displayed translation, reports through the existing feedback channel that the page was not saved, and records nothing. A retry repeats the provider request only when the user asks for it.

### Validation status (2026-10-13)

`tests/context-viewer.test.ts` covers the command surface, scope persistence and fallback, duplicate policy, pin and revision behavior, model precedence and empty-state rejection. `tests/cache-replay.test.ts` covers the late-acceptance warning, and `tests/orchestrator.test.ts` covers keeping a rendered page completed when acceptance rejects. TypeScript, ESLint, Prettier, the production build, `git diff --check` and 326 Vitest tests pass.

Chrome 155.0.8059.39, unpacked build, disposable profile, local fixtures and intercepted provider responses, 320px popup metrics, zero console errors: scope and dialogue render, keyboard opens the panel with a visible focus ring, typing and Enter save a pinned term with the Pinned badge, the card offers Retranslate Visible Page, the pinned term survives a provider switch and a page reload, and Remove confirms and removes the term. Panel controls measured 44px tall with no popup or page overflow. Live provider quality, real MangaDex pages and a full security audit remain unverified.
