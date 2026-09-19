import { boxToPercentages, TranslationResult, Bubble } from '../contracts';
import { KomaError } from '../errors';
import { fitTextToBubble } from './font-scaler';
import { RenderOverlayOptions, RenderedBubbleOverlay, RenderOverlayResult } from './types';

/**
 * Applies CSS properties with !important priority to protect against aggressive website CSS resets.
 */
function applyImportantStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value, 'important');
  }
}

/**
 * DOM Overlay Renderer for Koma.
 *
 * Responsibilities:
 * - Accepts normalized TranslationResult objects (ADR-001)
 * - Converts [ymin, xmin, ymax, xmax] bounding boxes to image-relative percentage coordinates
 * - Positions speech bubble patches non-destructively over manga images
 * - Maintains scroll tracking via relative wrappers and handles zoom/resize naturally
 * - Provides responsive font downscaling for text overflow
 * - Guarantees idempotency and complete removal without page reload
 */
export class DOMOverlayRenderer {
  private readonly defaultOptions: Required<RenderOverlayOptions> = {
    minFontSize: 8,
    maxFontSize: 18,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    textColor: '#111111',
    showSourceOnHover: true,
    layerClassName: '',
  };

  private readonly renderedOverlays = new Map<string, RenderOverlayResult>();

  constructor(private readonly globalOptions?: RenderOverlayOptions) {}

  /**
   * Renders translated speech bubbles over the specified manga image.
   *
   * @param result Normalized translation payload.
   * @param targetImage Target HTMLImageElement. If omitted, attempts to locate via data attributes or src.
   * @param options Per-invocation rendering options.
   * @returns Reference to the rendered overlay hierarchy.
   */
  public render(
    result: TranslationResult,
    targetImage?: HTMLImageElement | null,
    options?: RenderOverlayOptions
  ): RenderOverlayResult {
    const mergedOptions: Required<RenderOverlayOptions> = {
      ...this.defaultOptions,
      ...this.globalOptions,
      ...options,
    };

    const imageElement = targetImage ?? this.resolveImageElement(result.imageId);
    if (!imageElement) {
      throw new KomaError(
        `Target image element could not be found for imageId: "${result.imageId}"`,
        'KOMA_RENDERER_IMAGE_NOT_FOUND',
        { imageId: result.imageId }
      );
    }

    // 1. Establish or reuse the relative wrapper around the image
    const wrapper = this.ensureImageWrapper(imageElement, result.imageId);

    // 2. Obtain or clear existing overlay layer for idempotency
    const overlayLayer = this.ensureOverlayLayer(wrapper, result.imageId, mergedOptions);

    // 3. Render each bubble patch
    const renderedBubbles: RenderedBubbleOverlay[] = [];

    for (const bubble of result.bubbles) {
      const rendered = this.renderBubble(bubble, overlayLayer, mergedOptions);
      renderedBubbles.push(rendered);
    }

    const renderResult: RenderOverlayResult = {
      imageId: result.imageId,
      wrapperElement: wrapper,
      overlayLayer,
      bubbles: renderedBubbles,
      bubbleCount: renderedBubbles.length,
      result,
    };

    this.renderedOverlays.set(result.imageId, renderResult);
    return renderResult;
  }

  /**
   * Removes all overlays for a specific image and unwraps the DOM node cleanly.
   */
  public removeOverlay(imageId: string): boolean {
    const existing = this.renderedOverlays.get(imageId);
    if (existing) {
      this.cleanupOverlayResult(existing);
      this.renderedOverlays.delete(imageId);
      return true;
    }

    // Fallback: search document directly by data attribute if map was cleared or lost
    const wrappers = document.querySelectorAll<HTMLElement>(
      `.koma-image-wrapper[data-koma-image-id="${imageId}"]`
    );

    if (wrappers.length > 0) {
      wrappers.forEach((wrapper) => this.unwrapElement(wrapper));
      return true;
    }

    return false;
  }

  /**
   * Removes all Koma overlays from the DOM and unwraps all manga images.
   */
  public removeAllOverlays(): void {
    for (const existing of this.renderedOverlays.values()) {
      this.cleanupOverlayResult(existing);
    }
    this.renderedOverlays.clear();

    // Fallback cleanup for any stray wrappers remaining in the document
    const allWrappers = document.querySelectorAll<HTMLElement>(
      '.koma-image-wrapper[data-koma-wrapper="true"]'
    );
    allWrappers.forEach((wrapper) => this.unwrapElement(wrapper));
  }

  /**
   * Checks whether overlays are currently active for the given image ID.
   */
  public hasOverlay(imageId: string): boolean {
    return this.renderedOverlays.has(imageId);
  }

  /**
   * Returns active rendered overlay details for an image if present.
   */
  public getRenderedOverlay(imageId: string): RenderOverlayResult | undefined {
    return this.renderedOverlays.get(imageId);
  }

  /**
   * Wraps the image in a relative positioning container without altering the image's original node.
   */
  private ensureImageWrapper(image: HTMLImageElement, imageId: string): HTMLElement {
    const parent = image.parentElement;
    if (parent && parent.getAttribute('data-koma-wrapper') === 'true') {
      parent.setAttribute('data-koma-image-id', imageId);
      image.setAttribute('data-koma-image-id', imageId);
      return parent;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'koma-image-wrapper';
    wrapper.setAttribute('data-koma-wrapper', 'true');
    wrapper.setAttribute('data-koma-image-id', imageId);

    applyImportantStyles(wrapper, {
      position: 'relative',
      display: 'inline-block',
      'line-height': '0',
      'max-width': '100%',
      padding: '0',
      margin: '0',
      border: 'none',
      outline: 'none',
      'vertical-align': 'top',
    });

    if (image.parentNode) {
      image.parentNode.insertBefore(wrapper, image);
      wrapper.appendChild(image);
    }

    image.setAttribute('data-koma-image-id', imageId);
    return wrapper;
  }

  /**
   * Locates or creates the absolute overlay layer within the wrapper.
   * If an overlay layer already exists, cleans up previous bubbles to ensure idempotency.
   */
  private ensureOverlayLayer(
    wrapper: HTMLElement,
    imageId: string,
    options: Required<RenderOverlayOptions>
  ): HTMLElement {
    let layer = wrapper.querySelector<HTMLElement>(':scope > [data-koma-overlay-layer="true"]');

    if (layer) {
      // Clear previous children to prevent duplicates on re-render
      while (layer.firstChild) {
        layer.removeChild(layer.firstChild);
      }
      return layer;
    }

    layer = document.createElement('div');
    const classList = ['koma-overlay-layer'];
    if (options.layerClassName) {
      classList.push(options.layerClassName);
    }
    layer.className = classList.join(' ');
    layer.setAttribute('data-koma-overlay-layer', 'true');
    layer.setAttribute('data-koma-image-id', imageId);

    applyImportantStyles(layer, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      'pointer-events': 'none',
      overflow: 'hidden',
      'box-sizing': 'border-box',
      margin: '0',
      padding: '0',
      border: 'none',
      'z-index': '2147483640',
    });

    wrapper.appendChild(layer);
    return layer;
  }

  /**
   * Renders a single dialogue bubble patch.
   */
  private renderBubble(
    bubble: Bubble,
    overlayLayer: HTMLElement,
    options: Required<RenderOverlayOptions>
  ): RenderedBubbleOverlay {
    const percentages = boxToPercentages(bubble.box);
    const bubbleElement = document.createElement('div');

    const bubbleType = bubble.bubbleType ?? 'speech';
    bubbleElement.className = `koma-bubble koma-bubble-${bubbleType}`;
    bubbleElement.setAttribute('data-koma-bubble', 'true');
    bubbleElement.setAttribute('data-koma-bubble-id', bubble.id);
    bubbleElement.setAttribute('data-koma-bubble-type', bubbleType);

    if (bubble.sourceText) {
      bubbleElement.setAttribute('data-koma-source-text', bubble.sourceText);
      if (options.showSourceOnHover) {
        bubbleElement.title = `Original: ${bubble.sourceText}`;
      }
    }

    const borderRadius = bubbleType === 'narration' ? '2px' : '6px';

    applyImportantStyles(bubbleElement, {
      position: 'absolute',
      top: percentages.top,
      left: percentages.left,
      width: percentages.width,
      height: percentages.height,
      'pointer-events': 'auto',
      'box-sizing': 'border-box',
      display: 'flex',
      'flex-direction': 'column',
      'justify-content': 'center',
      'align-items': 'center',
      'background-color': options.backgroundColor,
      color: options.textColor,
      border: '1px solid rgba(0, 0, 0, 0.16)',
      'border-radius': borderRadius,
      padding: '2px 4px',
      'box-shadow': '0 1px 3px rgba(0, 0, 0, 0.18)',
      overflow: 'hidden',
      'z-index': '10',
      'line-height': 'normal',
    });

    const textElement = document.createElement('div');
    textElement.className = 'koma-bubble-text';
    textElement.setAttribute('data-koma-bubble-text', 'true');
    textElement.textContent = bubble.translatedText;

    const alignment = bubble.textAlignment ?? 'center';

    applyImportantStyles(textElement, {
      width: '100%',
      'box-sizing': 'border-box',
      'text-align': alignment,
      'font-family': options.fontFamily,
      'font-weight': '600',
      'line-height': '1.15',
      'letter-spacing': 'normal',
      'word-break': 'break-word',
      'overflow-wrap': 'break-word',
      margin: '0',
      padding: '0',
      color: options.textColor,
      'user-select': 'text',
    });

    bubbleElement.appendChild(textElement);
    overlayLayer.appendChild(bubbleElement);

    // Apply adaptive text fitting
    const fontSize = fitTextToBubble(textElement, bubbleElement, {
      minFontSize: options.minFontSize,
      maxFontSize: options.maxFontSize,
    });

    return {
      bubbleId: bubble.id,
      element: bubbleElement,
      textElement,
      fontSize,
      bubble,
    };
  }

  /**
   * Safely unwraps an image, restoring it to its original DOM position.
   */
  private unwrapElement(wrapper: HTMLElement): void {
    const image = wrapper.querySelector<HTMLImageElement>(':scope > img');
    if (image && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(image, wrapper);
    }
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }

  /**
   * Removes overlay layers and unwraps the host image for a specific result.
   */
  private cleanupOverlayResult(result: RenderOverlayResult): void {
    if (result.overlayLayer.parentNode) {
      result.overlayLayer.parentNode.removeChild(result.overlayLayer);
    }
    this.unwrapElement(result.wrapperElement);
  }

  /**
   * Helper to locate an image on the active page by imageId or source matching.
   */
  private resolveImageElement(imageId: string): HTMLImageElement | null {
    const byDataAttr = document.querySelector<HTMLImageElement>(
      `img[data-koma-image-id="${imageId}"]`
    );
    if (byDataAttr) {
      return byDataAttr;
    }

    const bySrc = document.querySelector<HTMLImageElement>(`img[src="${imageId}"]`);
    if (bySrc) {
      return bySrc;
    }

    return null;
  }
}
