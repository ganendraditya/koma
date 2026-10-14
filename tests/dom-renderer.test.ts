// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOMOverlayRenderer, estimateFittedFontSize, fitTextToBubble } from '../core/renderer';
import { TranslationResult } from '../core/contracts';
import { KomaError } from '../core/errors';
import { resolveTargetImage } from '../extension/content/target-image';

describe('KOMA-006: DOM Overlay Renderer', () => {
  let renderer: DOMOverlayRenderer;
  let container: HTMLDivElement;
  let image1: HTMLImageElement;
  let image2: HTMLImageElement;

  const mockResult1: TranslationResult = {
    pageId: 'chapter_01',
    imageId: 'img_page_01',
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles: [
      {
        id: 'bubble_001',
        box: { ymin: 100, xmin: 200, ymax: 300, xmax: 600 },
        sourceText: '何をしているんだ？',
        translatedText: 'Apa yang sedang kamu lakukan?',
        bubbleType: 'speech',
        speaker: 'Takahashi',
        textAlignment: 'center',
      },
      {
        id: 'bubble_002',
        box: { ymin: 500, xmin: 150, ymax: 750, xmax: 450 },
        sourceText: '別に…',
        translatedText: 'Bukan apa-apa...',
        bubbleType: 'speech',
        textAlignment: 'left',
      },
      {
        id: 'bubble_003',
        box: { ymin: 800, xmin: 50, ymax: 950, xmax: 950 },
        sourceText: 'それは昔々の物語。',
        translatedText: 'Itu adalah cerita di masa lampau.',
        bubbleType: 'narration',
        textAlignment: 'right',
      },
    ],
  };

  const mockResult2: TranslationResult = {
    pageId: 'chapter_01',
    imageId: 'img_page_02',
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles: [
      {
        id: 'bubble_201',
        box: { ymin: 200, xmin: 300, ymax: 400, xmax: 700 },
        sourceText: '逃げろ！',
        translatedText: 'Lari!',
        bubbleType: 'speech',
      },
    ],
  };

  beforeEach(() => {
    renderer = new DOMOverlayRenderer();

    container = document.createElement('div');
    container.id = 'reader-container';
    document.body.appendChild(container);

    image1 = document.createElement('img');
    image1.id = 'page-1';
    image1.src = 'https://example.com/manga/page1.jpg';
    container.appendChild(image1);

    image2 = document.createElement('img');
    image2.id = 'page-2';
    image2.src = 'https://example.com/manga/page2.jpg';
    container.appendChild(image2);
  });

  afterEach(() => {
    renderer.removeAllOverlays();
    vi.unstubAllGlobals();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('Core Contract & Acceptance Criteria', () => {
    it('1. accepts normalized TranslationResult and renders bubbles', () => {
      const outcome = renderer.render(mockResult1, image1);

      expect(outcome).toBeDefined();
      expect(outcome.imageId).toBe('img_page_01');
      expect(outcome.bubbleCount).toBe(3);
      expect(outcome.bubbles).toHaveLength(3);
      expect(renderer.hasOverlay('img_page_01')).toBe(true);
    });

    it('throws KomaError when target image cannot be found', () => {
      const invalidResult: TranslationResult = {
        ...mockResult1,
        imageId: 'non_existent_image',
      };

      expect(() => renderer.render(invalidResult)).toThrow(KomaError);
    });

    it('resolves an unmodified page image from the message target selector', () => {
      const target = resolveTargetImage('#page-1');

      expect(target).toBe(image1);
      expect(target.hasAttribute('data-koma-image-id')).toBe(false);
      expect(() => resolveTargetImage('#reader-container')).toThrow(KomaError);
      expect(() => resolveTargetImage('[')).toThrow(KomaError);
    });

    it('2. converts normalized bounding boxes [0, 1000] correctly to percentage coordinates', () => {
      const outcome = renderer.render(mockResult1, image1);
      const firstBubble = outcome.bubbles[0];

      // box: { ymin: 100, xmin: 200, ymax: 300, xmax: 600 }
      // top: 10.00%, left: 20.00%, width: 40.00%, height: 20.00%
      expect(firstBubble.element.style.top).toMatch(/^10(\.00)?%$/);
      expect(firstBubble.element.style.left).toMatch(/^20(\.00)?%$/);
      expect(firstBubble.element.style.width).toMatch(/^40(\.00)?%$/);
      expect(firstBubble.element.style.height).toMatch(/^20(\.00)?%$/);
    });

    it('3. positions each translation over its corresponding region', () => {
      const outcome = renderer.render(mockResult1, image1);

      const bubble1 = outcome.bubbles.find((b) => b.bubbleId === 'bubble_001');
      const bubble2 = outcome.bubbles.find((b) => b.bubbleId === 'bubble_002');
      const bubble3 = outcome.bubbles.find((b) => b.bubbleId === 'bubble_003');

      expect(bubble1).toBeDefined();
      expect(bubble1?.textElement.textContent).toBe('Apa yang sedang kamu lakukan?');

      expect(bubble2).toBeDefined();
      expect(bubble2?.element.style.top).toMatch(/^50(\.00)?%$/);
      expect(bubble2?.element.style.left).toMatch(/^15(\.00)?%$/);
      expect(bubble2?.textElement.textContent).toBe('Bukan apa-apa...');

      expect(bubble3).toBeDefined();
      expect(bubble3?.element.style.top).toMatch(/^80(\.00)?%$/);
      expect(bubble3?.element.style.left).toMatch(/^5(\.00)?%$/);
      expect(bubble3?.element.style.width).toMatch(/^90(\.00)?%$/);
      expect(bubble3?.textElement.textContent).toBe('Itu adalah cerita di masa lampau.');
    });

    it('4. moves with manga image via relative wrapper during normal scrolling', () => {
      const outcome = renderer.render(mockResult1, image1);
      const wrapper = outcome.wrapperElement;

      expect(wrapper.classList.contains('koma-image-wrapper')).toBe(true);
      expect(wrapper.getAttribute('data-koma-wrapper')).toBe('true');
      expect(wrapper.style.position).toBe('relative');
      expect(image1.parentElement).toBe(wrapper);
      expect(wrapper.parentElement).toBe(container);

      // Overlay layer is absolute within the relative wrapper
      const layer = outcome.overlayLayer;
      expect(layer.style.position).toBe('absolute');
      expect(layer.style.top).toBe('0px');
      expect(layer.style.left).toBe('0px');
      expect(layer.style.width).toBe('100%');
      expect(layer.style.height).toBe('100%');
    });

    it('preserves the image display and margins while wrapped and restores its inline styles', () => {
      image1.style.display = 'block';
      image1.style.margin = '12px auto 8px';

      const outcome = renderer.render(mockResult1, image1);

      expect(outcome.wrapperElement.style.display).toBe('block');
      expect(outcome.wrapperElement.style.marginTop).toBe('12px');
      expect(outcome.wrapperElement.style.marginRight).toBe('auto');
      expect(outcome.wrapperElement.style.marginBottom).toBe('8px');
      expect(outcome.wrapperElement.style.marginLeft).toBe('auto');
      expect(image1.style.marginTop).toBe('0px');

      renderer.removeOverlay(mockResult1.imageId);

      expect(image1.style.margin).toBe('12px auto 8px');
      expect(image1.hasAttribute('data-koma-image-id')).toBe(false);
    });

    it('5 & 6. remains aligned under zoom and resize through percentage coordinates', () => {
      const outcome = renderer.render(mockResult1, image1);
      const bubbleEl = outcome.bubbles[0].element;

      // Ensure style values are strictly percentages, which natively adapt to resize and browser zoom
      expect(bubbleEl.style.top.endsWith('%')).toBe(true);
      expect(bubbleEl.style.left.endsWith('%')).toBe(true);
      expect(bubbleEl.style.width.endsWith('%')).toBe(true);
      expect(bubbleEl.style.height.endsWith('%')).toBe(true);
    });

    it('7. centers or aligns text according to normalized result data', () => {
      const outcome = renderer.render(mockResult1, image1);

      const bubbleCenter = outcome.bubbles.find((b) => b.bubbleId === 'bubble_001');
      const bubbleLeft = outcome.bubbles.find((b) => b.bubbleId === 'bubble_002');
      const bubbleRight = outcome.bubbles.find((b) => b.bubbleId === 'bubble_003');

      expect(bubbleCenter?.textElement.style.textAlign).toBe('center');
      expect(bubbleLeft?.textElement.style.textAlign).toBe('left');
      expect(bubbleRight?.textElement.style.textAlign).toBe('right');
    });

    it('8. decreases font size when translated text exceeds available space', () => {
      // Test 8a: Short text in large box keeps large font size
      const shortTextSize = estimateFittedFontSize('Halo', 200, 100, {
        minFontSize: 8,
        maxFontSize: 18,
      });

      // Test 8b: Long dialogue monologue in small box scales down
      const longMonologue =
        'Tunggu sebentar! Apa yang sedang kau bicarakan di sana? Aku sudah memperingatkanmu berkali-kali tentang bahaya ini!';
      const longTextSize = estimateFittedFontSize(longMonologue, 100, 50, {
        minFontSize: 8,
        maxFontSize: 18,
      });

      expect(longTextSize).toBeLessThan(shortTextSize);
      expect(longTextSize).toBeGreaterThanOrEqual(8);

      // Test 8c: DOM fitTextToBubble integration
      const testBox = document.createElement('div');
      testBox.style.width = '80px';
      testBox.style.height = '40px';
      const testText = document.createElement('div');
      testText.textContent = longMonologue;
      testBox.appendChild(testText);

      const fitted = fitTextToBubble(testText, testBox, { minFontSize: 8, maxFontSize: 18 });
      expect(fitted).toBeLessThan(18);
      expect(fitted).toBeGreaterThanOrEqual(8);
      expect(testText.style.fontSize).toBe(`${fitted}px`);
    });

    it('defers percentage-based font estimation until layout dimensions are measurable', () => {
      const testBox = document.createElement('div');
      testBox.style.width = '40%';
      testBox.style.height = '20%';
      const testText = document.createElement('div');
      testText.textContent = 'A long translation that must not treat 40% as 40 pixels.';
      testBox.appendChild(testText);

      const fitted = fitTextToBubble(testText, testBox, { minFontSize: 8, maxFontSize: 18 });

      expect(fitted).toBe(18);
      expect(testText.style.fontSize).toBe('18px');
    });

    it('refits text when the target image resizes and disconnects the observer on removal', () => {
      let resizeCallback: ResizeObserverCallback = () => {};
      const observe = vi.fn();
      const disconnect = vi.fn();

      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }

      vi.stubGlobal('ResizeObserver', MockResizeObserver);
      const outcome = renderer.render(mockResult1, image1);
      const firstBubble = outcome.bubbles[0];

      Object.defineProperties(firstBubble.element, {
        clientWidth: { configurable: true, value: 100 },
        clientHeight: { configurable: true, value: 50 },
      });
      Object.defineProperties(firstBubble.textElement, {
        scrollHeight: {
          configurable: true,
          get: () => (Number.parseFloat(firstBubble.textElement.style.fontSize) > 8 ? 100 : 40),
        },
        scrollWidth: { configurable: true, value: 80 },
      });

      resizeCallback([], {} as ResizeObserver);

      expect(observe).toHaveBeenCalledWith(image1);
      expect(firstBubble.fontSize).toBe(8);
      expect(firstBubble.textElement.style.fontSize).toBe('8px');

      renderer.removeOverlay(mockResult1.imageId);
      expect(disconnect).toHaveBeenCalledOnce();
    });

    it('9. does not intentionally modify the original manga image', () => {
      const originalSrc = image1.src;
      const originalId = image1.id;

      renderer.render(mockResult1, image1);

      expect(image1.src).toBe(originalSrc);
      expect(image1.id).toBe(originalId);
      expect(image1.tagName).toBe('IMG');
      // Original image node is preserved inside wrapper
      expect(image1.isConnected).toBe(true);
    });

    it('10. removes all overlays cleanly without reloading the page', () => {
      renderer.render(mockResult1, image1);
      renderer.render(mockResult2, image2);

      expect(renderer.hasOverlay('img_page_01')).toBe(true);
      expect(renderer.hasOverlay('img_page_02')).toBe(true);

      // Remove single overlay
      const removedSingle = renderer.removeOverlay('img_page_01');
      expect(removedSingle).toBe(true);
      expect(renderer.hasOverlay('img_page_01')).toBe(false);
      expect(renderer.hasOverlay('img_page_02')).toBe(true);

      // Image1 should be restored back to container without wrapper
      expect(image1.parentElement).toBe(container);

      // Remove all remaining
      renderer.removeAllOverlays();
      expect(renderer.hasOverlay('img_page_02')).toBe(false);
      expect(image2.parentElement).toBe(container);

      // No lingering koma elements
      expect(document.querySelectorAll('.koma-overlay-layer')).toHaveLength(0);
      expect(document.querySelectorAll('.koma-image-wrapper')).toHaveLength(0);
    });

    it('11. does not create duplicate overlays when re-rendering the same result', () => {
      renderer.render(mockResult1, image1);
      expect(document.querySelectorAll('.koma-image-wrapper')).toHaveLength(1);
      expect(document.querySelectorAll('.koma-overlay-layer')).toHaveLength(1);
      expect(document.querySelectorAll('.koma-bubble')).toHaveLength(3);

      // Re-render same image
      renderer.render(mockResult1, image1);

      expect(document.querySelectorAll('.koma-image-wrapper')).toHaveLength(1);
      expect(document.querySelectorAll('.koma-overlay-layer')).toHaveLength(1);
      expect(document.querySelectorAll('.koma-bubble')).toHaveLength(3);
      expect(renderer.getRenderedOverlay('img_page_01')?.bubbleCount).toBe(3);
    });

    it('12. prefixes all overlay DOM elements with koma- classes and data attributes', () => {
      const outcome = renderer.render(mockResult1, image1);

      expect(outcome.wrapperElement.className).toContain('koma-image-wrapper');
      expect(outcome.wrapperElement.getAttribute('data-koma-wrapper')).toBe('true');

      expect(outcome.overlayLayer.className).toContain('koma-overlay-layer');
      expect(outcome.overlayLayer.getAttribute('data-koma-overlay-layer')).toBe('true');

      for (const bubble of outcome.bubbles) {
        expect(bubble.element.className).toMatch(/koma-bubble/);
        expect(bubble.element.getAttribute('data-koma-bubble')).toBe('true');
        expect(bubble.element.getAttribute('data-koma-bubble-id')).toBeTruthy();
        expect(bubble.textElement.className).toContain('koma-bubble-text');
        expect(bubble.textElement.getAttribute('data-koma-bubble-text')).toBe('true');
      }
    });

    it('13. sets !important on core styles to prevent website CSS overrides', () => {
      const outcome = renderer.render(mockResult1, image1);
      const bubbleEl = outcome.bubbles[0].element;

      // Verify !important priority on critical positioning and containment styles
      expect(bubbleEl.style.getPropertyPriority('position')).toBe('important');
      expect(bubbleEl.style.getPropertyPriority('box-sizing')).toBe('important');
      expect(bubbleEl.style.getPropertyPriority('background-color')).toBe('important');
      expect(bubbleEl.style.getPropertyPriority('z-index')).toBe('important');
    });

    it('enables source text inspection via tooltip and data-koma-source-text', () => {
      const outcome = renderer.render(mockResult1, image1);
      const bubbleWithSource = outcome.bubbles[0].element;

      expect(bubbleWithSource.getAttribute('data-koma-source-text')).toBe('何をしているんだ？');
      expect(bubbleWithSource.title).toBe('Original: 何をしているんだ？');
      expect(bubbleWithSource.tabIndex).toBe(0);
      expect(bubbleWithSource.getAttribute('aria-label')).toContain('Original: 何をしているんだ？');
    });
  });
});

describe('KOMA-017: artwork inspection and clipped-text fallback', () => {
  let renderer: DOMOverlayRenderer;
  let container: HTMLDivElement;
  let image: HTMLImageElement;

  const pageResult = (bubbles: TranslationResult['bubbles']): TranslationResult => ({
    pageId: 'chapter_01',
    imageId: 'img_page_01',
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles,
  });

  const bubble = (id: string, overrides: Partial<TranslationResult['bubbles'][number]> = {}) => ({
    id,
    box: { ymin: 100, xmin: 200, ymax: 300, xmax: 600 },
    sourceText: '待て',
    translatedText: 'Tunggu',
    bubbleType: 'speech' as const,
    ...overrides,
  });

  /** jsdom has no layout engine, so geometry is mocked the way a browser would report it. */
  function mockLayout(options: { overflow: boolean; width?: number; height?: number }): void {
    const width = options.width ?? 300;
    const height = options.height ?? 60;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
      options.overflow ? height + 80 : height - 10
    );
  }

  beforeEach(() => {
    renderer = new DOMOverlayRenderer();
    container = document.createElement('div');
    document.body.appendChild(container);
    image = document.createElement('img');
    image.src = 'https://example.com/manga/page1.jpg';
    container.appendChild(image);
  });

  afterEach(() => {
    renderer.removeAllOverlays();
    vi.restoreAllMocks();
    container.remove();
  });

  it('reveals the untouched artwork on hover and restores it on leave', () => {
    mockLayout({ overflow: false });
    const patch = renderer.render(pageResult([bubble('bubble_001')]), image).bubbles[0];
    const paintedBackground = patch.element.style.getPropertyValue('background-color');
    const paintedText = patch.textElement.style.getPropertyValue('color');

    expect(paintedBackground).not.toBe('transparent');
    patch.element.dispatchEvent(new Event('pointerenter'));
    expect(patch.element.style.getPropertyValue('background-color')).toBe('transparent');
    expect(patch.element.style.getPropertyValue('border-color')).toBe('transparent');
    expect(patch.textElement.style.getPropertyValue('color')).toBe('transparent');
    expect(patch.element.tabIndex).toBe(0);

    patch.element.dispatchEvent(new Event('pointerleave'));
    expect(patch.element.style.getPropertyValue('background-color')).toBe(paintedBackground);
    expect(patch.element.style.getPropertyPriority('background-color')).toBe('important');
    expect(patch.textElement.style.getPropertyValue('color')).toBe(paintedText);
    expect(patch.inspected).toBe(false);
  });

  it('toggles inspection from the keyboard and restores it with Escape', () => {
    mockLayout({ overflow: false });
    const patch = renderer.render(pageResult([bubble('bubble_001')]), image).bubbles[0];

    const press = (key: string) =>
      patch.element.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );

    press(' ');
    expect(patch.inspected).toBe(true);
    expect(patch.element.style.getPropertyValue('background-color')).toBe('transparent');

    press('Escape');
    expect(patch.inspected).toBe(false);
    expect(patch.element.style.getPropertyValue('background-color')).toBe(
      'rgba(255, 255, 255, 0.96)'
    );
    expect(patch.element.style.getPropertyPriority('background-color')).toBe('important');

    press('Enter');
    expect(patch.inspected).toBe(true);
    press('Enter');
    expect(patch.inspected).toBe(false);

    // A deliberate keyboard reveal outlives the pointer, so a stray mouse move cannot cancel it.
    press('Enter');
    expect(patch.inspected).toBe(true);
    patch.element.dispatchEvent(new Event('pointerleave'));
    expect(patch.inspected).toBe(true);
    patch.element.dispatchEvent(new Event('pointerenter'));
    patch.element.dispatchEvent(new Event('pointerleave'));
    expect(patch.inspected).toBe(true);
    press('Escape');
    expect(patch.inspected).toBe(false);
    expect(patch.toggledInspection).toBe(false);
  });

  it('adds a fallback affordance only when fitted text still overflows the patch', () => {
    mockLayout({ overflow: true });
    const clipped = renderer.render(
      pageResult([bubble('bubble_001'), bubble('bubble_002')]),
      image
    );
    expect(clipped.bubbles.every((entry) => entry.clipIndicator?.isConnected)).toBe(true);
    const chip = clipped.bubbles[0].clipIndicator!;
    expect(chip.textContent).toBe('Show all');
    expect(chip.getAttribute('aria-label')).toBe(
      'Show the complete translation and the original text'
    );
    expect(chip.getAttribute('data-koma-clip-indicator')).toBe('bubble_001');
    // The patch clips its own overflow, so the chip must hang off the layer to stay clickable.
    expect(chip.parentElement).toBe(clipped.overlayLayer);
    expect(chip.style.getPropertyValue('top')).toBe('30%');
    expect(chip.style.getPropertyValue('left')).toBe('60%');

    renderer.removeAllOverlays();
    mockLayout({ overflow: false });
    const fits = renderer.render(pageResult([bubble('bubble_001')]), image);
    expect(fits.bubbles[0].clipIndicator).toBeUndefined();
    expect(fits.overlayLayer.querySelector('[data-koma-clip-indicator]')).toBeNull();
  });

  it('opens the complete translation readout with source text and closes it with Escape', () => {
    mockLayout({ overflow: true, width: 320, height: 90 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 330,
      bottom: 110,
      width: 320,
      height: 90,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const outcome = renderer.render(
      pageResult([
        bubble('bubble_001'),
        bubble('bubble_002', { sourceText: undefined, translatedText: 'Lari!' }),
      ]),
      image
    );

    (outcome.bubbles[0].clipIndicator as HTMLElement).click();
    const panel = outcome.overlayLayer.querySelector<HTMLElement>('[data-koma-bubble-readout]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Tunggu');
    expect(panel!.textContent).toContain('Original: 待て');
    expect(document.activeElement).toBe(panel);
    expect(panel!.style.getPropertyPriority('pointer-events')).toBe('important');

    // A second readout replaces the first, and a bubble without source text invents none.
    (outcome.bubbles[1].clipIndicator as HTMLElement).click();
    expect(outcome.overlayLayer.querySelectorAll('[data-koma-bubble-readout]')).toHaveLength(1);
    const second = outcome.overlayLayer.querySelector<HTMLElement>('[data-koma-bubble-readout]')!;
    expect(second.textContent).toContain('Lari!');
    expect(second.textContent).not.toContain('Original:');

    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outcome.overlayLayer.querySelector('[data-koma-bubble-readout]')).toBeNull();
    expect(document.activeElement).toBe(outcome.bubbles[1].element);

    // Escape from inside the panel also restores the artwork behind its patch.
    const patch = outcome.bubbles[0];
    patch.element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(patch.inspected).toBe(true);
    (patch.clipIndicator as HTMLElement).click();
    const reopened = outcome.overlayLayer.querySelector<HTMLElement>('[data-koma-bubble-readout]')!;
    reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(patch.inspected).toBe(false);
    expect(outcome.overlayLayer.querySelector('[data-koma-bubble-readout]')).toBeNull();
  });

  it('keeps the fallback affordance operable while the artwork is being inspected', () => {
    mockLayout({ overflow: true, width: 320, height: 90 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 330,
      bottom: 110,
      width: 320,
      height: 90,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const patch = renderer.render(pageResult([bubble('bubble_001')]), image).bubbles[0];

    patch.element.dispatchEvent(new Event('pointerenter'));
    expect(patch.inspected).toBe(true);
    expect(patch.clipIndicator!.style.getPropertyValue('visibility')).toBe('');

    patch.clipIndicator!.click();
    expect(patch.readoutElement?.isConnected).toBe(true);
    expect(patch.element.style.getPropertyValue('background-color')).toBe('transparent');
  });

  it('keeps one focus-visible rule set on the layer across re-renders', () => {
    mockLayout({ overflow: false });
    renderer.render(pageResult([bubble('bubble_001')]), image);
    const first = container.querySelectorAll('[data-koma-inspection-styles]');
    expect(first).toHaveLength(1);
    expect(first[0].textContent).toContain('[data-koma-bubble]:focus-visible');

    renderer.render(pageResult([bubble('bubble_001'), bubble('bubble_002')]), image);
    const second = container.querySelectorAll('[data-koma-inspection-styles]');
    expect(second).toHaveLength(1);

    const disabled = new DOMOverlayRenderer({ enableInspection: false });
    const plain = disabled.render(pageResult([bubble('bubble_001')]), image);
    expect(container.querySelector('[data-koma-inspection-styles]')).toBeNull();
    expect(container.querySelectorAll('[data-koma-clip-indicator]')).toHaveLength(0);
    expect(plain.bubbles[0].element.getAttribute('data-koma-bubble-inspectable')).toBeNull();
    disabled.removeAllOverlays();
  });

  it('removes inspection state and fallbacks with the overlay', () => {
    mockLayout({ overflow: true });
    const outcome = renderer.render(pageResult([bubble('bubble_001')]), image);
    (outcome.bubbles[0].clipIndicator as HTMLElement).click();

    expect(renderer.removeOverlay('img_page_01')).toBe(true);
    expect(container.querySelector('[data-koma-overlay-layer]')).toBeNull();
    expect(container.querySelector('[data-koma-clip-indicator]')).toBeNull();
    expect(container.querySelector('[data-koma-bubble-readout]')).toBeNull();
    expect(container.querySelector('[data-koma-image-id]')).toBeNull();
  });

  it('pins the overlay layer to the image box when the wrapper is wider than the artwork', () => {
    mockLayout({ overflow: false });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const isImage = this.tagName === 'IMG';
      const box = isImage
        ? { left: 12, top: 40, width: 400, height: 600 }
        : { left: 0, top: 0, width: 885, height: 600 };
      return {
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const outcome = renderer.render(pageResult([bubble('bubble_001')]), image);
    const layer = outcome.overlayLayer;
    expect(layer.style.getPropertyValue('width')).toBe('400px');
    expect(layer.style.getPropertyValue('height')).toBe('600px');
    expect(layer.style.getPropertyValue('left')).toBe('12px');
    expect(layer.style.getPropertyValue('top')).toBe('40px');

    // A bubble at x 20% must land at 20% of the artwork, not of the surrounding column.
    const patch = outcome.bubbles[0].element;
    expect(patch.style.getPropertyValue('left')).toBe('20%');
    expect(patch.style.getPropertyValue('width')).toBe('40%');
  });

  it('falls back to filling the wrapper while the image has no measurable box', () => {
    mockLayout({ overflow: false });
    const outcome = renderer.render(pageResult([bubble('bubble_001')]), image);
    expect(outcome.overlayLayer.style.getPropertyValue('width')).toBe('100%');
    expect(outcome.overlayLayer.style.getPropertyValue('height')).toBe('100%');
    expect(outcome.overlayLayer.style.getPropertyValue('left')).toBe('0px');
    expect(outcome.overlayLayer.style.getPropertyValue('top')).toBe('0px');
  });

  it('measures placement drift and reports nothing for bubbles that render nothing', () => {
    mockLayout({ overflow: false, width: 800, height: 1200 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      // Project style percentages the way a browser would.
      const fraction = (value: string) => (value.endsWith('%') ? parseFloat(value) / 100 : 0);
      const left = 10 + 800 * fraction(this.style.left);
      const top = 20 + 1200 * fraction(this.style.top);
      return {
        left,
        top,
        right: left + 800,
        bottom: top + 1200,
        width: 800,
        height: 1200,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    renderer.render(pageResult([bubble('bubble_001'), bubble('bubble_002')]), image);
    const drift = renderer.measureLayoutDrift('img_page_01');
    expect(drift).not.toBeNull();
    expect(drift!.bubbles).toHaveLength(2);
    expect(drift!.maxDriftPercent).toBeLessThanOrEqual(2);
    expect(drift!.maxDriftPercent).toBe(0);

    renderer.removeAllOverlays();
    const empty = renderer.render(pageResult([]), image);
    expect(empty.bubbleCount).toBe(0);
    expect(renderer.measureLayoutDrift('img_page_01')!.bubbles).toHaveLength(0);
    expect(renderer.measureLayoutDrift('missing')).toBeNull();
  });
});
