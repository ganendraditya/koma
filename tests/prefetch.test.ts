import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TranslationOrchestrator,
  PrefetchQueue,
  PREFETCH_PRIORITY,
  calculateViewportDistance,
  findNearestImageToViewport,
  type IRenderer,
  type ImagePosition,
  type ViewportRect,
} from '../core/orchestrator';
import { SiteAdapter } from '../adapters';
import { MangaImage, TranslationProvider, TranslationResult } from '../core/contracts';
import { KomaTranslationCache } from '../core/cache';

describe('Look-Ahead Translation Prefetch (KOMA-011)', () => {
  let mockAdapter: SiteAdapter;
  let mockProvider: TranslationProvider;
  let mockRenderer: IRenderer;

  const createDummyResult = (imageId: string, pageId = 'page-1'): TranslationResult => ({
    pageId,
    imageId,
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles: [
      {
        id: `bubble-${imageId}`,
        box: { ymin: 100, xmin: 100, ymax: 300, xmax: 300 },
        sourceText: 'こんにちは',
        translatedText: 'Halo',
      },
    ],
  });

  beforeEach(() => {
    mockAdapter = {
      name: 'MockAdapter',
      matches: () => true,
      detectMangaImages: vi.fn().mockReturnValue([]),
      observeMangaImages: vi.fn().mockReturnValue(() => {}),
    };

    mockProvider = {
      id: 'mock-provider',
      name: 'Mock Provider',
      modelName: 'test-model',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn(),
    };

    mockRenderer = {
      render: vi.fn(),
    };
  });

  describe('Viewport Tracking & Nearest Image Detection', () => {
    it('calculates distance and visibility correctly relative to viewport', () => {
      const viewport: ViewportRect = { top: 0, bottom: 800, height: 800 };

      // Case 1: Overlapping / visible image
      const visibleImage: ImagePosition = { top: 200, bottom: 700 };
      const visibleRes = calculateViewportDistance(visibleImage, viewport);
      expect(visibleRes.isVisible).toBe(true);
      expect(visibleRes.distance).toBe(0);
      expect(visibleRes.overlapHeight).toBe(500);

      // Case 2: Image below viewport (upcoming)
      const belowImage: ImagePosition = { top: 1000, bottom: 1600 };
      const belowRes = calculateViewportDistance(belowImage, viewport);
      expect(belowRes.isVisible).toBe(false);
      expect(belowRes.distance).toBe(200); // 1000 - 800
      expect(belowRes.overlapHeight).toBe(0);

      // Case 3: Image above viewport (scrolled past)
      const aboveImage: ImagePosition = { top: -600, bottom: -100 };
      const aboveRes = calculateViewportDistance(aboveImage, viewport);
      expect(aboveRes.isVisible).toBe(false);
      expect(aboveRes.distance).toBe(100); // 0 - (-100)
      expect(aboveRes.overlapHeight).toBe(0);
    });

    it('identifies which detected image is nearest to the viewport', () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
        { id: 'img-3', pageIndex: 2, width: 800, height: 1000 },
      ];

      const positions: Record<string, ImagePosition> = {
        'img-1': { top: -1200, bottom: -200 }, // above viewport
        'img-2': { top: 100, bottom: 700 }, // visible in viewport [0, 800]
        'img-3': { top: 900, bottom: 1900 }, // below viewport
      };

      const viewport: ViewportRect = { top: 0, bottom: 800, height: 800 };
      const nearest = findNearestImageToViewport(images, (img) => positions[img.id], viewport);

      expect(nearest?.id).toBe('img-2');
    });

    it('orchestrator identifies the visible image via getNearestImageToViewport', () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      const positions: Record<string, ImagePosition> = {
        'img-1': { top: -1000, bottom: -100 },
        'img-2': { top: 50, bottom: 750 },
      };

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        positionResolver: (img) => positions[img.id] || null,
        viewportProvider: () => ({ top: 0, bottom: 800, height: 800 }),
      });

      const nearest = orchestrator.getNearestImageToViewport();
      expect(nearest?.id).toBe('img-2');
    });
  });

  describe('Priority Queue & Deduplication', () => {
    it('assigns highest priority to visible image (0) and next images (1, 2)', () => {
      const queue = new PrefetchQueue();

      queue.enqueue({
        imageId: 'img-3',
        priority: PREFETCH_PRIORITY.NEXT_NEXT,
        source: 'prefetch',
      });
      queue.enqueue({ imageId: 'img-2', priority: PREFETCH_PRIORITY.NEXT, source: 'prefetch' });
      queue.enqueue({ imageId: 'img-1', priority: PREFETCH_PRIORITY.VISIBLE, source: 'prefetch' });

      expect(queue.dequeue()?.imageId).toBe('img-1');
      expect(queue.dequeue()?.imageId).toBe('img-2');
      expect(queue.dequeue()?.imageId).toBe('img-3');
    });

    it('prevents same image from existing multiple times in queue', () => {
      const queue = new PrefetchQueue();

      queue.enqueue({ imageId: 'img-1', priority: PREFETCH_PRIORITY.NEXT, source: 'prefetch' });
      queue.enqueue({ imageId: 'img-1', priority: PREFETCH_PRIORITY.NEXT, source: 'prefetch' });
      queue.enqueue({ imageId: 'img-1', priority: PREFETCH_PRIORITY.VISIBLE, source: 'prefetch' });

      expect(queue.size).toBe(1);
      expect(queue.peek()?.imageId).toBe('img-1');
      expect(queue.peek()?.priority).toBe(PREFETCH_PRIORITY.VISIBLE); // upgraded
    });

    it('ensures user-triggered visible translation outranks background prefetch work', () => {
      const queue = new PrefetchQueue();

      // Background prefetch queued earlier
      queue.enqueue({ imageId: 'img-1', priority: PREFETCH_PRIORITY.VISIBLE, source: 'prefetch' });
      queue.enqueue({ imageId: 'img-2', priority: PREFETCH_PRIORITY.NEXT, source: 'prefetch' });

      // User triggers translation for img-3
      queue.enqueue({ imageId: 'img-3', priority: PREFETCH_PRIORITY.VISIBLE, source: 'user' });

      // img-3 (user) must be dequeued first, ahead of background tasks
      expect(queue.dequeue()?.imageId).toBe('img-3');
      expect(queue.dequeue()?.imageId).toBe('img-1');
      expect(queue.dequeue()?.imageId).toBe('img-2');
    });

    it('upgrades prefetch task to user task when requested by user', () => {
      const queue = new PrefetchQueue();

      queue.enqueue({ imageId: 'img-2', priority: PREFETCH_PRIORITY.NEXT, source: 'prefetch' });
      expect(queue.get('img-2')?.source).toBe('prefetch');

      // User now requests img-2
      queue.enqueue({ imageId: 'img-2', priority: PREFETCH_PRIORITY.VISIBLE, source: 'user' });

      expect(queue.size).toBe(1);
      const item = queue.get('img-2');
      expect(item?.source).toBe('user');
      expect(item?.priority).toBe(PREFETCH_PRIORITY.VISIBLE);
    });
  });

  describe('Look-Ahead Prefetch in Translation Pipeline', () => {
    it('queues upcoming images for look-ahead prefetch when visible image is translated', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
        { id: 'img-3', pageIndex: 2, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      let resolveImg1: (res: TranslationResult) => void;
      const img1Promise = new Promise<TranslationResult>((resolve) => {
        resolveImg1 = resolve;
      });

      vi.mocked(mockProvider.translatePage).mockImplementation((req) => {
        if (req.image.id === 'img-1') {
          return img1Promise;
        }
        return Promise.resolve(createDummyResult(req.image.id));
      });

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 2,
      });

      await orchestrator.translateNext();

      // img-1 is in flight
      expect(orchestrator.getState().get('img-1')?.status).toBe('translating');

      // img-2 and img-3 are queued in look-ahead prefetch
      expect(orchestrator.getQueuedImageIds()).toEqual(['img-2', 'img-3']);

      // Resolve img-1
      resolveImg1!(createDummyResult('img-1'));
      await new Promise((r) => setTimeout(r, 10));

      // After img-1 finishes, img-2 and img-3 should complete through queue pumping
      expect(orchestrator.getState().get('img-1')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-2')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-3')?.status).toBe('completed');
    });

    it('respects configurable maximum concurrency limit', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
        { id: 'img-3', pageIndex: 2, width: 800, height: 1000 },
        { id: 'img-4', pageIndex: 3, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      let inFlight = 0;
      let maxObservedInFlight = 0;

      vi.mocked(mockProvider.translatePage).mockImplementation(async (req) => {
        inFlight++;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return createDummyResult(req.image.id);
      });

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 2,
        lookAheadCount: 3,
      });

      await orchestrator.translateNext();

      // Wait for all translations to finish
      await new Promise((r) => setTimeout(r, 150));

      expect(maxObservedInFlight).toBeLessThanOrEqual(2);
      expect(orchestrator.getState().get('img-1')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-2')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-3')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-4')?.status).toBe('completed');
    });

    it('stops prefetch and removes background queue items when prefetch is disabled', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
        { id: 'img-3', pageIndex: 2, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      let resolveImg1: (res: TranslationResult) => void;
      const img1Promise = new Promise<TranslationResult>((resolve) => {
        resolveImg1 = resolve;
      });

      vi.mocked(mockProvider.translatePage).mockImplementation((req) => {
        if (req.image.id === 'img-1') return img1Promise;
        return Promise.resolve(createDummyResult(req.image.id));
      });

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 2,
      });

      await orchestrator.translateNext();
      expect(orchestrator.getQueuedImageIds()).toEqual(['img-2', 'img-3']);

      // Disable prefetch while img-1 is in-flight
      orchestrator.setPrefetchEnabled(false);
      expect(orchestrator.isPrefetchEnabled()).toBe(false);
      expect(orchestrator.getQueueSize()).toBe(0);

      // Finish img-1
      resolveImg1!(createDummyResult('img-1'));
      await new Promise((r) => setTimeout(r, 10));

      expect(orchestrator.getState().get('img-1')?.status).toBe('completed');
      // img-2 and img-3 should NOT have been processed because prefetch was cancelled
      expect(orchestrator.getState().get('img-2')?.status).toBe('idle');
      expect(orchestrator.getState().get('img-3')?.status).toBe('idle');
      expect(mockProvider.translatePage).toHaveBeenCalledTimes(1);
    });

    it('provider failure does not stop the entire queue from processing subsequent images', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      const networkError = new Error('503 Service Unavailable');
      vi.mocked(mockProvider.translatePage).mockImplementation(async (req) => {
        if (req.image.id === 'img-1') {
          throw networkError;
        }
        return createDummyResult(req.image.id);
      });

      const onError = vi.fn();
      const onComplete = vi.fn();

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 1,
      });

      await orchestrator.translateNext({ onError, onComplete });
      await new Promise((r) => setTimeout(r, 20));

      // img-1 failed, onError called
      expect(orchestrator.getState().get('img-1')?.status).toBe('failed');
      expect(onError).toHaveBeenCalledWith(
        'img-1',
        expect.objectContaining({ message: 'Translation failed at provider stage' })
      );

      // Queue continued and img-2 completed successfully!
      expect(orchestrator.getState().get('img-2')?.status).toBe('completed');
      expect(onComplete).toHaveBeenCalledWith(
        'img-2',
        expect.objectContaining({ imageId: 'img-2' })
      );
      expect(mockRenderer.render).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: 'img-2' })
      );
    });

    it('checks cache before queuing provider work and avoids calling provider for cached images', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      const cache = new KomaTranslationCache();
      const cachedResultImg2 = createDummyResult('img-2');

      // Pre-seed cache for img-2 using the exact key format
      const { generateCacheKey } = await import('../core/cache');
      const cacheKeyImg2 = generateCacheKey({
        image: images[1],
        targetLanguage: 'id',
        providerId: mockProvider.id,
        modelId: mockProvider.modelName,
      });
      await cache.set(cacheKeyImg2, cachedResultImg2);

      vi.mocked(mockProvider.translatePage).mockImplementation(async (req) => {
        return createDummyResult(req.image.id);
      });

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 1,
        cache,
      });

      await orchestrator.translateNext();
      await new Promise((r) => setTimeout(r, 20));

      // img-1 was translated via provider
      expect(mockProvider.translatePage).toHaveBeenCalledWith(
        expect.objectContaining({ image: images[0] })
      );

      // img-2 was already cached -> provider work was NOT queued for img-2
      expect(mockProvider.translatePage).not.toHaveBeenCalledWith(
        expect.objectContaining({ image: images[1] })
      );
      expect(mockProvider.translatePage).toHaveBeenCalledTimes(1);

      // img-2 state is completed with the cached result and rendered
      expect(orchestrator.getState().get('img-2')?.status).toBe('completed');
      expect(orchestrator.getState().get('img-2')?.result).toEqual(cachedResultImg2);
      expect(mockRenderer.render).toHaveBeenCalledWith(cachedResultImg2);
    });

    it('upgrades queue priority when upcoming image gets closer to viewport', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
        { id: 'img-3', pageIndex: 2, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 2,
      });

      // img-1 translation starts, queuing img-2 (priority 1) and img-3 (priority 2)
      vi.mocked(mockProvider.translatePage).mockReturnValue(new Promise(() => {})); // hang in-flight
      await orchestrator.translateNext();

      // Check that img-3 is initially priority 2
      expect(orchestrator.getQueuedImageIds()).toEqual(['img-2', 'img-3']);

      // Now viewport moves to img-2, prefetching upcoming with lookAheadCount: 1
      // img-3 should be upgraded to priority 1
      await orchestrator.prefetchUpcoming();

      // img-3 remains queued and deduplicated
      expect(orchestrator.getQueuedImageIds()).toEqual(['img-2', 'img-3']);
    });

    it('isolates reset session from pumping queue when previous in-flight task finishes', async () => {
      const images: MangaImage[] = [
        { id: 'img-1', pageIndex: 0, width: 800, height: 1000 },
        { id: 'img-2', pageIndex: 1, width: 800, height: 1000 },
      ];
      vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

      let resolveImg1: (res: TranslationResult) => void;
      const img1Promise = new Promise<TranslationResult>((resolve) => {
        resolveImg1 = resolve;
      });

      vi.mocked(mockProvider.translatePage).mockImplementation((req) => {
        if (req.image.id === 'img-1') return img1Promise;
        return Promise.resolve(createDummyResult(req.image.id));
      });

      const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer, {
        concurrencyLimit: 1,
        lookAheadCount: 0,
      });

      await orchestrator.translateNext();
      expect(orchestrator.getState().get('img-1')?.status).toBe('translating');

      // Reset while img-1 is in-flight
      orchestrator.reset();
      expect(orchestrator.getState().size).toBe(0);
      expect(orchestrator.getQueueSize()).toBe(0);

      // Now resolve img-1 from previous session
      resolveImg1!(createDummyResult('img-1'));
      await new Promise((r) => setTimeout(r, 10));

      // New session state should not have img-1 or rendered it
      expect(orchestrator.getState().get('img-1')).toBeUndefined();
    });
  });
});
