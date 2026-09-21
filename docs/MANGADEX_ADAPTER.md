# MangaDex adapter

KOMA-004 supports MangaDex chapter routes (`/chapter/<uuid>` and `/chapter/<uuid>/<page>`).
Title pages, the homepage, chapter editors, and other websites return no images.

## Detection contract

- `MangaDexAdapter.detectMangaImages()` returns a fresh snapshot of loaded reader images.
- Detection uses `.md--reader-pages img.img` and MangaDex's numbered filename in `alt`.
  Logos, avatars, menu thumbnails, advertisements, and unloaded/error placeholders are excluded.
- A filename such as `3-<hash>.png` produces zero-based `pageIndex: 2`. Sorting does not
  depend on DOM position, layout direction, or which pages are currently mounted.
- IDs are `mangadex:<chapter-uuid>:<page-index>`. Blob replacement, data-saver changes,
  repeated scans, and remounting the same page retain the same ID.
- Duplicate nodes for a page produce one result. Removed nodes disappear from the next snapshot.
- `width`, `height`, and `aspectRatio` use intrinsic image dimensions after loading.
- `observeMangaImages(callback)` emits an initial snapshot and changed snapshots after
  DOM mutations, image load/error events, or browser history navigation. Call its returned
  cleanup function when the consumer is disposed.

All DOM selection and site-specific logic live in `adapters/`. Returned `MangaImage`
objects contain no DOM references. The adapter neither fetches chapters nor forces images to load.

MangaDex currently renders blob URLs. These remain in `MangaImage.url`; converting loaded
image bytes for a provider belongs to the translation pipeline. Paged modes mount a window
of pages, so a snapshot counts **loaded, mounted images**, not the chapter's total page count.
Use Long Strip mode and wait for all pages to load when comparing a whole chapter count.

## Developer verification

1. Run `npm run build`, load `dist/` as an unpacked Chrome extension, and reload the reader tab.
2. Open a MangaDex chapter and wait for reader images to load.
3. Open Koma's popup. **Manga Images** shows the adapter count.
4. Click **Run Diagnostics**. **Detected Images** should show the same count.
5. Navigate between pages or chapters and run the diagnostic again. IDs and page indices
   remain chapter-scoped; artwork from unsupported pages is not counted.
6. For automatic console counts, use `npm run dev`, reload the extension and reader tab,
   and enable Debug/Verbose console messages. Look for `[Koma] Detected manga images:`.
   Production builds scan when the popup requests status or diagnostics.

Content scripts are bundled separately as an IIFE inside the Vite build. Chrome executes
manifest content scripts as classic scripts, so they cannot import the popup's ES modules.
The parent watcher tracks the content entry and its dependencies for `npm run dev`.

## QA evidence

Checked MangaDex reader build `v2026.9.17` on 2026-09-19:

- Chapter: <https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c>
- Expected images: 13, from the chapter's public at-home manifest.
- Live Chrome adapter check: 13 detected out of 23 total DOM images; false positives: 0.
- Page indices: 0 through 12; repeated scans returned identical IDs and data.
- Intrinsic dimensions were available for every result.
- Unpacked Chrome extension: status and diagnostic messages both reported 13 images.
- Popup page: **Manga Images** showed `13 detected`; clicking **Run Diagnostics** showed
  `13 images` and a reachable service worker, with no popup page errors.

Automated tests cover route matching, filtering, lazy loads, duplicate/remounted nodes,
source changes, reading order, observer cleanup, SPA navigation, the actual content-script
message handlers, and production/development classic-script packaging.
The HTML fixture is synthetic markup matching the observed reader structure; it contains no manga artwork.
