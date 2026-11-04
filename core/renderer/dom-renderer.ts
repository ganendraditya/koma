import { boxToPercentages } from '../contracts';
import type { Bubble, TranslationResult } from '../contracts';
import { KomaError } from '../errors';
import { fitTextToBubble } from './font-scaler';
import type { RenderOverlayOptions, RenderedBubbleOverlay, RenderOverlayResult } from './types';

const IMAGE_MARGIN_PROPERTIES = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
] as const;

interface InlineStyleValue {
  value: string;
  priority: string;
}

interface OriginalImageState {
  imageId: string | null;
  margins: Map<string, InlineStyleValue>;
}

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
    enableInspection: true,
    layerClassName: '',
  };

  private readonly renderedOverlays = new Map<string, RenderOverlayResult>();
  private readonly resizeObservers = new Map<string, ResizeObserver>();
  private readonly portalScrollCleanups = new Map<string, () => void>();
  private readonly originalImageStates = new WeakMap<HTMLImageElement, OriginalImageState>();
  private readonly hoverInspectionTimers = new WeakMap<RenderedBubbleOverlay, number>();
  private readonly readoutDismissCleanups = new WeakMap<RenderedBubbleOverlay, () => void>();

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

    const previous = this.renderedOverlays.get(result.imageId);
    if (previous) this.cleanupInteractiveControls(previous);
    this.disconnectResizeObserver(result.imageId);

    // 1. Establish or reuse the relative wrapper around the image
    const wrapper = this.ensureImageWrapper(imageElement, result.imageId);

    // 2. Obtain or clear existing overlay layer for idempotency
    const overlayLayer = this.ensureOverlayLayer(wrapper, result.imageId, mergedOptions);
    // The bubble boxes are normalized to the image, so the layer has to match the image box even
    // when the wrapper is wider than the artwork (block images inside a wider reader column).
    this.syncLayerBounds(imageElement, wrapper, overlayLayer);

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
    this.observeImageResize(imageElement, renderResult, mergedOptions);
    this.observePortalScroll(renderResult);
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
      this.removePortalControlsForImage(imageId);
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
    document.querySelectorAll<HTMLElement>('[data-koma-portal-image-id]').forEach((control) => {
      control.remove();
    });
  }

  /**
   * Checks whether overlays are currently active for the given image ID.
   */
  public hasOverlay(imageId: string): boolean {
    return this.renderedOverlays.get(imageId)?.wrapperElement.isConnected ?? false;
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
      display: this.wrapperDisplayFor(image),
      'line-height': '0',
      'max-width': '100%',
      padding: '0',
      ...this.imageMargins(image),
      border: 'none',
      outline: 'none',
      'vertical-align': this.computedStyleFor(image)?.verticalAlign || 'baseline',
    });

    this.rememberImageState(image);
    applyImportantStyles(image, {
      'margin-top': '0',
      'margin-right': '0',
      'margin-bottom': '0',
      'margin-left': '0',
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
      this.ensureLayerStyles(layer, options);
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

    if (options.enableInspection) {
      this.ensureLayerStyles(layer, options);
    }

    wrapper.appendChild(layer);
    return layer;
  }

  /**
   * Keeps the layer's inspection focus rules present across re-renders.
   */
  private ensureLayerStyles(layer: HTMLElement, options: Required<RenderOverlayOptions>): void {
    if (!options.enableInspection) return;
    if (layer.querySelector(':scope > [data-koma-inspection-styles]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-koma-inspection-styles', 'true');
    // A focused patch must stay visible, including while it hides its paint for inspection.
    style.textContent =
      '[data-koma-bubble]:focus-visible, [data-koma-clip-indicator]:focus-visible, [data-koma-bubble-readout]:focus-visible, [data-koma-readout-close]:focus-visible' +
      ' { outline: 2px solid #5b5ee9 !important; outline-offset: 1px !important; }';
    layer.appendChild(style);
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
        bubbleElement.setAttribute(
          'aria-label',
          `${bubble.translatedText}. Original: ${bubble.sourceText}`
        );
      }
    }

    if (options.enableInspection) {
      bubbleElement.tabIndex = 0;
      bubbleElement.setAttribute('data-koma-bubble-inspectable', 'true');
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

    const rendered: RenderedBubbleOverlay = {
      bubbleId: bubble.id,
      element: bubbleElement,
      textElement,
      fontSize,
      bubble,
    };

    if (options.enableInspection) {
      this.attachInspection(rendered);
      if (
        fontSize <= options.minFontSize &&
        this.textOverflowsContainer(textElement, bubbleElement)
      ) {
        rendered.clipIndicator = this.createClipIndicator(rendered, percentages);
        this.syncClipIndicator(rendered, overlayLayer);
      }
    }

    return rendered;
  }

  /**
   * Detects text that still overflows after downscaling reached the font floor.
   */
  private textOverflowsContainer(textElement: HTMLElement, container: HTMLElement): boolean {
    return (
      textElement.scrollHeight > container.clientHeight ||
      textElement.scrollWidth > container.clientWidth
    );
  }

  /**
   * Pointer, touch, and keyboard inspection: the patch hides its own paint so the untouched
   * artwork shows through. The patch keeps receiving pointer events and keeps its focus outline.
   */
  private attachInspection(rendered: RenderedBubbleOverlay): void {
    const patch = rendered.element;
    // Hover and the keyboard toggle are tracked apart, so a stray pointer move cannot cancel a
    // deliberate keyboard reveal and a pointer that stays put keeps its reveal.
    patch.addEventListener('pointerenter', () => this.scheduleHoverInspection(rendered, true));
    patch.addEventListener('pointerleave', () => this.scheduleHoverInspection(rendered, false));
    patch.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'touch') return;
      rendered.toggledInspection = !rendered.toggledInspection;
      this.syncInspection(rendered);
    });
    patch.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearInspection(rendered);
        this.closeReadout(rendered);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      rendered.toggledInspection = !rendered.toggledInspection;
      this.syncInspection(rendered);
    });
  }

  private setHoverInspection(rendered: RenderedBubbleOverlay, hover: boolean): void {
    if (rendered.hoverInspection === hover) return;
    rendered.hoverInspection = hover;
    this.syncInspection(rendered);
  }

  private scheduleHoverInspection(rendered: RenderedBubbleOverlay, hover: boolean): void {
    this.cancelHoverInspection(rendered);
    if (!hover) {
      this.setHoverInspection(rendered, false);
      return;
    }

    const view = rendered.element.ownerDocument.defaultView;
    if (!view) return;
    const timer = view.setTimeout(() => {
      this.hoverInspectionTimers.delete(rendered);
      this.setHoverInspection(rendered, true);
    }, 300);
    this.hoverInspectionTimers.set(rendered, timer);
  }

  private cancelHoverInspection(rendered: RenderedBubbleOverlay): void {
    const timer = this.hoverInspectionTimers.get(rendered);
    if (timer === undefined) return;
    rendered.element.ownerDocument.defaultView?.clearTimeout(timer);
    this.hoverInspectionTimers.delete(rendered);
  }

  private clearInspection(rendered: RenderedBubbleOverlay): void {
    this.cancelHoverInspection(rendered);
    if (!rendered.hoverInspection && !rendered.toggledInspection) return;
    rendered.hoverInspection = false;
    rendered.toggledInspection = false;
    this.syncInspection(rendered);
  }

  private syncInspection(rendered: RenderedBubbleOverlay): void {
    this.setInspected(rendered, Boolean(rendered.hoverInspection || rendered.toggledInspection));
  }

  private readonly inspectionStates = new WeakMap<
    RenderedBubbleOverlay,
    { element: HTMLElement; property: string; value: string; priority: string }[]
  >();

  private inspectedProperties(
    rendered: RenderedBubbleOverlay
  ): { element: HTMLElement; property: string }[] {
    // The fallback chip stays visible on purpose: it is Koma's control, not the artwork, and it
    // must remain operable while the patch reveals the original image underneath.
    return [
      { element: rendered.element, property: 'background-color' },
      { element: rendered.element, property: 'border-color' },
      { element: rendered.element, property: 'box-shadow' },
      { element: rendered.textElement, property: 'color' },
    ];
  }

  private setInspected(rendered: RenderedBubbleOverlay, inspected: boolean): void {
    if (rendered.inspected === inspected) return;
    rendered.inspected = inspected;
    const entries = this.inspectedProperties(rendered);

    if (inspected) {
      // Keep the exact paint values so leaving inspection restores the rendered patch.
      this.inspectionStates.set(
        rendered,
        entries.map((entry) => ({
          ...entry,
          value: entry.element.style.getPropertyValue(entry.property),
          priority: entry.element.style.getPropertyPriority(entry.property),
        }))
      );
      for (const entry of entries) {
        const paint = entry.property === 'box-shadow' ? 'none' : 'transparent';
        entry.element.style.setProperty(entry.property, paint, 'important');
      }
      return;
    }

    const state = this.inspectionStates.get(rendered) ?? [];
    this.inspectionStates.delete(rendered);
    for (const entry of state) {
      if (entry.value) {
        entry.element.style.setProperty(entry.property, entry.value, entry.priority || 'important');
      } else {
        entry.element.style.removeProperty(entry.property);
      }
    }
  }

  /**
   * Fallback affordance for text that cannot fit its patch at the font floor.
   */
  private createClipIndicator(
    rendered: RenderedBubbleOverlay,
    percentages: { top: string; left: string; width: string; height: string }
  ): HTMLElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'koma-bubble-clip-indicator';
    chip.setAttribute('data-koma-clip-indicator', rendered.bubble.id);
    chip.setAttribute(
      'aria-label',
      `Show the complete translation${rendered.bubble.sourceText ? ' and the original text' : ''}`
    );
    chip.textContent = 'Show all';
    const edge = (start: string, size: string) => `${parseFloat(start) + parseFloat(size)}%`;
    applyImportantStyles(chip, {
      position: 'absolute',
      // Pinned to the patch's bottom-right corner, inside the artwork so it never leaves the layer.
      top: edge(percentages.top, percentages.height),
      left: edge(percentages.left, percentages.width),
      transform: 'translate(calc(-100% - 2px), calc(-100% - 2px))',
      'min-height': '24px',
      'min-width': '44px',
      'font-family':
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      'font-size': '11px',
      'font-weight': '600',
      'line-height': '1',
      color: '#111111',
      background: 'rgba(255, 255, 255, 0.98)',
      // 0.46 over the white chip is 3.4:1 (WCAG non-text 3:1) and stays 5.9:1 over dark artwork.
      border: '1px solid rgba(0, 0, 0, 0.46)',
      'border-radius': '12px',
      padding: '3px 8px',
      'box-shadow': '0 1px 2px rgba(0, 0, 0, 0.3)',
      cursor: 'pointer',
      'z-index': '20',
      'pointer-events': 'auto',
    });

    const open = (event: Event) => {
      event.stopPropagation();
      if (rendered.readoutElement?.isConnected) {
        this.closeReadout(rendered, false);
        return;
      }
      this.openReadout(rendered);
    };
    chip.addEventListener('click', open);
    return chip;
  }

  private syncClipIndicator(rendered: RenderedBubbleOverlay, overlayLayer: HTMLElement): void {
    const chip = rendered.clipIndicator;
    if (!chip) return;

    const layerRect = overlayLayer.getBoundingClientRect();
    const layerWidth = layerRect.width || overlayLayer.clientWidth;
    const layerHeight = layerRect.height || overlayLayer.clientHeight;
    if (layerWidth <= 0 || layerHeight <= 0) {
      chip.removeAttribute('data-koma-portal-image-id');
      chip.remove();
      return;
    }
    // The layer clips descendants, so move the chip out when it cannot contain the full control.
    if (layerWidth < 72 || layerHeight < 44) {
      const ownerDocument = overlayLayer.ownerDocument;
      const view = ownerDocument.defaultView;
      const viewportWidth = ownerDocument.documentElement.clientWidth || view?.innerWidth || 0;
      const viewportHeight = ownerDocument.documentElement.clientHeight || view?.innerHeight || 0;
      const availableWidth = Math.max(viewportWidth - 16, 0);
      const availableHeight = Math.max(viewportHeight - 16, 0);
      if (availableWidth <= 0 || availableHeight <= 0) return;

      const patchRect = rendered.element.getBoundingClientRect();
      const isInViewport =
        patchRect.right > 0 &&
        patchRect.bottom > 0 &&
        patchRect.left < viewportWidth &&
        patchRect.top < viewportHeight;
      const width = Math.min(72, availableWidth);
      const height = Math.min(44, availableHeight);
      const left = Math.max(8, Math.min(patchRect.left, viewportWidth - width - 8));
      const top = Math.max(8, Math.min(patchRect.top, viewportHeight - height - 8));
      const imageId = overlayLayer.getAttribute('data-koma-image-id');
      if (imageId) chip.setAttribute('data-koma-portal-image-id', imageId);
      applyImportantStyles(chip, {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        transform: 'none',
        width: `${width}px`,
        height: `${height}px`,
        'min-width': `${width}px`,
        'min-height': `${height}px`,
        'box-sizing': 'border-box',
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        'white-space': 'nowrap',
        visibility: isInViewport ? 'visible' : 'hidden',
        'z-index': '2147483647',
      });
      if (!isInViewport && ownerDocument.activeElement === chip) chip.blur();
      const portalRoot = document.body ?? document.documentElement;
      if (chip.parentElement !== portalRoot) portalRoot.appendChild(chip);
      return;
    }

    chip.removeAttribute('data-koma-portal-image-id');
    for (const property of [
      'width',
      'height',
      'box-sizing',
      'display',
      'align-items',
      'justify-content',
      'white-space',
      'visibility',
    ]) {
      chip.style.removeProperty(property);
    }
    const percentages = boxToPercentages(rendered.bubble.box);
    const edge = (start: string, size: string) => `${parseFloat(start) + parseFloat(size)}%`;
    applyImportantStyles(chip, {
      position: 'absolute',
      top: edge(percentages.top, percentages.height),
      left: edge(percentages.left, percentages.width),
      transform: 'translate(calc(-100% - 2px), calc(-100% - 2px))',
      'min-height': '24px',
      'min-width': '44px',
      'z-index': '20',
    });
    if (chip.parentElement !== overlayLayer) overlayLayer.appendChild(chip);
  }

  /**
   * Opens the readout near its patch, using the layer or a viewport portal when space is short.
   */
  private openReadout(rendered: RenderedBubbleOverlay): void {
    if (rendered.readoutElement?.isConnected) return;
    this.closeOtherReadouts();

    const layer = rendered.element.closest<HTMLElement>('[data-koma-overlay-layer="true"]');
    if (!layer) return;
    const layerRect = layer.getBoundingClientRect();
    if (layerRect.width <= 0 || layerRect.height <= 0) return;
    const patchRect = rendered.element.getBoundingClientRect();
    const inlineReadoutWidth = 220;
    const inlineReadoutHeight = 72;
    const inlineGutter = 4;
    const patchTop = patchRect.top - layerRect.top;
    const inlineHeightBelow = layerRect.height - patchTop - inlineGutter;
    const inlineHeightAbove = patchTop - inlineGutter;
    const placeAbovePatch =
      inlineHeightBelow < inlineReadoutHeight && inlineHeightAbove >= inlineReadoutHeight;
    const useViewportReadout =
      layerRect.width < inlineReadoutWidth + inlineGutter * 2 ||
      Math.max(inlineHeightBelow, inlineHeightAbove) < inlineReadoutHeight;

    const panel = document.createElement('div');
    panel.className = 'koma-bubble-readout';
    panel.setAttribute('data-koma-bubble-readout', rendered.bubble.id);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute(
      'aria-label',
      `Full translation${rendered.bubble.sourceText ? ' with original text' : ''}`
    );
    panel.tabIndex = -1;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.setAttribute('data-koma-readout-close', 'true');
    closeButton.setAttribute('aria-label', 'Close full translation');
    closeButton.textContent = 'Close';
    applyImportantStyles(closeButton, {
      display: 'block',
      width: '64px',
      'max-width': '100%',
      height: '44px',
      'min-width': '44px',
      'min-height': '44px',
      'box-sizing': 'border-box',
      margin: '0 0 8px auto',
      padding: '4px 8px',
      'font-family':
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      'font-size': '12px',
      'font-weight': '600',
      color: '#111111',
      background: 'rgba(255, 255, 255, 0.99)',
      border: '1px solid rgba(0, 0, 0, 0.46)',
      'border-radius': '4px',
      cursor: 'pointer',
      'pointer-events': 'auto',
    });
    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeReadout(rendered, false);
      if (rendered.clipIndicator?.isConnected) rendered.clipIndicator.focus();
    });
    panel.append(closeButton);

    const translated = document.createElement('p');
    translated.textContent = rendered.bubble.translatedText;
    applyImportantStyles(translated, {
      margin: '0',
      'font-family':
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      'font-size': '14px',
      'line-height': '1.35',
      'font-weight': '600',
      color: '#111111',
      'overflow-wrap': 'break-word',
      'white-space': 'pre-wrap',
    });
    panel.append(translated);

    if (rendered.bubble.sourceText) {
      const source = document.createElement('p');
      source.textContent = `Original: ${rendered.bubble.sourceText}`;
      applyImportantStyles(source, {
        margin: '6px 0 0',
        'font-family': translated.style.fontFamily,
        'font-size': '12px',
        'line-height': '1.3',
        'font-weight': '500',
        color: 'rgba(17, 17, 17, 0.72)',
        'overflow-wrap': 'break-word',
        'white-space': 'pre-wrap',
      });
      panel.append(source);
    }

    let host = layer;
    let position: 'absolute' | 'fixed' = 'absolute';
    let top: number;
    let left: number;
    let width: number;
    let maxHeight: number;

    if (useViewportReadout) {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const viewportGutter = 8;
      const availableWidth = Math.max(viewportWidth - viewportGutter * 2, 0);
      const availableHeight = Math.max(viewportHeight - viewportGutter * 2, 0);
      if (availableWidth <= 0 || availableHeight <= 0) return;

      host = document.body ?? document.documentElement;
      position = 'fixed';
      width = Math.min(Math.max(patchRect.width, inlineReadoutWidth), availableWidth);
      maxHeight = Math.min(availableHeight, 320);
      left = Math.max(
        viewportGutter,
        Math.min(patchRect.left, viewportWidth - width - viewportGutter)
      );
      top = Math.max(
        viewportGutter,
        Math.min(patchRect.top, viewportHeight - maxHeight - viewportGutter)
      );
      const imageId = layer.getAttribute('data-koma-image-id');
      if (imageId) panel.setAttribute('data-koma-portal-image-id', imageId);
    } else {
      width = Math.min(Math.max(patchRect.width, inlineReadoutWidth), layerRect.width - 8);
      left = Math.min(
        Math.max(patchRect.left - layerRect.left, inlineGutter),
        layerRect.width - width - inlineGutter
      );
      if (placeAbovePatch) {
        maxHeight = Math.min(320, inlineHeightAbove);
        top = Math.max(inlineGutter, patchTop - inlineGutter - maxHeight);
      } else {
        top = Math.max(patchTop, inlineGutter);
        maxHeight = Math.min(320, layerRect.height - top - inlineGutter);
      }
    }

    applyImportantStyles(panel, {
      position,
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      'max-height': `${maxHeight}px`,
      'overflow-x': 'hidden',
      'overflow-y': 'auto',
      'box-sizing': 'border-box',
      background: 'rgba(255, 255, 255, 0.99)',
      // Matches the chip boundary: 3.4:1 against the panel fill, so the panel edge is perceivable.
      border: '1px solid rgba(0, 0, 0, 0.46)',
      'border-radius': '8px',
      padding: '10px',
      margin: '0',
      'box-shadow': '0 2px 8px rgba(0, 0, 0, 0.35)',
      'pointer-events': 'auto',
      'z-index': useViewportReadout ? '2147483647' : '40',
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.clearInspection(rendered);
      this.closeReadout(rendered);
    });

    host.appendChild(panel);
    rendered.readoutElement = panel;

    const chip = rendered.clipIndicator;
    const isWithinReadoutOrChip = (target: EventTarget | null): boolean => {
      if (!target || typeof target !== 'object' || !('nodeType' in target)) return false;
      const node = target as Node;
      return panel.contains(node) || Boolean(chip?.contains(node));
    };
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (isWithinReadoutOrChip(event.target)) return;
      this.closeReadout(rendered, false);
    };
    const onOutsideClick = (event: MouseEvent) => {
      if (isWithinReadoutOrChip(event.target)) return;
      this.closeReadout(rendered, false);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isWithinReadoutOrChip(event.relatedTarget)) return;
      panel.ownerDocument.defaultView?.queueMicrotask(() => {
        if (!panel.isConnected || isWithinReadoutOrChip(panel.ownerDocument.activeElement)) return;
        this.closeReadout(rendered, false);
      });
    };
    panel.ownerDocument.addEventListener('pointerdown', onOutsidePointerDown, true);
    panel.ownerDocument.addEventListener('click', onOutsideClick, true);
    panel.addEventListener('focusout', onFocusOut);
    this.readoutDismissCleanups.set(rendered, () => {
      panel.ownerDocument.removeEventListener('pointerdown', onOutsidePointerDown, true);
      panel.ownerDocument.removeEventListener('click', onOutsideClick, true);
      panel.removeEventListener('focusout', onFocusOut);
    });

    panel.focus();
  }

  /**
   * Removes the readout panel and returns focus to its patch.
   */
  private closeReadout(rendered: RenderedBubbleOverlay, restoreFocus = true): void {
    if (!rendered.readoutElement) return;
    const patch = rendered.element;
    this.readoutDismissCleanups.get(rendered)?.();
    this.readoutDismissCleanups.delete(rendered);
    rendered.readoutElement.remove();
    rendered.readoutElement = undefined;
    if (restoreFocus && patch.isConnected) patch.focus();
  }

  /**
   * Only one clipped-text readout is open at a time across all rendered images.
   */
  private closeOtherReadouts(): void {
    for (const result of this.renderedOverlays.values()) {
      for (const bubble of result.bubbles) {
        if (bubble.readoutElement?.isConnected) this.closeReadout(bubble);
      }
    }
  }

  /**
   * Measures the renderer's own placement drift: each patch rect versus the rectangle
   * implied by its normalized box over the rendered image size. Model bounding-box error
   * needs artwork ground truth and is therefore not covered by this measurement.
   */
  public measureLayoutDrift(
    imageId: string
  ): { bubbles: { bubbleId: string; driftPercent: number }[]; maxDriftPercent: number } | null {
    const rendered = this.renderedOverlays.get(imageId);
    if (!rendered?.wrapperElement.isConnected) return null;
    const image = rendered.wrapperElement.querySelector<HTMLImageElement>(':scope > img');
    const imageRect = image?.getBoundingClientRect();
    if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) return null;

    let maxDriftPercent = 0;
    const bubbles = rendered.bubbles.map((renderedBubble) => {
      const intended = boxToPercentages(renderedBubble.bubble.box);
      // Normalized boxes are image-relative, so the image box is the only honest reference.
      const intendedLeft = imageRect.left + (imageRect.width * parseFloat(intended.left)) / 100;
      const intendedTop = imageRect.top + (imageRect.height * parseFloat(intended.top)) / 100;
      const actual = renderedBubble.element.getBoundingClientRect();
      const offsetX = actual.left - intendedLeft;
      const offsetY = actual.top - intendedTop;
      const driftPercent =
        Math.max(
          Math.abs(offsetX) / Math.max(imageRect.width, 1),
          Math.abs(offsetY) / Math.max(imageRect.height, 1)
        ) * 100;
      maxDriftPercent = Math.max(maxDriftPercent, driftPercent);
      return { bubbleId: renderedBubble.bubbleId, driftPercent };
    });
    return { bubbles, maxDriftPercent };
  }

  /**
   * Safely unwraps an image, restoring it to its original DOM position.
   */
  private unwrapElement(wrapper: HTMLElement): void {
    const image = wrapper.querySelector<HTMLImageElement>(':scope > img');
    if (image && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(image, wrapper);
      this.restoreImageState(image);
    }
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }

  /**
   * Removes overlay layers and unwraps the host image for a specific result.
   */
  private cleanupOverlayResult(result: RenderOverlayResult): void {
    this.disconnectResizeObserver(result.imageId);
    this.cleanupInteractiveControls(result);
    if (result.overlayLayer.parentNode) {
      result.overlayLayer.parentNode.removeChild(result.overlayLayer);
    }
    this.unwrapElement(result.wrapperElement);
  }

  private cleanupInteractiveControls(result: RenderOverlayResult): void {
    for (const bubble of result.bubbles) {
      this.cancelHoverInspection(bubble);
      this.closeReadout(bubble, false);
      bubble.clipIndicator?.remove();
      bubble.clipIndicator = undefined;
    }
  }

  private removePortalControlsForImage(imageId: string): void {
    document.querySelectorAll<HTMLElement>('[data-koma-portal-image-id]').forEach((control) => {
      if (control.getAttribute('data-koma-portal-image-id') === imageId) control.remove();
    });
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

  private observeImageResize(
    image: HTMLImageElement,
    result: RenderOverlayResult,
    options: Required<RenderOverlayOptions>
  ): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      this.syncLayerBounds(image, result.wrapperElement, result.overlayLayer);
      for (const bubble of result.bubbles) {
        bubble.fontSize = fitTextToBubble(bubble.textElement, bubble.element, {
          minFontSize: options.minFontSize,
          maxFontSize: options.maxFontSize,
        });
        this.syncClipIndicator(bubble, result.overlayLayer);
        if (bubble.readoutElement?.hasAttribute('data-koma-portal-image-id')) {
          this.syncViewportReadout(bubble);
        }
      }
    });

    observer.observe(image);
    this.resizeObservers.set(result.imageId, observer);
  }

  private observePortalScroll(result: RenderOverlayResult): void {
    if (!result.bubbles.some((bubble) => bubble.clipIndicator)) return;
    const view = result.wrapperElement.ownerDocument.defaultView;
    if (!view) return;

    let syncTimer: number | undefined;
    const synchronize = () => {
      if (syncTimer !== undefined) return;
      syncTimer = view.setTimeout(() => {
        syncTimer = undefined;
        if (this.renderedOverlays.get(result.imageId) !== result) return;

        for (const bubble of result.bubbles) {
          const chipIsPortaled = bubble.clipIndicator?.hasAttribute('data-koma-portal-image-id');
          const panelIsPortaled = bubble.readoutElement?.hasAttribute('data-koma-portal-image-id');
          if (!chipIsPortaled && !panelIsPortaled) continue;

          const patchRect = bubble.element.getBoundingClientRect();
          const isInViewport =
            patchRect.right > 0 &&
            patchRect.bottom > 0 &&
            patchRect.left < view.innerWidth &&
            patchRect.top < view.innerHeight;
          if (!isInViewport) {
            if (chipIsPortaled) {
              bubble.clipIndicator!.style.setProperty('visibility', 'hidden', 'important');
              if (result.wrapperElement.ownerDocument.activeElement === bubble.clipIndicator) {
                bubble.clipIndicator!.blur();
              }
            }
            if (panelIsPortaled) this.closeReadout(bubble, false);
            continue;
          }

          if (chipIsPortaled) this.syncClipIndicator(bubble, result.overlayLayer);
          if (panelIsPortaled) this.syncViewportReadout(bubble);
        }
      }, 16);
    };
    const cleanup = () => {
      view.removeEventListener('scroll', synchronize);
      view.removeEventListener('resize', synchronize);
      result.wrapperElement.ownerDocument.removeEventListener('scroll', synchronize, true);
      if (syncTimer !== undefined) view.clearTimeout(syncTimer);
      this.portalScrollCleanups.delete(result.imageId);
    };

    view.addEventListener('scroll', synchronize, { passive: true });
    view.addEventListener('resize', synchronize, { passive: true });
    result.wrapperElement.ownerDocument.addEventListener('scroll', synchronize, {
      capture: true,
      passive: true,
    });
    this.portalScrollCleanups.set(result.imageId, cleanup);
  }

  private syncViewportReadout(rendered: RenderedBubbleOverlay): void {
    const panel = rendered.readoutElement;
    const view = rendered.element.ownerDocument.defaultView;
    if (!panel || !view || !panel.hasAttribute('data-koma-portal-image-id')) return;

    const patchRect = rendered.element.getBoundingClientRect();
    if (
      patchRect.right <= 0 ||
      patchRect.bottom <= 0 ||
      patchRect.left >= view.innerWidth ||
      patchRect.top >= view.innerHeight
    ) {
      this.closeReadout(rendered, false);
      return;
    }

    const viewportWidth =
      rendered.element.ownerDocument.documentElement.clientWidth || view.innerWidth;
    const viewportHeight =
      rendered.element.ownerDocument.documentElement.clientHeight || view.innerHeight;
    const viewportGutter = 8;
    const availableWidth = Math.max(viewportWidth - viewportGutter * 2, 0);
    const availableHeight = Math.max(viewportHeight - viewportGutter * 2, 0);
    if (availableWidth <= 0 || availableHeight <= 0) {
      this.closeReadout(rendered, false);
      return;
    }

    const width = Math.min(Math.max(patchRect.width, 220), availableWidth);
    const maxHeight = Math.min(availableHeight, 320);
    const left = Math.max(
      viewportGutter,
      Math.min(patchRect.left, viewportWidth - width - viewportGutter)
    );
    const top = Math.max(
      viewportGutter,
      Math.min(patchRect.top, viewportHeight - maxHeight - viewportGutter)
    );
    applyImportantStyles(panel, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      'max-height': `${maxHeight}px`,
    });
  }

  /**
   * Pins the overlay layer to the image's rendered box inside the wrapper, in pixels, so the
   * normalized bubble percentages resolve against the artwork instead of the surrounding layout.
   * Falls back to filling the wrapper while the image has no measurable box.
   */
  private syncLayerBounds(image: HTMLImageElement, wrapper: HTMLElement, layer: HTMLElement): void {
    const imageRect = image.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    if (imageRect.width <= 0 || imageRect.height <= 0) {
      applyImportantStyles(layer, { top: '0', left: '0', width: '100%', height: '100%' });
      return;
    }

    applyImportantStyles(layer, {
      top: `${imageRect.top - wrapperRect.top}px`,
      left: `${imageRect.left - wrapperRect.left}px`,
      width: `${imageRect.width}px`,
      height: `${imageRect.height}px`,
    });
  }

  private disconnectResizeObserver(imageId: string): void {
    this.resizeObservers.get(imageId)?.disconnect();
    this.resizeObservers.delete(imageId);
    this.portalScrollCleanups.get(imageId)?.();
  }

  private computedStyleFor(image: HTMLImageElement): CSSStyleDeclaration | undefined {
    return image.ownerDocument.defaultView?.getComputedStyle(image);
  }

  private wrapperDisplayFor(image: HTMLImageElement): string {
    const display = this.computedStyleFor(image)?.display;
    return !display || display === 'inline' ? 'inline-block' : display;
  }

  private imageMargins(image: HTMLImageElement): Record<string, string> {
    const style = this.computedStyleFor(image);
    return {
      'margin-top': style?.marginTop || '0',
      'margin-right': style?.marginRight || '0',
      'margin-bottom': style?.marginBottom || '0',
      'margin-left': style?.marginLeft || '0',
    };
  }

  private rememberImageState(image: HTMLImageElement): void {
    if (this.originalImageStates.has(image)) {
      return;
    }

    const margins = new Map<string, InlineStyleValue>();
    for (const property of IMAGE_MARGIN_PROPERTIES) {
      margins.set(property, {
        value: image.style.getPropertyValue(property),
        priority: image.style.getPropertyPriority(property),
      });
    }
    this.originalImageStates.set(image, {
      imageId: image.getAttribute('data-koma-image-id'),
      margins,
    });
  }

  private restoreImageState(image: HTMLImageElement): void {
    const original = this.originalImageStates.get(image);
    if (!original) {
      return;
    }

    for (const [property, style] of original.margins) {
      if (style.value) {
        image.style.setProperty(property, style.value, style.priority);
      } else {
        image.style.removeProperty(property);
      }
    }

    if (original.imageId === null) {
      image.removeAttribute('data-koma-image-id');
    } else {
      image.setAttribute('data-koma-image-id', original.imageId);
    }
    this.originalImageStates.delete(image);
  }
}
