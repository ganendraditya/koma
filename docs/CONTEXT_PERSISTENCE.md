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

Context storage commands from reader tabs are handled by the service worker, which serializes loads, updates, and resets. Saves carry only changed dialogue contributions and glossary terms. A stale model update cannot replace a pinned term or restore a term removed elsewhere; a stale user edit to the same term is rejected so the editor can retain the draft and reload. Small generation markers fence off writes from tabs that loaded a scope before it was reset or evicted.

Only normalized dialogue entries and glossary terms are stored. Provider credentials, raw provider responses, and image buffers are not included. Reset Context removes the active chapter's dialogue and the active glossary scope for the selected target language. It does not remove provider settings, translation cache entries, or unrelated series context.

KOMA-016 adds an optional persisted user glossary revision to context snapshots. Model soft updates leave this revision unchanged. Reset Context invalidates accepted cache replay eligibility for the related glossary scope before removing context records, without starting inference. See [Translation Cache](TRANSLATION_CACHE.md) for the replay and Clear Cache policy.
