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
