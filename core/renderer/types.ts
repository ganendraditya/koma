import { Bubble, TranslationResult } from '../contracts';

/**
 * Options configuring the appearance and behavior of rendered DOM overlays.
 */
export interface RenderOverlayOptions {
  /**
   * Minimum font size in pixels during downscaling.
   * @default 8
   */
  minFontSize?: number;

  /**
   * Maximum font size in pixels before downscaling.
   * @default 18
   */
  maxFontSize?: number;

  /**
   * Default font family applied to translated dialogue text.
   */
  fontFamily?: string;

  /**
   * Background color of the dialogue bubble overlay.
   * @default 'rgba(255, 255, 255, 0.96)'
   */
  backgroundColor?: string;

  /**
   * Foreground text color of the translated dialogue.
   * @default '#111111'
   */
  textColor?: string;

  /**
   * Whether to display original source text as a tooltip on hover.
   * @default true
   */
  showSourceOnHover?: boolean;

  /**
   * Additional custom CSS class added to the overlay layer.
   */
  layerClassName?: string;
}

/**
 * References to an individual dialogue bubble rendered into the DOM.
 */
export interface RenderedBubbleOverlay {
  /**
   * Unique identifier of the dialogue bubble.
   */
  bubbleId: string;

  /**
   * Root DOM element of the dialogue bubble patch.
   */
  element: HTMLElement;

  /**
   * Inner DOM container holding the translated text.
   */
  textElement: HTMLElement;

  /**
   * Final fitted font size in pixels.
   */
  fontSize: number;

  /**
   * Underlying domain bubble model.
   */
  bubble: Bubble;
}

/**
 * Complete summary of a translation result rendered over an image.
 */
export interface RenderOverlayResult {
  /**
   * Target image identifier.
   */
  imageId: string;

  /**
   * Relative positioning container wrapping the manga image.
   */
  wrapperElement: HTMLElement;

  /**
   * Absolute overlay layer containing all bubble patches for this image.
   */
  overlayLayer: HTMLElement;

  /**
   * List of individual dialogue bubbles rendered.
   */
  bubbles: RenderedBubbleOverlay[];

  /**
   * Total number of bubbles rendered.
   */
  bubbleCount: number;

  /**
   * Original translation result used for rendering.
   */
  result: TranslationResult;
}

/**
 * Parameters controlling font scaling calculations.
 */
export interface FontScaleOptions {
  /**
   * Minimum allowable font size in pixels.
   * @default 8
   */
  minFontSize?: number;

  /**
   * Maximum allowable font size in pixels.
   * @default 18
   */
  maxFontSize?: number;

  /**
   * Step size in pixels to decrease per iteration.
   * @default 1
   */
  step?: number;

  /**
   * Line height multiplier.
   * @default 1.2
   */
  lineHeight?: number;
}
