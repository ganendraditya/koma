# Durable Translation Replay

KOMA-016 uses accepted-result replay for the reader, separate from the legacy request cache. `ReadingTranslationProvider` owns preparation, replay and acceptance; a single `ReplayStore` in the background worker owns memory, persistent writes, invalidation and clearing across tabs. The generic v1 `CachedTranslationProvider` remains available for existing callers, but the production reader does not use it.

## Identity and versions

The MangaDex adapter supplies a source identity containing the normalized chapter UUID and page filename. The chapter/page position stays stable when the reader creates a new blob URL. Before lookup, the reader acquires the current image bytes and computes SHA-256. Changed bytes miss even if the URL and filename stay unchanged. On a miss, inference uses the same transient base64 data, without another image fetch. A hit needs no inference, but may still acquire image bytes.

Keys use `koma_cache:v2:<SHA-256 of descriptor>`. Records use schema version `2`; the translation prompt version is currently `1`. Bump the prompt version when output-affecting prompt/normalization behavior changes. The descriptor includes:

- site, optional series, chapter, page index and adapter source identity;
- SHA-256 content fingerprint and source/target language;
- provider, model and the credential-free provider configuration descriptor (endpoint, API format, output format and reasoning setting);
- prompt version and a context/preference digest, including user glossary revision, hard glossary entries, style, honorific preference, custom prompt, temperature and image MIME type.

Caller-supplied context is included in the preference digest in full; it is not treated as rolling reader state. Timeout and credential changes alone do not change translation identity. Runtime settings revisions still reject stale extension messages.

The complete descriptor is verified when looking up a digest key. A mismatching or corrupt record is removed and treated as a miss, never rebound to an unrelated image. Content equality relies on SHA-256 collision resistance, not a claim that hash collisions are impossible. Image URLs, credentials, transient image buffers and raw vendor payloads are not stored. Stored results are rebuilt from whitelisted normalized domain fields.

## Acceptance and context

An inference result is not a replay entry merely because the provider returned it. The orchestrator must render it successfully, or accept it while overlays are hidden. It then calls the provider's optional `acceptTranslation` hook. The reading provider checks cancellation, active scope and the user context revision, commits normalized context, checks cancellation again and dispatches replay publication. Rendering failure never reaches publication. Publication is fenced by a worker-generation ticket: Clear Cache, invalidation or a worker restart rejects an earlier ticket.

Accepted replay ignores subsequent rolling dialogue and model soft-glossary changes. This allows pages 0, 1 and 2 to replay after all three pages' context has been restored. Requests for fresh inference use only retained dialogue strictly before the requested page. Replay replaces the chapter/page contribution, including when the current image ID differs; it does not append duplicate dialogue. Context remains provider-independent.

Invalidation policy:

- A glossary edit through the context manager changes the persisted series/target-language user revision (chapter fallback without series identity). Old replay identities no longer match. Model soft updates do not change that revision.
- Explicit retranslation invalidates replay for that page and later pages of the same chapter/target language before a new provider request. Existing displayed results remain visible until replaced. Retranslation requires confirmation because it may incur provider cost.
- Reset Context pauses work and invalidates replay for its glossary scope before clearing the chapter dialogue and glossary. Translation records remain stored but are ineligible, and displayed results remain visible. Reset does not trigger inference. If invalidation fails, reset reports failure instead of claiming success.

There is no glossary editor UI in this issue. Simultaneous editing of context in multiple tabs is not a synchronized editor feature; tabs restore persisted revisions when entering a scope.

## Retention, budgets and failures

Defaults are 100 memory records, 200 persistent records, 4 MiB of serialized persistent translation data, and 256 KiB per persistent record. The effective byte budget is the smaller of 4 MiB and 80% of Chrome's local-storage quota minus the serialized size of all non-cache data. UTF-8 key bytes plus JSON bytes define the serialized budget. It is a conservative planning bound, not a substitute for Chrome quota enforcement.

Accepted writes and reads refresh a monotonic LRU timestamp. Eviction orders by timestamp, then by the digest key for ties. No TTL is applied: records remain until clear, invalidation followed by LRU eviction, quota eviction, or extension uninstall. Eviction removes only translation records, never context, settings or credentials.

Oversized results remain usable in bounded worker memory but are not persisted, including on subsequent lookups. A write failure permits at most one retry after evicting one more translation record. A read failure prevents writes against an unknown shared-storage budget. Persistence warnings use fixed text and do not include payloads, storage error details or credentials. A rejected generation also reports that the result was not saved. None of these warnings turn an already usable translation into a provider failure.

V1 records cannot prove image content or accepted provenance. They are safe misses and are removed during the first successful worker maintenance operation. Invalid v2 records are purged on maintenance or lookup. First maintenance after a worker restart also enforces the current persistent record/byte limits and removes records above the per-record limit.

## Clear Cache

Both popup and reader have a native-button Clear Cache action with confirmation and loading/success/error feedback. Clear Cache covers all `koma_cache:` translation records and worker memory, across tabs. It first pauses active readers, cancels queued/active work, then serializes deletion and rotates the acceptance generation. Readers cannot resume during clearing. A failed clear reports failure and leaves work paused.

Displayed overlays and their in-session results, reading context, glossary, provider settings and credentials stay unchanged. Scroll, visibility changes and late provider responses do not resume inference. The user must press Resume/Translate, or explicitly retranslate a page. A reload has no translation-cache replay after a successful clear and requires explicit translation action again.

## Verification

`tests/cache-replay.test.ts` covers three-page reload/rebinding with zero inference, strict pre-page context, user glossary edits, soft updates, byte/configuration changes, safe misses, descriptor mismatch, LRU, quota limits/failures, generation fences and normalized persistence. `tests/reading-runtime.test.ts` exercises actual popup/content/worker commands, clear/cancel preservation and explicit retranslation. `tests/orchestrator.test.ts` verifies acceptance after render, hidden-overlay acceptance and rendering failure.

These tests use synthetic images, dummy credentials and mocked provider responses. They do not establish live-provider translation quality or live-reader compatibility.

### Validation status (2026-10-12)

- Automated: 314 tests across 24 files passed; TypeScript, full ESLint, Prettier, production packaging and `git diff --check` passed.
- Execution: disposable source snapshots in a read-only, network-disabled Docker sandbox. Automated-check limits: 2 CPUs, 768 MiB memory, 128 processes, 32 MiB per output file, 512 MiB scratch disk; tests have a 180-second wall limit. Dependencies were already installed in the local validation image. The sandbox build does not update the checkout's ignored `dist/` directory.
- Scoped messaging checks: rejects other extensions, subframes, unsupported reader origins/paths and mismatched chapter, settings revision, model, target, configuration or prompt version. These are local dummy-data checks, not a full security audit.
- Browser evidence (Chrome 155.0.8059.39, unpacked build, disposable profile, local fixtures, intercepted provider, no live MangaDex or provider calls): `sh koma016-validate.sh browser` exit 0, zero console errors. Cold run: 3 inference requests with context `[]`, `[0]`, `[0,1]`. Reload with new blob URLs: 0 additional requests. Changed bytes on one page: 1 request. Model, endpoint and target changes: 3 requests each, no unrelated replay. Persisted cache: 4195 bytes with no key or base64 leakage. Clear Cache from popup and reader, cancel during held inference, and Reset Context all passed their checks (see the list below).

### Changed-control checks

The UI keeps the existing popup/panel design, with ENERGY 1 / RHYTHM 1 / MOTION 1. Secondary button styling keeps Translate/Resume as the primary action. Existing fonts, spacing and colors are reused to avoid a popup redesign; no icons, illustrations or animations were added.

- Popup Clear Cache: keyboard Enter opens native confirmation; cancel keeps cache. Confirmed clear removes records, keeps both tabs' overlays, context and settings, and stays paused. Loading state disables the button and refuses Resume. Storage failure shows fixed error feedback and keeps records.
- Reader Clear Cache: native focused Enter clears cache at 320px and keeps overlays. Post-clear reload makes zero automatic requests; explicit Translate makes three fresh requests.
- Clear during active request: held inference is cancelled, the late result is rejected, and no extra request starts. Overlays and context are kept.
- Retranslate Visible Page: keyboard Space confirms one request, invalidates later replay and excludes future dialogue from the prompt.
- Reset Context: keeps displayed overlays, invalidates scoped replay and starts no inference.
- Hidden overlays: keyboard Hide/Show restores overlays without inference; popup labels update.
- Reader status: Hide/Show and Escape work by keyboard and restore focus.
- Layout: popup tab order reaches Clear Cache; focus ring is 2px `rgb(165, 180, 252)`; no overflow at 320px or 900px; reader panel has no overflow at 320px or 200% zoom.
- Not covered: live provider quality, real MangaDex pages, two-tab worker-restart edge cases beyond the scripted checks, and a full security audit.

Antislop gate: Chrome checks above now pass. Source/test checks pass for specific labels and feedback, native button semantics, live status text, 44px minimum control sizes, no new assets or invented claims, and no added decoration. Measured new-control contrast: reader text `#f8fafc` on `#131b2e` 16.40:1; help text `#94a3b8` on `#090d16` 7.58:1; focus `#a5b4fc` on `#090d16` 9.75:1; popup button text `#f8fafc` on `#1e293b` 13.98:1; popup border `#64748b` against `#1e293b` 3.07:1. Actual narrow-width/200% zoom rendering is not claimed as tested.

### Required Chrome evidence before closing #32

Use a disposable profile in a network-disabled, resource-bounded browser sandbox, with a built unpacked extension, dummy provider settings, three synthetic pages and intercepted provider responses. Serve/intercept the MangaDex URL only as a local fixture; do not visit the live site or call a real provider. Record:

1. Cold Translate: three accepted overlays, three inference requests and scoped persisted context.
2. Reload the fixture, generating new equivalent blob URLs. Click Translate: the same three overlays, restored idempotent context and **zero additional inference requests**. Count inference separately from image acquisition.
3. Change one page's bytes while keeping its filename; only that page misses. Change target/model/configuration in separate runs and verify a miss rather than unrelated replay.
4. With two reader tabs open, clear from each surface in separate runs. Verify all translation records and worker memory are empty, both tabs stay paused, displayed overlays/context/settings remain, and scrolling/late responses do not start inference.
5. Reload after a clear: no automatic inference or cached overlays. Explicit Translate makes fresh requests. Explicit retranslation after replay replaces the selected page without future dialogue in its request.
6. Tab through the changed controls and activate them with Enter/Space; dismiss confirmation with Escape. Check loading/error text, focus, a 320px viewport and 200% zoom. Capture screenshots and confirm no extension/page console errors.

The inference counts above were observed in the Chrome run listed under Validation status. Live-provider behavior and real MangaDex pages remain unverified.
