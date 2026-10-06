# BYOK provider verification

Verified on 2026-10-02 for [issue #25](https://github.com/ganendraditya/koma/issues/25).

## Automated checks

- `npm run test`: 190 tests passed across 17 files, using Node 22.23.3.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`: passed.
- `git diff --check`: passed.

The provider tests exercise Responses and Chat Completions, split SSE events, final-output extraction, image/context payloads, authentication, rate limits, stalled-body deadlines, malformed JSON, refusal, and truncation. Runtime tests connect the real content provider and worker handler through test ports, checking credential ownership, cancellation of the underlying fetch, stale settings, keepalive cleanup, cache isolation, and rejection of reader-supplied URLs. Settings tests cover Gemini migration, per-provider keys, and session/remembered storage. Popup tests cover provider drafts, reasoning restrictions, save feedback, denied host permission, and expansion state.

OpenAI effort values were checked against the current [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) and model pages. The capability table distinguishes GPT-6 Sol, which supports Off, from GPT-6.1 Sol and GPT-6 Astra, which do not. GPT-5.6 supports Maximum. Unrecognized variants use the provider default in Auto mode.

## Unpacked Chrome checks

Chrome for Testing 145.0.7632.6 ran a copy of the production bundle with a fresh profile. A controlled MangaDex-shaped reader contained one image. A local HTTP server returned deterministic translations, streaming reasoning fields, and error responses. The native OpenAI request was intercepted at the worker's network boundary. All credentials were placeholders.

The QA manifest pregranted the loopback host because headless Chrome cannot accept the native optional-permission dialog. Executable bundles were copied unchanged. Real permission-dialog acceptance remains a manual check; denied/granted outcomes and requested host scope are covered by the popup tests. This run verifies extension transport and rendering, not live-provider OCR or translation quality.

| Control or scenario                     | Observed result                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Translate without a configured provider | Opens settings and explains that configuration must be saved.                                                                                          |
| Provider Settings toggle                | Opens/closes the panel and updates `aria-expanded`.                                                                                                    |
| Provider selector                       | Shows the appropriate key, endpoint, model, and reasoning fields. Saved compatible selection survives reopening.                                       |
| API key input, Show, Hide               | Accepts the placeholder; Show reveals it and Hide restores masking.                                                                                    |
| Remember key                            | Checked moves the placeholder to local storage; unchecked moves it to session storage. Session key survives popup reload.                              |
| API base URL                            | Preserves `/api/v1`; invalid input produces save feedback.                                                                                             |
| API format                              | Chat Completions reaches `/api/v1/chat/completions`; Responses reaches `/api/v1/responses`.                                                            |
| JSON output                             | JSON object and Strict JSON schema appear in outgoing payloads; Prompt only is selectable.                                                             |
| Target Language                         | English survives popup reload.                                                                                                                         |
| Vision model ID                         | Custom model IDs reach the endpoint; the native request uses `gpt-5-mini`.                                                                             |
| Reasoning effort                        | Compatible Low sends `reasoning_effort`; compatible Auto omits it. Native Auto sends `{ effort: "low" }`.                                              |
| Save Settings                           | Shows saving/success feedback and persists the selected profile.                                                                                       |
| Run Diagnostics                         | Reports one detected image and a reachable worker.                                                                                                     |
| Translate Current Page                  | Produces one normalized overlay containing the controlled translation.                                                                                 |
| Reset Context                           | Shows success; translating again replays the cache with zero extra provider requests.                                                                  |
| Slow response                           | Completes after 36 seconds, exceeding Chrome's usual 30-second worker-idle interval. The Koma worker was not attached to a debugger during this check. |
| Provider/API switching                  | Produces fresh requests while preserving recent dialogue in the next payload.                                                                          |
| Native Responses                        | Sends an image, strict schema, `store: false`, Low effort, and no `temperature`; the normalized result renders.                                        |
| Authentication error                    | Shows a key-check error without echoed response credentials.                                                                                           |
| Malformed response                      | Reports normalization failure; the reader remains usable.                                                                                              |
| Truncated response                      | Reports incomplete output, even when the returned content is valid JSON.                                                                               |
| Retry                                   | The next Translate action succeeds after the controlled failures.                                                                                      |
| Reasoning output                        | Reasoning fields never appear in the reader's text.                                                                                                    |
| Keyboard                                | Tab moves from model ID to reasoning effort with a visible outline.                                                                                    |
| Narrow layout                           | At 320 CSS pixels, document and body scroll widths remain 320.                                                                                         |
| Zoom                                    | Chrome reports 200% zoom with no measured horizontal overflow.                                                                                         |
| Runtime/logs                            | No uncaught reader/popup exceptions; placeholder credentials absent from captured Koma logs.                                                           |

### Repeat the browser checks

1. Build and load `dist/` as an unpacked extension in Chrome.
2. Open a supported chapter and configure an image-capable OpenAI model or a controlled compatible endpoint.
3. For a custom host, accept its permission prompt and verify Save Settings succeeds. Repeat with a fresh host and deny permission; the saved provider should remain unchanged.
4. Exercise each control above, using a test endpoint to return delayed, malformed, truncated, and authentication-error responses.
5. Reset context and translate the same image to check cache replay. Change endpoint/API/reasoning settings to confirm a fresh request.
6. Check reader/popup consoles, keyboard focus, a narrow viewport, and 200% zoom.

## Antislop delivery gate: PASS

Direction: extend Koma's existing compact dark popup, as requested. Reading this as a manga-reader control surface with ENERGY 1 / RHYTHM 1 / MOTION 1. The translation action remains the focal point; provider settings use the existing control vocabulary.

### Hard gate

- R-02 PASS: popup text and new provider documentation contain no em dashes.
- R-03 PASS: 320-pixel checks show no horizontal overflow; controls and the checkbox label have 44-pixel minimum hit areas.
- R-17 PASS: counts come from adapter diagnostics; test totals and timings come from recorded executions.
- R-18 PASS: the popup contains no testimonials or invented people.
- R-23 PASS: the existing wordmark/version treatment is retained; QA content is explicitly labelled controlled.
- R-24 PASS: the popup contains no navigation links to missing destinations.
- R-25 PASS: contrast calculations give 6.69:1 for secondary text on the card, 4.97:1 for primary-button text, and 4.56:1 for error text.
- R-26 PASS: every button and field has recorded behavior in the table above.
- R-27 PASS: missing configuration, saving/translating, and validation/provider failure states were exercised.
- R-28 PASS: the popup contains no FAQ.
- R-32 PASS: native controls follow DOM order; Tab reaches reasoning with a visible 2-pixel outline.
- R-33 PASS: UI changes are direct edits to popup source.
- R-34 PASS: the existing fixed theme is retained; no theme toggle is shipped.
- R-35 PASS: production build and unpacked-Chrome click-through completed; native permission-dialog limits are recorded above.
- R-36 PASS: verification claims are limited to observed checks; live-provider quality is not claimed.
- R-37 PASS: the user-supplied direction is to extend the existing popup style.
- R-38 PASS: provider descriptions match implemented behavior; synthetic QA output is labelled controlled.

### Purpose gate

- R-01 PASS: the existing indigo accent identifies the primary translation action; the slightly darker value meets text contrast.
- R-04 PASS: no feature-icon library or decorative AI glyphs were added.
- R-06 PASS: system fonts preserve the existing compact popup; monospace remains confined to diagnostics.
- R-07 PASS: solid surfaces retain the existing popup identity; no background pattern was added.
- R-08 PASS: the settings chevron communicates expansion; buttons have action labels without decorative arrows.
- R-09 PASS: version and key-status labels show actual extension/configuration state.
- R-10 PASS: no glass or backdrop blur is used.
- R-12 PASS: controls sit on flat surfaces without floating shadows.
- R-13 PASS: focus uses an outline; there are no glow effects.
- R-14 PASS: status and settings sections organize actual reader/configuration data.
- R-19 PASS: motion is limited to existing hover transitions.
- R-22 PASS: no illustrations were added.

### Liveliness

- Dials PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 are explicit.
- Consistency PASS: the compact single-column form and hover-only motion follow those dials.
- Focal point PASS: Translate Current Page is the sole filled accent button.
- Whitespace PASS: section gaps separate reader status, actions, diagnostics, and settings; related fields remain grouped.
- Accent PASS: indigo emphasizes the primary action; semantic colors communicate actual success/error state.
- Identity PASS: the existing Koma wordmark, dark surfaces, status rows, and inset settings panel recur consistently.
- Design read PASS: the requested existing-popup direction supplies the control-surface design read above.

### Craftsmanship and quality locks

- C-1 PASS: visual decisions preserve the requested popup direction and distinguish action, status, and configuration.
- C-2 PASS: the control-by-control table records actual behavior.
- C-3 PASS: every section serves translation, diagnostics, or provider configuration.
- C-4 PASS: empty/loading/error, keyboard, narrow layout, and zoom checks completed.
- C-5 PASS: counts, timings, and success claims have test/browser evidence.
- R-05 PASS: composition follows the reader-control workflow, not a landing-page template.
- R-11 PASS: existing 8-pixel cards, 6-pixel buttons, and 5-pixel fields retain component hierarchy.
- R-15 PASS: Translate Current Page, Save Settings, Run Diagnostics, and Reset Context name their actions.
- R-16 PASS: copy describes endpoint, image support, reasoning, and storage behavior directly.
- R-20 PASS: the existing Koma control-surface identity is extended consistently.
- R-21 PASS: the fixed dark theme follows the user's existing-style direction.
- R-29 PASS: neutral dark surfaces use one action accent; success/warning/error colors carry semantic state.
- R-30 PASS: no external product layout or styling was copied.
- R-31 PASS: color marks hierarchy, the single-column layout fits extension width, system type keeps settings readable, and spacing groups related fields.

Additional contrast checks: secondary text ranges from 4.79:1 on hover surfaces to 7.58:1 on the popup background. Input/button boundaries meet 3:1 in normal and hover states. The focus outline is 8.96:1 against the input background. Disabled controls use Chrome's standard disabled-state contrast exemption.
