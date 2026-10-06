# Reading session verification

Verified on 2026-10-06 for [KOMA-012 (#29)](https://github.com/ganendraditya/koma/issues/29) and [KOMA-013 (#28)](https://github.com/ganendraditya/koma/issues/28), against the implementation on top of `addb61c` (`origin/main`).

## Session behavior

The content script owns one orchestrator and provider bridge per reader session. The popup sends normalized Translate, Pause and overlay-visibility commands, receives current session state when opened, and listens for state changes from its active tab.

- Translate/Resume enables work in the current viewport window. Repeating Translate does not retranslate completed or active images.
- Pause aborts the session signal, clears its queue and cooldown timer, and returns interrupted images to idle. Image acquisition and worker-port transport both receive cancellation. Accepted results remain in the orchestrator.
- Cache and recent-dialogue wrappers check the session signal after awaited work and before committing a provider result. An ignored/late response from an aborted session cannot create an overlay, append dialogue or start a cache write.
- Hide removes wrappers and restores the images. Show renders accepted results directly, without entering the provider or context path. Repeating the same visibility command is idempotent. Hiding is independent of enabling translation.
- Saving provider settings disposes pending work and overlays. The next Translate creates a bridge with the new settings revision. Recent dialogue is reset when target language or chapter changes; provider/model changes in the same language retain dialogue.
- Chapter navigation disposes the session, removes observers and clears dialogue/overlays. Chrome's Navigation API handles SPA chapter changes before DOM replacement; adapter changes and `popstate` also detect navigation. `pagehide` disposes pending work, and a later Translate starts a fresh session.

## Scheduling and cooldown policy

- Production image observations, scroll, resize and foreground events recalculate the window. Events are coalesced over 50 ms.
- The window starts at the detected image nearest the viewport and contains at most two following loaded images by default. Completion drains that window's queue; it never advances the window itself.
- A viewport jump rebuilds queue priorities and removes obsolete queued pages. Already-active work may complete. Visible work has priority zero, followed by upcoming pages in reading order. Production concurrency is one so dialogue context remains sequential.
- Paused and hidden readers dispatch no work. Foreground and Resume recalculate the window rather than draining an old queue.
- The existing `ContextAwareProvider → CachedTranslationProvider → ExtensionTranslationProvider` chain handles cache identity and lookup before inference. The scheduler does not calculate a separate cache key.
- On HTTP 429, valid `Retry-After` seconds or HTTP-date metadata survives provider normalization and worker serialization. The scheduler waits at least that duration, with a one-second minimum for expired/zero values. Longer server deadlines are honored.
- Missing or malformed metadata uses a 30-second fallback. The configurable fallback is bounded to 1–60 seconds. One timer holds dispatch, and Pause/disposal clears it.
- A failed image is never retried automatically. After cooldown, only other eligible queued images continue. Authentication and invalid-output failures also remain visible until a reader retry. Repeated failures can exhaust the small window but cannot create a paid retry loop.

## Automated verification

All required checks passed on Node 22.15.1:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`: 227 tests across 20 files
- `npm run build`
- `git diff --check`

New regression suites:

| Suite                               | Verified behavior                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/reading-session.test.ts`     | A 12-page chapter stops at the three-page window, repeated Translate, delayed Pause rejection before cache/context/render, replay without inference/dialogue duplication, distant queue replacement, hidden readers, explicit failure retry, `Retry-After` timing and bounded fallback cooldown without retry loops.                              |
| `tests/reading-runtime.test.ts`     | Actual popup initialization and controls route through content messages, image acquisition, worker ports, provider normalization, persistent storage and DOM rendering. Delayed responses are released after Pause, settings replacement, normal/SPA navigation and teardown; production scroll/image/visibility observers drive subsequent work. |
| `tests/rate-limit-metadata.test.ts` | Gemini and OpenAI preserve seconds, future/expired HTTP dates and missing/invalid header behavior in normalized errors.                                                                                                                                                                                                                           |

Existing provider, renderer, context, cache, packaging and diagnostics regressions also passed. Signal-aware calls and cache-rebound page IDs are reflected in existing expectations.

## Unpacked Chrome evidence

Chrome for Testing **145.0.7632.6** ran the production bundle in a fresh visible profile. A controlled MangaDex-shaped Long Strip reader contained 12 loaded images. A loopback OpenAI-compatible endpoint returned deterministic translations, delayed responses and 429 errors. The actual toolbar popup was opened through `chrome.action.openPopup()` and operated with CDP mouse/keyboard input.

The QA manifest added only a loopback host grant to permit the controlled endpoint. Executable application bundles were copied from `dist/`. The browser was launched without Playwright focus emulation so tab visibility used Chrome's actual `document.hidden` state. No paid provider or real credential was used; these results verify runtime behavior rather than translation quality.

Request counts below are cumulative within one run. Overlay counts count one controlled bubble per successful image.

| Action                                                                       | Observed result                                                                                   | Provider requests |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------: |
| Translate once with 12 loaded images                                         | Three overlays, then no further dispatch while the viewport stays put.                            |                 3 |
| Hide/Show three times                                                        | Zero wrappers while hidden, exactly three wrappers/bubbles after each restore.                    |                 3 |
| Pause/Resume after the window completes                                      | Accepted results retained; no duplicate requests.                                                 |                 3 |
| New chapter, hold the first response, Pause, release late response           | Underlying network aborted; zero overlays and no additional cache entries.                        |                 4 |
| Resume that chapter                                                          | Three pages complete through a renewed session signal.                                            |                 7 |
| Scroll to page 4; return 429 with `Retry-After: 2`                           | Request count stays fixed before cooldown; only the other two eligible pages continue afterwards. |                10 |
| Retry Visible Page                                                           | Failed page succeeds on explicit reader action, for six accepted pages total.                     |                11 |
| Hide tab and scroll to page 7                                                | No provider dispatch while hidden.                                                                |                11 |
| Foreground reader                                                            | Current visible-plus-two window completes.                                                        |                14 |
| Jump to page 10                                                              | New three-page window completes, then dispatch stops.                                             |                17 |
| Append pages 13/14 outside the window                                        | No new request from image loading alone outside the current window.                               |                17 |
| Scroll to page 12                                                            | Existing page reused; the two newly eligible pages complete.                                      |                19 |
| New chapter, hold response, save another model                               | Second network abort; late release creates no overlay/cache entry.                                |                20 |
| Reset Context                                                                | Success feedback, zero overlays.                                                                  |                20 |
| New chapter, hold response, SPA `history.pushState()` before DOM replacement | Navigation immediately aborts transport; late release creates no overlay/cache entry.             |                21 |

No uncaught page/popup errors were recorded.

### Popup click-through and accessibility

| Element/check                                          | Evidence                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translate without configuration                        | Opens settings and displays configuration feedback; no request sent.                                                                                                                            |
| Provider selector, base URL, model and target language | Compatible-endpoint fields appear; saved values configure the worker's controlled requests.                                                                                                     |
| Save Settings                                          | Success feedback; changed model cancels the active reader request.                                                                                                                              |
| Provider Settings                                      | Expands/collapses with synchronized `aria-expanded`.                                                                                                                                            |
| Translate/Resume                                       | Starts the bounded pipeline or continues paused work; current state is reported.                                                                                                                |
| Pause                                                  | Cancels the held network request and exposes Resume.                                                                                                                                            |
| Hide/Show Overlays                                     | Restores accepted DOM results repeatedly with a fixed request counter.                                                                                                                          |
| Run Diagnostics                                        | Reports 12 reader images and a reachable worker.                                                                                                                                                |
| Reset Context                                          | Displays success and clears the session's overlays.                                                                                                                                             |
| Keyboard                                               | Tab moves from Translate to Pause, with a computed 2 px focus outline. Native buttons remain Enter/Space operable.                                                                              |
| Toolbar size                                           | 320 px viewport and document width; all four action buttons measured 44 px high. A minimum document width prevents Chrome's initial popup sizing from collapsing to 32 px.                      |
| 200% CSS/text scaling                                  | Popup grew to 680 px and document width remained 680 px, without horizontal overflow.                                                                                                           |
| Contrast                                               | Checker measured white on primary accent at 4.97:1, secondary text on page background at 7.58:1, primary text on secondary button at 13.98:1 and focus indicator on secondary button at 7.34:1. |

Screenshots, browser probe and request evidence are retained locally in the approved temporary `opencode/koma-reading-qa/` directory. Reader artwork and browser profiles are outside the repository.

## Antislop delivery gate

Direction: extend the existing Koma reader popup, with its compact dark surfaces and primary translation accent. Dials: **ENERGY 1 / RHYTHM 1 / MOTION 1**. Reader actions use predictable vertical order; diagnostics and provider settings follow the reading controls. The system font keeps controls legible alongside manga. Full-width 44 px targets support keyboard and pointer use; spacing groups actions with current-state feedback. Plain action labels carry meaning without new illustrative assets. Dark surfaces keep the temporary toolbar panel subdued against reader artwork.

The gate below covers the session-control additions and their integration with the existing popup.

| Gate item           | Status and evidence                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R-02, copy          | PASS: session labels, messages and this report use plain punctuation.                                                                      |
| R-03, reflow        | PASS: actual toolbar width matches document width; 200% scaling has no horizontal overflow.                                                |
| R-17, numbers       | PASS: accepted counts come from session results; QA counts are measured endpoint requests.                                                 |
| R-18, testimonials  | PASS: reader controls contain no testimonials or people.                                                                                   |
| R-23, assets        | PASS: session controls use text within the established popup design.                                                                       |
| R-24, navigation    | PASS: controls issue real reader commands; no destination links are added.                                                                 |
| R-25, contrast      | PASS: measured text and focus ratios are recorded above.                                                                                   |
| R-26, behavior      | PASS: Translate, Resume, Pause and Hide/Show execute through real runtime handlers.                                                        |
| R-27, states        | PASS: initial/empty, active, paused, completed and failed states have visible text; tests exercise errors and delayed work.                |
| R-28, FAQ           | PASS: no FAQ is needed in the reader control surface.                                                                                      |
| R-32, keyboard      | PASS: native buttons, logical order and measured visible focus.                                                                            |
| R-33, source edits  | PASS: popup behavior and styles are implemented directly in their source files.                                                            |
| R-34, themes        | PASS: the shipped popup's existing dark treatment renders the new controls.                                                                |
| R-35, running UI    | PASS: production build, actual toolbar click-through and zero recorded uncaught errors.                                                    |
| R-36, claims        | PASS: recorded results identify the controlled reader/provider and measured outcomes.                                                      |
| R-37, direction     | PASS: controls follow Koma's existing popup palette, typography and composition.                                                           |
| R-38, content       | PASS: labels name implemented actions; state and counts come from the active reader.                                                       |
| R-01, color         | PASS: established translation accent marks the primary action; secondary controls use existing neutral surfaces.                           |
| R-04, icons         | PASS: action labels are text; no new generic glyphs are needed.                                                                            |
| R-06, typography    | PASS: existing system font supports compact, readable reader controls.                                                                     |
| R-07, background    | PASS: solid existing surfaces keep artwork and state text legible.                                                                         |
| R-08, arrows        | PASS: reader commands have direct labels.                                                                                                  |
| R-09, badges        | PASS: actual state is textual feedback rather than decorative badges.                                                                      |
| R-10, glass         | PASS: controls use solid surfaces.                                                                                                         |
| R-12, shadow        | PASS: actions sit in the popup's existing flow without floating panels.                                                                    |
| R-13, glow          | PASS: visible outline provides focus feedback.                                                                                             |
| R-14, cards         | PASS: action order follows the reader workflow without a feature-card grid.                                                                |
| R-19, motion        | PASS: state changes and existing hover feedback suit MOTION 1.                                                                             |
| R-22, illustrations | PASS: action labels communicate the workflow without illustrations.                                                                        |
| Liveliness          | PASS: explicit 1/1/1 dials, primary Translate focal point, grouped action spacing, one primary accent and a repeated reader-command voice. |
| C-1, intent         | PASS: color, order, font, targets and spacing have reasons recorded above.                                                                 |
| C-2, function       | PASS: changed controls are exercised through popup, reader and worker.                                                                     |
| C-3, composition    | PASS: each added action controls the reading session or overlay state.                                                                     |
| C-4, resilience     | PASS: empty/error/paused states, narrow toolbar, scaling and keyboard checks.                                                              |
| C-5, evidence       | PASS: automated suites and controlled-Chrome observations support the report.                                                              |
| R-05, structure     | PASS: compact reading controls rather than a landing-page/dashboard template.                                                              |
| R-11, radius        | PASS: secondary buttons retain the popup's existing button shape.                                                                          |
| R-15, CTAs          | PASS: Translate, Resume, Pause, Hide Overlays and Show Overlays identify their actions.                                                    |
| R-16, wording       | PASS: session text describes actual reader work and recovery.                                                                              |
| R-20, identity      | PASS: commands and state feedback are specific to manga translation and overlay replay.                                                    |
| R-21, dark mode     | PASS: established subdued reader popup treatment supports the controls.                                                                    |
| R-29, palette       | PASS: existing neutral surfaces, primary action accent and semantic state colors.                                                          |
| R-30, originality   | PASS: composition follows the existing Koma control surface.                                                                               |
| R-31, reasons       | PASS: major decisions are documented before the gate table.                                                                                |
