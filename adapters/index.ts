import { MangaImage, ReadingIdentity } from '@core/contracts';

/**
 * Interface for website-specific manga readers and image extractors (e.g. MangaDex).
 */
export interface SiteAdapter {
  /**
   * Human-readable name of the adapter.
   */
  readonly name: string;

  /**
   * Determines whether this adapter handles the given URL.
   */
  matches(url: string): boolean;

  /**
   * Scrapes or observes manga images from the reader DOM.
   */
  detectMangaImages(): MangaImage[];

  /** Returns stable series/chapter identity when the reader exposes it. */
  getReadingIdentity?(url?: string): ReadingIdentity | null;

  /** Emits an initial identity and each later identity change. */
  observeReadingIdentity?(onChange: (identity: ReadingIdentity | null) => void): () => void;

  /**
   * Resolves the DOM element corresponding to a detected manga image.
   */
  getImageElement?(image: MangaImage): Element | null;

  /** Emits an initial snapshot and changed snapshots; returns a cleanup function. */
  observeMangaImages(onChange: (images: MangaImage[]) => void): () => void;
}

export { MangaDexAdapter } from './mangadex';
