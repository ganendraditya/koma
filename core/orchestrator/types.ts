import { MangaImage, TranslationResult } from '@core/contracts';
import type { TranslationCache } from '../cache';
import type { ImagePosition, ViewportRect } from './viewport';

export type TranslationStatus = 'idle' | 'translating' | 'completed' | 'failed';

export interface ImageTranslationState {
  imageId: string;
  status: TranslationStatus;
  result?: TranslationResult;
  error?: Error;
}

export interface OrchestratorOptions {
  /** Maximum number of concurrent translations */
  concurrencyLimit?: number;
  /** Target language ISO code (e.g. 'id', 'en') */
  targetLanguage?: string;
  /** Number of upcoming images to prefetch in look-ahead (default: 2) */
  lookAheadCount?: number;
  /** Whether look-ahead prefetching is enabled initially (default: true) */
  prefetchEnabled?: boolean;
  /** Translation cache instance to check before queuing provider work */
  cache?: TranslationCache;
  /** Custom element or bounding box resolver for manga images */
  positionResolver?: (image: MangaImage) => ImagePosition | null;
  /** Custom viewport provider */
  viewportProvider?: () => ViewportRect;
}

export interface IRenderer {
  render(result: TranslationResult): void;
}

/**
 * High-level callback interface for progress tracking in the UI.
 */
export interface OrchestratorEventHandler {
  onProgress?: (state: ImageTranslationState) => void;
  onError?: (imageId: string, error: Error) => void;
  onComplete?: (imageId: string, result: TranslationResult) => void;
}

export interface ITranslationOrchestrator {
  /**
   * Triggers translation for the next untranslated image(s) on the page.
   * Prioritizes visible content and enqueues upcoming images if prefetching is enabled. Idempotent per image.
   */
  translateNext(handler?: OrchestratorEventHandler): Promise<boolean>;

  /**
   * Translates the image nearest to or currently within the viewport.
   */
  translateVisible?(handler?: OrchestratorEventHandler): Promise<boolean>;

  /**
   * Retries translation for a specific image ID if it previously failed.
   */
  retry(imageId: string, handler?: OrchestratorEventHandler): Promise<boolean>;

  /**
   * Prefetches upcoming manga images according to look-ahead priority.
   */
  prefetchUpcoming(handler?: OrchestratorEventHandler): Promise<string[]>;

  /**
   * Returns the detected image nearest to or intersecting the viewport.
   */
  getNearestImageToViewport(images?: MangaImage[]): MangaImage | null;

  /**
   * Enables or disables look-ahead prefetching.
   */
  setPrefetchEnabled(enabled: boolean): void;

  /**
   * Returns true if look-ahead prefetching is currently enabled.
   */
  isPrefetchEnabled(): boolean;

  /**
   * Enables or disables translation execution.
   */
  setTranslationEnabled(enabled: boolean): void;

  /**
   * Returns true if translation is currently enabled.
   */
  isTranslationEnabled(): boolean;

  /**
   * Returns the current number of pending items in the queue.
   */
  getQueueSize(): number;

  /**
   * Returns ordered list of image IDs waiting in the queue.
   */
  getQueuedImageIds(): string[];

  /**
   * Retrieves the current translation state for all known images.
   */
  getState(): Map<string, ImageTranslationState>;

  /**
   * Clears internal state (useful for page navigation or testing).
   */
  reset(): void;
}
