# KOMA-017 artwork inspection verification

This records what issue #31 (KOMA-017) shipped, how each claim was checked, and where the limits are.

## Scope

- Reveal the untouched artwork under a patch, by hover and by keyboard, without losing the translation.
- Recover text that stays clipped at the font floor: a fallback affordance on the patch plus a readout with the complete translation and any source text.
- Hold placement drift inside the PRD target of 2% of the image dimensions (FR-03).

Out of scope: inpainting, sound-effect typography, and OCR.

## Behavior contract

| Situation                                                              | Result                                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer enters a patch                                                 | The patch hides its own paint (fill, border, shadow, text) so the artwork underneath shows. Pointer and focus stay on the patch.                            |
| Pointer leaves                                                         | The patch restores the exact paint values it had before inspection.                                                                                         |
| `Enter` or `Space` on a focused patch                                  | Toggles the reveal. A keyboard reveal survives pointer movement, so a stray mouse move cannot cancel it.                                                    |
| `Escape` on a patch, or on an open readout                             | Restores the patch, closes the readout, and returns focus to the patch.                                                                                     |
| Fitted text still overflows at the font floor                          | The patch gains a `Show all` chip pinned to its bottom-right corner.                                                                                        |
| Chip activated by pointer or keyboard                                  | Opens one readout with the complete translation and `Original: <source text>` when the provider returned source text. A second readout replaces the first.  |
| Image cannot contain a 72×44px chip or a 220×72px readout with gutters | The control/readout moves to a viewport-clamped portal so the image layer cannot clip it.                                                                   |
| Overlays hidden, re-shown, or removed                                  | No orphan chip, readout, or focus rule remains; images return to their pre-Koma margins, and the reader adapter's own `data-koma-image-id` markers survive. |

The chip is not a descendant of the patch. The patch clips its own overflow (`overflow: hidden`), so a chip inside it would be clipped and unclickable. On normal images, the chip is a layer-level sibling at the patch's bottom-right corner. When the layer is too small to contain a touch target, the chip becomes a viewport-fixed portal near the patch. The readout also uses a viewport-fixed portal when the image layer cannot contain its minimum readable size; otherwise it stays inside the image layer.

## Decisions and reasons

- Hover reveals the artwork instead of dimming it: the reader's job here is to check the model's reading against the drawing, and dimming keeps a second layer between the eye and the artwork.
- Hover and keyboard toggles are tracked separately: one shared flag lets a mouse move cancel a deliberate keyboard reveal.
- The chip hides nothing while inspecting: it is Koma's control, not the artwork, and the fallback has to stay reachable by pointer.
- One readout at a time across all images: two open panels on a long-strip reader hide the pages being compared.
- The readout stays inside the overlay layer when the image can contain it. Tiny images use a viewport-clamped portal because their layer clips any panel large enough to read.
- Tiny-image controls use a viewport-fixed portal with a 72×44px target because a smaller image cannot contain the full label and a touch target.
- Focus rules ship as one `<style>` per layer rather than an inline outline: `:focus-visible` cannot be expressed inline, and an always-on outline would draw a ring on every patch during normal reading.
- The overlay layer is pinned to the image box in pixels: normalized boxes are image-relative, so a layer that follows a wider wrapper resolves every horizontal percentage against the surrounding column instead of the artwork.

## Contrast (WCAG AA)

Computed with `antislop-human/contrast-check.py`, not by eye.

| Pairing                                                                          | Ratio   | Requirement  | Result |
| -------------------------------------------------------------------------------- | ------- | ------------ | ------ |
| Chip label `#111111` on chip fill (white, 0.98)                                  | 18.88:1 | 4.5:1 text   | Pass   |
| Readout translation `#111111` on panel fill (white, 0.99)                        | 18.88:1 | 4.5:1 text   | Pass   |
| Readout `Original:` line (`rgba(17,17,17,0.72)` over white, effective `#5c5c5c`) | 6.69:1  | 4.5:1 text   | Pass   |
| Chip and panel border (`rgba(0,0,0,0.46)` over white, effective `#8a8a8a`)       | 3.45:1  | 3:1 non-text | Pass   |
| Same border over dark artwork (black worst case)                                 | 6.08:1  | 3:1 non-text | Pass   |
| Focus ring `#5b5ee9` on the white patch and panel                                | 4.97:1  | 3:1 non-text | Pass   |

The chip and panel borders were raised from `rgba(0,0,0,0.35)` (2.43:1, failing the 3:1 non-text bar) to `rgba(0,0,0,0.46)` during this verification. The patch border stays at `rgba(0,0,0,0.16)`: a patch is identified by its opaque near-white fill against the artwork, not by its hairline border, and the border is not what makes the control findable.

## Automated verification

- `tests/dom-renderer.test.ts`: 30 tests in the file, 12 of them added for KOMA-017 (hover reveal and exact restore, keyboard toggle and Escape, reveal surviving pointer movement, chip only when the text overflows, chip placement on the layer, readout content with and without source text, single readout, Escape from inside the panel, one focus rule set per layer, cleanup, tiny-image and shallow-edge viewport controls/readout including resize and re-render cleanup, layer pinned to the image box with a fill-the-wrapper fallback, drift measurement).
- On the original KOMA-017 commit (`42fe068`): 258 tests pass. `typecheck`, `lint`, `format:check`, `build`, and `git diff --check` all exit 0.
- Sandboxed reruns of those five modes on `42fe068`: all exit 0.

## Chrome smoke evidence

Headless Chrome for Testing 155.0.8059.39, unpacked production build, synthetic local reader (3 images, 400x600 CSS box inside an 885px column) with a fixture provider response whose first bubble is long enough to overflow its patch. Recorded 2026-10-14.

Interactive controls exercised, in order:

1. Every patch is focusable (`tabIndex` 0, `data-koma-bubble-inspectable`) and only the overflowing bubble gains the fallback chip.
2. Hover hides the patch paint so the artwork shows, and leaving restores the translation.
3. `Space` toggles the reveal and the focused patch keeps a visible 2px focus ring.
4. The chip opens the readout with the complete translation and its original text, clamped inside the image, and takes focus.
5. `Escape` closes the panel, restores the artwork, and returns focus to the patch.
6. At a 320px viewport: no horizontal overflow, drift inside 2%, chip measures 24.0 x 62.6 px (at least 24px tall and 44px wide).
7. At 200% zoom: drift inside 2%.
8. Hide and show: one chip per clipped bubble, no stale readout, one focus rule set per layer.
9. Remove all overlays: zero `data-koma-wrapper`, `data-koma-overlay-layer`, `data-koma-bubble`, `data-koma-clip-indicator`, `data-koma-bubble-readout`, and `data-koma-inspection-styles` nodes; image margins restored; the adapter's `data-koma-image-id` markers intact.

Measured placement drift (patch rect versus the box implied by the normalized coordinates over the image box):

| Viewport           | Max drift | Target |
| ------------------ | --------- | ------ |
| 900x600, 100%      | 0%        | 2%     |
| 320x720            | 0%        | 2%     |
| 900x600, 200% zoom | 0%        | 2%     |

Overlay layer versus image box: 0px difference on all four edges. Provider requests: 3, one per page, with 0 console errors. Screenshots of the hover reveal, the readout, the 320px layout, and 200% zoom were captured during the run and kept outside the repository.

## Placement fix

The smoke run that produced the table above first failed the coverage check, which exposed a defect that predates this issue.

- Symptom: with a 400x600 image in an 885px column, the overlay layer measured 885x600. The wrapper copies the image's `display` value, so a `display: block` image produced a block wrapper that filled the column, and every bubble percentage resolved against 885px instead of 400px. A bubble spanning `x` 20% to 60% landed at 177px to 531px instead of 80px to 240px, about 24% of the image width.
- Impact: visible horizontal misplacement and stretching on any page whose artwork is narrower than its column, including centred and letterboxed images. Earlier smoke runs missed it because their fixture images filled the column width.
- Fix: `syncLayerBounds` pins the layer to the image's rendered box in pixels, relative to the wrapper, and the existing `ResizeObserver` re-syncs it when the image resizes. The wrapper and the page layout are untouched.
- After the fix: layer equals the image box on all four edges, drift 0% at every tested size, and `measureLayoutDrift` now measures against the image box rather than the layer, so a future mis-sized layer cannot report zero drift.

## Limits

- On normal-sized images, the layer-level chip covers the patch's bottom-right corner while the patch is small; the translation text underneath that corner is covered until the readout opens. Images too small to contain a usable control instead get a viewport-fixed chip.
- Clipping is detected by comparing `scrollHeight`/`scrollWidth` against the patch box at the font floor. A patch whose text fits after a re-render loses its chip, which is intended, but a browser that reports no overflow for an absolutely positioned patch would not surface the fallback.
- The smoke uses a synthetic reader page and a fixture provider response. It verifies inspection, fallback, placement, cleanup, and contrast against real Chrome layout, not model bounding-box accuracy on real artwork.
- `measureLayoutDrift` covers the renderer's own placement. Model bounding-box error needs artwork ground truth and is not measured here.

## Review follow-up: tiny image fallback

The review found that a readout inside a layer smaller than 8px could not be opened readably. The fix uses a body-level, viewport-fixed control when the rendered layer is narrower than 72px or shorter than 44px, and moves the complete-text readout to the same portal when there is not enough room for a 220×72px panel with 4px gutters above or below its patch. `ResizeObserver` moves the chip back into the image layer when the artwork grows; rerender and overlay cleanup remove portal controls.

Verification on Headless Chrome for Testing 155.0.8059.39: the synthetic reader image was resized from 400×600px to 4×4px. The chip measured 72×44px, stayed within the viewport, and showed a 2px focus ring. Pressing Enter opened a focused, fixed 220px-wide readout containing the full translation and source text; Escape closed it. Resizing the image back moved the chip into the layer. Cleanup left zero portal nodes and zero console errors. `tests/dom-renderer.test.ts` covers the 4×4px case, keyboard activation, a shallow image near a patch, rerender cleanup, and resize back to the layer. Final repository checks passed: 260 tests, typecheck, lint, format, build, and diff check.
