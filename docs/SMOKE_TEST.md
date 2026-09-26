# Sprint 1 smoke test

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

Live Chrome happy-path, unsupported-site, and failed-request results: **pending manual verification**. Add the recorded evidence to the PR before marking these checks complete.
