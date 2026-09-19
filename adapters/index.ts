import { MangaImage } from '@core/contracts';

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

  /** Emits an initial snapshot and changed snapshots; returns a cleanup function. */
  observeMangaImages(onChange: (images: MangaImage[]) => void): () => void;
}

export { MangaDexAdapter } from './mangadex';
