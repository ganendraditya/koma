# Sprint 1 smoke test

For the session controls and bounded viewport scheduler introduced by KOMA-012/KOMA-013, see [reading-session verification](READING_SESSION_VERIFICATION.md). It records production-bundle toolbar-popup checks and provider-request counts.

Build with `npm run dev` for pipeline timings, then load `dist/` through Chrome's **Load unpacked** and reload the reader tab. Open the content-script console and enable verbose/debug messages. Entries begin with `[Koma pipeline]`. They contain stage names, outcomes, and milliseconds, never image bytes, provider responses, or credentials. The provider request timer covers the Gemini HTTP request, including failed requests; normalization covers response mapping. `total: translation` measures provider and render work for a successfully translated image. It excludes adapter detection and queue wait time, which vary between new requests and retries. A cache `miss` alongside `total: translation` identifies a cold run. Detection scans and rendering log durations on success; a failed stage logs `failed`. Production builds suppress these entries.

## Reference pages

The MangaDex adapter's [existing reader check](MANGADEX_ADAPTER.md#qa-evidence) covers the public chapter below. Use its first three consecutive pages as regression references. These are page references, not checked-in artwork or claims that translation was verified.

| Reference | Chapter page                                                                  | Check                                    |
| --------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| 1         | [Page 1](https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c/1) | First loaded image and overlay alignment |
| 2         | [Page 2](https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c/2) | Next image and reading order             |
| 3         | [Page 3](https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c/3) | Third image, scroll and resize alignment |

If MangaDex changes a route or removes this chapter, record the replacement chapter URL, three page numbers, and expected image count before using new references.

## Checklist and evidence

Record the browser version, build commit, chapter URL, date, page mode, and result (pass/fail) for each step. Do not mark a check as passed from unit tests alone.

- [ ] Open the reference chapter in Chrome (Long Strip mode; wait for images). Confirm popup and diagnostic image counts agree; no UI artwork is counted.
- [ ] Configure a working provider key in the popup. Translate three consecutive images. Record each overlay's page and bubble count, and check alignment while scrolling, resizing, and zooming. Verify the artwork remains intact.
- [ ] In the development console, record detection, provider request, normalization, render, and total translation durations (ms) for a cold run. Check that logs and errors contain no key, image bytes, or raw provider response.
- [ ] Re-run an identical translation using the cache path. Record `cache: miss` for the first request and `cache: hit` for the second; confirm no second provider request. If the current UI cannot re-request a completed image, clear its completed state or use a development harness with `CachedTranslationProvider`.
- [ ] Open an unsupported site. Confirm the extension reports no supported images or an inactive tab, and the site remains usable without uncaught Koma errors.
- [ ] Use an invalid provider key or block the Gemini request, then retry with a valid key. Confirm a provider-stage failure is reported, the manga page remains usable, and the retry can render an overlay.
- [ ] Feed an invalid model response through a development harness. Confirm a normalization-stage error without exposing its raw response. Force a renderer failure in the harness and confirm a render-stage error; retry after restoring the renderer.

Recorded Chrome results are below. The October 1 fix verification includes real Gemini output and an actual toolbar-popup cache replay. Keep the remaining quality and measurement gaps with the evidence when reviewing Sprint 1 acceptance.

## Smoke run: 2026-09-26

- Build commit: `a50d3b6` (`origin/main`). Browser: Google Chrome for Testing 145.0.7632.6, headless, with the unpacked production `dist/` extension. Chapter: <https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c/1>. The reader loaded all 13 chapter images; its page-mode setting was not independently confirmed.
- Repository checks passed on Node 22.15.1: typecheck, lint, formatting, 153 Vitest tests, and production build. These checks do not substitute for the live translation demo.
- **Partial pass, detection:** the live reader contained 13 loaded reader images and 23 total page images. The extension's `CHECK_PAGE_STATUS` and `RUN_DIAGNOSTIC` responses both counted 13 reader images; the diagnostic reached the service worker. The popup was opened as a separate tab for the headless probe, so its normal action-popup count display was not verified.
- **Pass, unsupported page:** on <https://example.com/>, the extension reported `imageCount: 0` and `isSupportedSite: false`; the page loaded normally.
- **Pass, missing-key feedback:** clicking Translate without a key in the standalone popup tab opened provider settings and displayed `Please configure your Gemini API Key below.`
- **Fail, translation trigger:** sending `TRANSLATE_ACTIVE_PAGE` from the extension to the loaded MangaDex tab returned no response and Chrome reported `The message port closed before a response was received.` The popup sends this message, but neither runtime listener handles it. No translation or overlay was observed.
- **Not verified:** three-image translation, scroll/resize/zoom alignment, cold-run timings and log hygiene, cache reuse in Chrome, and failed-provider retry. No working provider key was available in this test run. Malformed-response and renderer-error paths have automated coverage but were not exercised in Chrome.

The missing runtime handler blocked the Sprint 1 happy path at this commit.

## Smoke retest: 2026-10-01

Retested commit `bec9039` after PR #23 merged and closed #22 on September 29. Used Google Chrome for Testing 145.0.7632.6 with a fresh headless profile and the unpacked development build, on the same MangaDex chapter. The extension popup ran as a separate tab for message probes; the normal action-popup UI and reader page-mode setting were not verified.

- **Pass, repository checks:** typecheck, lint, formatting, 157 tests across 13 suites, and production build. A separate development build supplied pipeline diagnostics for the browser probes.
- **Pass, detection and diagnostics:** 13 loaded reader images out of 23 total images. Status and diagnostic responses both counted 13; the service worker responded.
- **Pass, runtime handler:** without a key, Translate returned `success: false` with `Gemini API key is not configured`. With a placeholder key, it returned `success: true, started: true` and emitted translation progress. The missing-response defect from #22 is resolved.
- **Fail, image loading:** the queued images emitted `Translation failed at provider stage` before any request reached the Gemini endpoint. A retry was accepted but also failed; no overlays appeared. Provider responses were set up for interception, but none were consumed because image loading failed first.
- **Confirmed cause:** `GeminiTranslationProvider` assigns `globalThis.fetch` to `this.fetch` and invokes it as a method on the provider object. In the actual content-script isolated world, the equivalent `const obj = { fetch: globalThis.fetch }; await obj.fetch(imageUrl)` failed with `Failed to execute 'fetch' on 'Window': Illegal invocation`. Calling `globalThis.fetch(imageUrl)` on that same blob URL succeeded and read 1,928,497 bytes. Bind the native fetch fallback to its global receiver, or wrap it, while preserving the injected fetch used by tests.
- **Pass, unsupported page:** the extension reported zero supported images on `https://example.com/` and rejected translation with `Current page is not a supported reader chapter`.
- **Blocked:** real provider translation, three-image overlays, alignment, successful retry, cache reuse, and cold-translation timings. No real provider key was used. The zero provider calls in the repeat probe reflect image-load failure, not a cache hit.

This retest identified browser-native fetch binding as the next blocker. The fix verification below supersedes its blocked status.

## Fix verification: 2026-10-01

Tested local changes on top of `bec9039`, using Node 22.15.1 and Google Chrome for Testing 145.0.7632.6. The native fetch fallback is now bound to its global receiver. The runtime provider chain is `ContextAwareProvider → CachedTranslationProvider → GeminiTranslationProvider`, so cache lookup and persistence use the same context-aware identity. Pressing Translate can select a failed image for retry. Gemini's default request deadline is now 60 seconds; provider and request overrides still apply.

Final repository checks passed: typecheck, lint, formatting, 161 tests across 13 suites, production build, and `git diff --check`. Regression coverage exercises the browser fetch receiver, runtime cache persistence/replay, context carried between pages, model-specific cache identity, retry through the normal Translate action, slow successful responses, and timeout overrides.

### Controlled responses on the live reader

Used a fresh headless Chrome profile, a development build, and intercepted Gemini responses with a placeholder key. These checks exercise the extension pipeline, not model translation quality.

- Popup Translate rendered all 13 detected chapter images. The popup and diagnostic both counted 13 images; the service worker responded.
- Authentication failure was visible in the popup. Clicking Translate again after restoring valid responses completed all 13 images.
- Malformed responses reported a normalization-stage error. A forced renderer failure reported a render-stage error. Restoring each stage and clicking Translate again completed all 13 images.
- Thirteen overlays remained image-relative during scrolling, resizing to a 1100 × 850 viewport, and 125% browser zoom. Maximum measured coordinate drift was below 0.002% of the image dimensions.
- Clearing overlays and resetting context/completed state recreated all 13 overlays from cache, with zero additional provider requests.
- The next provider request included recent dialogue. Unsupported-page detection returned zero images and rejected translation without breaking the page.

### Real Gemini output and toolbar popup

Used the production build in a separate visible Chrome profile, with provider credentials configured through Koma's settings. The reference chapter is already in Indonesian, so the cross-language check selected English with `gemini-3.5-flash-lite`. The reader's Long Strip setting was visible in the screenshots.

| Reference | Rendered regions | Successful provider duration | Observed output                                         |
| --------- | ---------------- | ---------------------------- | ------------------------------------------------------- |
| Page 1    | 7                | 6,504 ms                     | English narration, including “Ruoxi is gone.”           |
| Page 2    | 7                | 12,266 ms                    | English narration about Ruoxi returning to Canada       |
| Page 3    | 6                | 11,790 ms                    | English narration, “ONE YEAR LATER...” and “- SUMMER -” |

- All three pages produced normalized results and readable overlays. None of the 20 text elements overflowed their measured containers; the original 13 images remained loaded. Screenshots were visually reviewed. The requests for pages 2 and 3 included recent-dialogue context.
- The initial 30-second deadline caused live timeouts. After increasing it, pages 1 and 2 succeeded; page 3 still timed out once and succeeded on retry. The retry reused pages 1 and 2 from cache and sent one new provider request for page 3.
- Opened the actual Chrome action popup. Provider Settings opened; Show/Hide changed key visibility; Save Settings persisted English; Run Diagnostics reported 13 images and a reachable worker; Reset Context confirmed success. Clicking Translate Current Page then recreated the three English overlays from cache with zero provider requests. This verifies the toolbar-popup trigger in addition to the standalone popup probes.
- Keyboard Tab moved focus from Translate to Diagnostics with a visible native focus indicator. Enter activated Diagnostics and displayed its loading state.
- The live harness blocked or stopped prefetch beyond the three reference images to bound API usage and restored the original target language after testing. Earlier same-language results are not evidence of cross-language translation.

### Remaining verification limits

- These provider durations exclude image loading, queue wait, and rendering. A complete real-provider development-mode timing trace is still needed for total cold latency and log-hygiene verification. The successful samples also exceed the Master PRD's long-term cold-latency target.
- Model coordinates are approximate. Some patches leave original text visible, and page 3's first narration patch is vertically displaced. One source-text field on that page was malformed despite a plausible English translation. This run verifies Indonesian-to-English pipeline behavior, not Japanese/Korean OCR accuracy or scanlation-quality positioning.
- The real-provider cold requests were triggered through extension messages by the browser harness. The actual toolbar-popup replay used cached real results; a fully manual cold-provider demo remains a separate acceptance check.

Browser evidence and screenshots were retained in the local test harness directory, outside the repository. No provider key or reader artwork was added to the repository.
