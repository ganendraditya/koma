import type { MangaImage } from '@core/contracts';
import type { SiteAdapter } from './index';

const CHAPTER_PATH = /^\/chapter\/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})(?:\/[1-9]\d*)?\/?$/i;
const PAGE_FILE = /^([1-9]\d*)-[a-f\d]{32,}\.(?:png|jpe?g|webp|gif|avif)$/i;
const PAGE_SELECTOR = '.md--reader-pages img.img';

function readerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      ['mangadex.org', 'www.mangadex.org'].includes(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

export class MangaDexAdapter implements SiteAdapter {
  readonly name = 'MangaDex';

  constructor(
    private readonly root: Document = document,
    private readonly getUrl: () => string = () => root.location.href
  ) {}

  matches(url: string): boolean {
    const parsed = readerUrl(url);
    return parsed !== null && CHAPTER_PATH.test(parsed.pathname);
  }

  detectMangaImages(): MangaImage[] {
    const pageUrl = readerUrl(this.getUrl());
    const chapterId = pageUrl?.pathname.match(CHAPTER_PATH)?.[1].toLowerCase();
    if (!pageUrl || !chapterId) return [];

    const images = new Map<number, MangaImage>();
    for (const image of this.root.querySelectorAll<HTMLImageElement>(PAGE_SELECTOR)) {
      const fileName = image.alt.trim();
      const pageNumber = Number(fileName.match(PAGE_FILE)?.[1]);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || !image.complete) continue;

      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width <= 0 || height <= 0) continue;

      const source = image.currentSrc || image.getAttribute('src');
      if (!source) continue;

      let url: URL;
      try {
        url = new URL(source, pageUrl);
      } catch {
        continue;
      }
      if (
        !['https:', 'http:', 'blob:', 'data:'].includes(url.protocol) ||
        (url.protocol === 'blob:' && url.origin !== pageUrl.origin) ||
        (url.protocol === 'data:' && !source.startsWith('data:image/'))
      )
        continue;

      // Filename indices survive virtualized DOM windows and right-to-left spreads.
      const pageIndex = pageNumber - 1;
      if (images.has(pageIndex)) continue;
      images.set(pageIndex, {
        id: `mangadex:${chapterId}:${pageIndex}`,
        url: url.href,
        pageIndex,
        width,
        height,
        aspectRatio: width / height,
        metadata: { site: 'mangadex', chapterId, fileName },
      });
    }
    return [...images.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  }

  observeMangaImages(onChange: (images: MangaImage[]) => void): () => void {
    const view = this.root.defaultView;
    if (!view || !readerUrl(this.getUrl())) {
      onChange([]);
      return () => {};
    }

    let stopped = false;
    let queued = false;
    let previous: string | undefined;
    const publish = () => {
      queued = false;
      if (stopped) return;
      const images = this.detectMangaImages();
      const signature = JSON.stringify(images);
      if (signature !== previous) {
        previous = signature;
        onChange(images);
      }
    };
    const schedule = () => {
      if (queued || stopped) return;
      queued = true;
      queueMicrotask(publish);
    };

    // The reader can mount after document_idle, including navigation from the homepage.
    const observer = new view.MutationObserver(schedule);
    observer.observe(this.root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'alt', 'class'],
    });
    this.root.addEventListener('load', schedule, true);
    this.root.addEventListener('error', schedule, true);
    view.addEventListener('popstate', schedule);
    publish();

    return () => {
      stopped = true;
      observer.disconnect();
      this.root.removeEventListener('load', schedule, true);
      this.root.removeEventListener('error', schedule, true);
      view.removeEventListener('popstate', schedule);
    };
  }
}
