# In-reader translation status

KOMA-020, [issue #37](https://github.com/ganendraditya/koma/issues/37). Verified on 2026-10-06 on top of PR #36's `4b441f5` implementation.

## Requirement check

The reader previously had no progress/error indicator of its own. Content callbacks sent progress to the extension popup; accepted translations were the first visible result on the reader.

Live Docmost pages inspected using `docmost-cli page get`:

- [Sprint 1 cards](https://docs.gantenx.web.id/s/koma/p/W8ge8QxKB7): KOMA-007 maps to the delivered stateful orchestrator.
- [Pipeline documentation](https://docs.gantenx.web.id/s/koma/p/d1ZaXmV4l9): describes state callbacks, error normalization and popup/content integration.
- [Sprint 2 PRD](https://docs.gantenx.web.id/s/koma/p/ii3R16LI9m): S2-FR-01/S2-FR-02 cover session state and bounded cooldown, but its backlog has no dedicated on-reader feedback card.

The official Sprint 1 PRD, KOMA-007, already requires visible loading, a non-blocking error state and retry (`docs/notion/SPRINT_1_PRD.md`). The Master PRD's section 22 requires a lightweight retry indicator and preserved original artwork (`docs/notion/MASTER_PRD.md`). Issue #37 tracks the missing reader-side delivery of this feedback, using those requirements.

## Implementation

`extension/content/reader-status.ts` renders a single, content-owned Shadow DOM panel, styled by `reader-status.css`. It consumes normalized `ReadingSessionState`; its buttons invoke the existing content command handler. It contains no provider logic, scheduling policy or cache-key calculation.

- Starting a supported-reader command immediately shows preparation while provider configuration is loaded.
- Session events update translating, queued, paused, waiting-for-images, accepted-page and failure feedback. Counts are actual accepted/active/queued counts; they are not chapter percentages. “Pages ready” means accepted results, not a claim that the chapter is finished.
- Rate limits show the remaining server/scheduler deadline, disable premature retry and keep Pause available. The display timer only updates text; it never dispatches a provider request. Failed pages still require explicit reader retry.
- Hide Status or Escape collapses the panel to a live status button. Expanding restores the same panel, moves focus to Hide Status and starts no translation work. Status changes are announced politely; countdown ticks sit outside the live region and unchanged compact labels are not rewritten.
- The panel is independent of bubble visibility. Hidden overlays are named in its feedback; the status itself remains visible while work continues.
- Settings replacement, context reset, chapter navigation and teardown remove the panel and cancel its display timer. Delayed configuration failures and cancelled provider responses cannot resurrect old feedback.
- The fixed host has isolated placement styles; Shadow DOM separates the panel's styles from reader styles. Original images are not replaced or hidden. Width follows the available viewport, safe-area placement stays at the corner, and long content can scroll vertically within the available height.

## Automated evidence

The new runtime regressions use real popup initialization, content handlers, worker ports, normalized provider responses, cache/context wrappers and DOM rendering. Only Chrome bindings and provider transport are controlled.

`tests/reading-runtime.test.ts` verifies preparation, activity/counts, collapse/focus, reader Pause transport abort, late-response rejection, reader Resume, completion, empty-reader image observation, rate-limit countdown/early-retry blocking, explicit retry, authentication recovery, overlay visibility feedback, disposal during cooldown and stale configuration failure after teardown. Existing settings/navigation/pagehide regressions now assert reader-status removal too.

`tests/adapter-content.test.ts` verifies on-reader configuration failure and absence of injected UI on unsupported pages.

Required checks passed: typecheck, lint, formatting, **233 tests across 20 files**, production build and `git diff --check`.

The CI pull-request trigger now includes dependent-branch targets, so this stacked PR receives the same checks before PR #36 merges.

## Unpacked Chrome evidence

Chrome for Testing **145.0.7632.6** loaded the production bundle. The controlled MangaDex-shaped reader and loopback compatible provider follow the [reading-session QA setup](READING_SESSION_VERIFICATION.md#unpacked-chrome-evidence): placeholder configuration, deterministic bubble output and controlled delayed/429/401 responses. The QA manifest alone grants loopback access. This verifies extension behavior, not live model quality.

The original session/prefetch checks passed again. The new status scenarios explicitly closed the actual toolbar popup before operating the reader UI. Request counts below are cumulative in the same run.

| Interaction                                                             | Observed result                                                                                                                                                | Requests |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: |
| Reader command with missing configuration, then Retry Translation       | Provider Settings guidance remains visible; retry returns the same actionable failure without inference.                                                       |        0 |
| Start a held request, close popup                                       | “Translating pages” with 0 ready, 1 active and 2 queued remains visible.                                                                                       |       22 |
| Hide Status, expand, keyboard Tab/Enter on Pause                        | Collapsed button names actual activity; expansion works; a 2 px outline marks Pause; transport aborts. Late release leaves the reader paused with no overlays. |       22 |
| Reader Resume                                                           | Three accepted pages appear and feedback becomes “Pages ready”.                                                                                                |       25 |
| Escape and expand again                                                 | Compact button reports completion; no additional provider call.                                                                                                |       25 |
| Scroll, controlled 429 with `Retry-After: 2`                            | Remaining wait is visible, Retry Visible Page is disabled, and no early dispatch occurs. The other eligible pages finish after cooldown.                       |       28 |
| Reader Retry Visible Page                                               | Failed page succeeds only after this action.                                                                                                                   |       29 |
| Scroll, controlled 401                                                  | API-key guidance appears while successfully translated pages remain usable.                                                                                    |       32 |
| Reader Retry Visible Page                                               | Recovery updates counts and accepted-page feedback.                                                                                                            |       33 |
| 320 px viewport, then 200% text with another controlled failure         | Panel spans x=12–308, width 296 px, with no horizontal overflow. Scaled error panel is 602 px tall, fits y=106–708, and retry is reachable.                    |       36 |
| Pause during another cooldown, then Resume                              | Secondary Pause works, no request starts while paused, and Resume respects the remaining deadline before the explicit retry completes.                         |       38 |
| Host stylesheet tries to hide buttons/sections and change div placement | Reader controls remain visible; host remains fixed; panel retains `rgb(9, 13, 22)` background.                                                                 |       38 |
| SPA chapter navigation                                                  | Panel is removed immediately.                                                                                                                                  |       38 |

At 320 px, visible action targets were at least 44 px high and 101 px wide. At 200% text they were 60 px high. The controlled reader's document width remained 320 px in both checks. No uncaught page/popup errors were recorded.

Probe, screenshots and machine-readable results are retained locally in the approved temporary `opencode/koma-reading-qa/` directory as `verify-status.mjs`, `reader-status-*.png` and `evidence-status.json`.

## Antislop delivery gate

Design read: an in-reader translation status surface for manga readers, extending the existing Koma popup's dark surfaces, system typography and single translation accent. **ENERGY 1 / RHYTHM 1 / MOTION 1**.

The artwork remains the focal point. A compact corner panel groups state, recovery instructions and real counts; its full-width action is the focal point within the panel. One primary accent identifies the available reader action. Neutral surfaces maintain legibility against light/dark artwork, 8/12 px spacing groups related text, and native buttons with a 2 px focus ring support keyboard use. Text labels carry meaning without icons, illustrations or animation. Collapse reduces the footprint while preserving actual activity.

| Item       | Status and evidence                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01       | PASS: inherited translation accent only on the main reader action; solid neutral surfaces.                                                               |
| R-02       | PASS: new UI copy and documentation use plain punctuation.                                                                                               |
| R-03       | PASS: 320 px and 200% checks show no horizontal overflow; long content has a viewport-bounded vertical scroll path.                                      |
| R-04       | PASS: action/state labels communicate directly, with no new decorative icons.                                                                            |
| R-05       | PASS: composition follows state, explanation, actual counts and recovery.                                                                                |
| R-06       | PASS: system font matches Koma controls and reflows with text size.                                                                                      |
| R-07       | PASS: solid surface separates feedback from variable manga artwork.                                                                                      |
| R-08       | PASS: direct action labels without decorative arrows.                                                                                                    |
| R-09       | PASS: the compact label reports real activity, not a promotional badge.                                                                                  |
| R-10       | PASS: solid surfaces with no backdrop blur.                                                                                                              |
| R-11       | PASS: existing 8 px panel/6 px button geometry, no pill treatment.                                                                                       |
| R-12       | PASS: fixed placement and one border establish the surface without repeated shadows.                                                                     |
| R-13       | PASS: a visible outline marks focus, with no glow.                                                                                                       |
| R-14       | PASS: one functional status surface, no feature-card grid.                                                                                               |
| R-15       | PASS: Pause, Resume, Retry Visible Page, Hide Status and Show Status name real commands.                                                                 |
| R-16       | PASS: text describes current reading work and recovery.                                                                                                  |
| R-17       | PASS: counts/deadline come from the session; browser counts come from the controlled endpoint.                                                           |
| R-18       | PASS: no testimonial/person content.                                                                                                                     |
| R-19       | PASS: MOTION 1, hover/active feedback and no looping animation.                                                                                          |
| R-20       | PASS: accepted pages, viewport work, overlay visibility and reader retries define this surface.                                                          |
| R-21       | PASS: inherited subdued reader-control theme stays legible against both light and dark artwork.                                                          |
| R-22       | PASS: real state text needs no illustration.                                                                                                             |
| R-23       | PASS: reuses existing Koma colors/fonts; no new logo, avatar or invented data asset.                                                                     |
| R-24       | PASS: real commands, no destination links.                                                                                                               |
| R-25       | PASS: contrast checker measured primary text/accent at 4.75:1, secondary text/page at 7.58:1, disabled text/button at 6.69:1 and focus/button at 8.61:1. |
| R-26       | PASS: recorded Hide/Show Status, Pause/Resume and explicit retry click-through.                                                                          |
| R-27       | PASS: waiting, preparation, active, paused, completed, cooldown and error states covered by runtime tests.                                               |
| R-28       | PASS: no FAQ in this reader surface.                                                                                                                     |
| R-29       | PASS: inherited neutrals and one primary action accent.                                                                                                  |
| R-30       | PASS: composition extends the existing Koma control style.                                                                                               |
| R-31       | PASS: color, layout, font, spacing, controls and collapse reasons recorded above.                                                                        |
| R-32       | PASS: Chrome keyboard Tab/Enter activates Pause with a 2 px focus outline; Escape collapses and expand works.                                            |
| R-33       | PASS: TypeScript and CSS implemented directly in source files.                                                                                           |
| R-34       | PASS: isolated fixed control theme survives hostile host styles.                                                                                         |
| R-35       | PASS: production bundle, actual popup closed, recorded reader click-through and zero uncaught errors.                                                    |
| R-36       | PASS: requirements, environment and measured outcomes have explicit sources.                                                                             |
| R-37       | PASS: design read and 1/1/1 dials declared before implementation.                                                                                        |
| R-38       | PASS: user-facing state describes implemented commands and actual session data.                                                                          |
| Liveliness | PASS: explicit dials, artwork-first hierarchy, structured spacing, one action accent and repeated reader-command language.                               |
| C-1        | PASS: visual/copy choices have written reasons.                                                                                                          |
| C-2        | PASS: all reader buttons execute through the existing command path or collapse/expand.                                                                   |
| C-3        | PASS: content exists to report translation and recover from failures.                                                                                    |
| C-4        | PASS: empty/error/paused/loading states, keyboard, narrow width, zoom and isolated styling verified.                                                     |
| C-5        | PASS: no invented metrics or quality claims; controlled-provider evidence identified.                                                                    |
