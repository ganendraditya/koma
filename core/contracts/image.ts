/**
 * Represents a detected manga page or image element extracted by a site adapter.
 */
export interface MangaImage {
  /**
   * Unique identifier for this image instance within the reading session.
   */
  id: string;

  /**
   * Source URL of the manga image, if loaded via URL.
   */
  url?: string;

  /**
   * Reading order index (0-based) relative to the current chapter.
   */
  pageIndex: number;

  /**
   * Intrinsic or rendered width of the image in pixels if available.
   */
  width?: number;

  /**
   * Intrinsic or rendered height of the image in pixels if available.
   */
  height?: number;

  /**
   * Aspect ratio (width / height) if known.
   */
  aspectRatio?: number;

  /**
   * Base64-encoded image data or data URL when loaded in-memory.
   */
  base64Data?: string;

  /**
   * MIME type of the image (e.g. 'image/jpeg', 'image/webp', 'image/png').
   */
  mimeType?: string;

  /**
   * Adapter-specific metadata (e.g. chapter ID, site name, selector).
   */
  metadata?: Record<string, unknown>;
}
