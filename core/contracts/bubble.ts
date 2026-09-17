import { BoundingBox } from './geometry';

/**
 * Functional classification of dialogue bubbles.
 */
export type BubbleType = 'speech' | 'narration' | 'thought' | 'sfx' | 'other';

/**
 * Model confidence scores for detection and translation accuracy.
 */
export interface BubbleConfidence {
  /**
   * OCR confidence between 0.0 and 1.0.
   */
  ocr?: number;

  /**
   * Translation confidence between 0.0 and 1.0.
   */
  translation?: number;

  /**
   * Overall confidence between 0.0 and 1.0.
   */
  overall?: number;
}

/**
 * Normalized dialogue bubble entity within a manga image.
 */
export interface Bubble {
  /**
   * Unique identifier of the bubble within its parent manga image (e.g. 'bubble_001').
   */
  id: string;

  /**
   * Normalized bounding box coordinates [0, 1000].
   */
  box: BoundingBox;

  /**
   * Extracted original source text in the manga (e.g. Japanese, Korean).
   */
  sourceText?: string;

  /**
   * Translated target text in the requested language (e.g. Indonesian, English).
   */
  translatedText: string;

  /**
   * Type/classification of the text bubble.
   */
  bubbleType?: BubbleType;

  /**
   * Inferred speaker or character name, if identified by the model or context.
   */
  speaker?: string | null;

  /**
   * Reading sequence order (1-based) within the page (typically right-to-left for manga).
   */
  readingOrder?: number;

  /**
   * Confidence scores for OCR and translation.
   */
  confidence?: BubbleConfidence;

  /**
   * Suggested text alignment for DOM rendering.
   */
  textAlignment?: 'center' | 'left' | 'right';
}
