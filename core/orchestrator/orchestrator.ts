import { MangaImage, TranslationProvider, TranslationResult } from '@core/contracts';
import { generateCacheKey, TranslationCache } from '@core/cache';
import { SiteAdapter } from '@adapters';
import {
  ITranslationOrchestrator,
  IRenderer,
  OrchestratorOptions,
  ImageTranslationState,
  OrchestratorEventHandler,
} from './types';
import { PrefetchQueue, PREFETCH_PRIORITY, QueueItem } from './prefetch-queue';
import {
  defaultResolveImagePosition,
  findNearestImageToViewport,
  getDefaultViewport,
} from './viewport';

export class TranslationOrchestrator implements ITranslationOrchestrator {
  private readonly provider: TranslationProvider;
  private readonly adapter: SiteAdapter;
  private readonly renderer: IRenderer;
  private readonly options: OrchestratorOptions;
  private readonly queue: PrefetchQueue = new PrefetchQueue();

  private stateMap: Map<string, ImageTranslationState> = new Map();
  private inFlightCount = 0;
  private sessionId = 0;
  private prefetchEnabled = true;
  private translationEnabled = true;

  constructor(
    provider: TranslationProvider,
    adapter: SiteAdapter,
    renderer: IRenderer,
    options: OrchestratorOptions = {}
  ) {
    this.provider = provider;
    this.adapter = adapter;
    this.renderer = renderer;
    this.options = {
      concurrencyLimit: options.concurrencyLimit ?? 1,
      targetLanguage: options.targetLanguage ?? 'id',
      lookAheadCount: options.lookAheadCount ?? 2,
      prefetchEnabled: options.prefetchEnabled ?? true,
      cache: options.cache,
      positionResolver: options.positionResolver,
      viewportProvider: options.viewportProvider,
    };
    this.prefetchEnabled = this.options.prefetchEnabled ?? true;
  }

  public getState(): Map<string, ImageTranslationState> {
    return new Map(this.stateMap);
  }

  public reset(): void {
    this.sessionId++;
    this.stateMap.clear();
    this.queue.clear();
    this.inFlightCount = 0;
  }

  public setPrefetchEnabled(enabled: boolean): void {
    this.prefetchEnabled = enabled;
    if (!enabled) {
      this.queue.removePrefetchTasks();
    } else if (this.translationEnabled) {
      this.prefetchUpcoming().catch(() => {});
    }
  }

  public isPrefetchEnabled(): boolean {
    return this.prefetchEnabled;
  }

  public setTranslationEnabled(enabled: boolean): void {
    this.translationEnabled = enabled;
    if (!enabled) {
      this.queue.removePrefetchTasks();
    }
  }

  public isTranslationEnabled(): boolean {
    return this.translationEnabled;
  }

  public getQueueSize(): number {
    return this.queue.size;
  }

  public getQueuedImageIds(): string[] {
    return this.queue.getQueuedImageIds();
  }

  public getNearestImageToViewport(images?: MangaImage[]): MangaImage | null {
    const list = images ?? this.adapter.detectMangaImages();
    if (!list || list.length === 0) return null;

    const viewport = this.options.viewportProvider
      ? this.options.viewportProvider()
      : getDefaultViewport();

    const resolvePos = this.options.positionResolver
      ? this.options.positionResolver
      : (img: MangaImage) => defaultResolveImagePosition(img, this.adapter);

    return findNearestImageToViewport(list, resolvePos, viewport);
  }

  private updateState(
    imageId: string,
    partial: Partial<ImageTranslationState>,
    handler?: OrchestratorEventHandler
  ): ImageTranslationState {
    const existing = this.stateMap.get(imageId) || { imageId, status: 'idle' };
    const updated: ImageTranslationState = { ...existing, ...partial };
    this.stateMap.set(imageId, updated);

    if (handler?.onProgress) {
      try {
        handler.onProgress(updated);
      } catch (e) {
        console.error('[Koma Orchestrator] onProgress callback threw:', e);
      }
    }

    return updated;
  }

  private getCacheInstance(): TranslationCache | undefined {
    if (this.options.cache) {
      return this.options.cache;
    }
    if ('cache' in this.provider && (this.provider as { cache?: TranslationCache }).cache) {
      return (this.provider as { cache: TranslationCache }).cache;
    }
    return undefined;
  }

  private async checkCache(image: MangaImage): Promise<TranslationResult | null> {
    const cache = this.getCacheInstance();
    if (!cache) return null;

    const key = generateCacheKey({
      image,
      targetLanguage: this.options.targetLanguage ?? 'id',
      providerId: this.provider.id,
      modelId: this.provider.modelName,
    });

    try {
      return await cache.get(key);
    } catch {
      return null;
    }
  }

  public async translateNext(handler?: OrchestratorEventHandler): Promise<boolean> {
    if (!this.translationEnabled) {
      return false;
    }

    const images = this.adapter.detectMangaImages();
    if (!images || images.length === 0) {
      return false;
    }

    let discoveredNew = false;
    for (const img of images) {
      if (!this.stateMap.has(img.id)) {
        this.updateState(img.id, { status: 'idle' }, handler);
        discoveredNew = true;
      }
    }

    const sortedImages = [...images].sort((a, b) => a.pageIndex - b.pageIndex);
    const nearestImage = this.getNearestImageToViewport(sortedImages) || sortedImages[0];
    const nearestIndex = sortedImages.findIndex((img) => img.id === nearestImage.id);

    // Find the next untranslated image starting at the visible image
    let targetImage: MangaImage | undefined;
    for (let i = 0; i < sortedImages.length; i++) {
      const idx = (nearestIndex + i) % sortedImages.length;
      const candidate = sortedImages[idx];
      const state = this.stateMap.get(candidate.id);
      if (state && state.status === 'idle') {
        targetImage = candidate;
        break;
      }
    }

    let queuedAny = false;

    if (targetImage) {
      // Check cache before queuing provider work
      const cached = await this.checkCache(targetImage);
      if (cached) {
        this.updateState(targetImage.id, { status: 'completed', result: cached }, handler);
        try {
          this.renderer.render(cached);
        } catch (renderError) {
          console.error('[Koma Orchestrator] Rendering cached result failed:', renderError);
        }
        if (handler?.onComplete) {
          handler.onComplete(targetImage.id, cached);
        }
      } else {
        // Enqueue user-triggered translation with highest priority (0)
        this.queue.enqueue({
          imageId: targetImage.id,
          priority: PREFETCH_PRIORITY.VISIBLE,
          source: 'user',
          handler,
        });
        queuedAny = true;
      }
    }

    // Look-ahead prefetch upcoming images
    if (this.prefetchEnabled && this.translationEnabled) {
      await this.prefetchUpcomingImages(sortedImages, targetImage ?? nearestImage, handler);
    }

    this.pumpQueue();
    return queuedAny || discoveredNew;
  }

  public async translateVisible(handler?: OrchestratorEventHandler): Promise<boolean> {
    return this.translateNext(handler);
  }

  public async prefetchUpcoming(handler?: OrchestratorEventHandler): Promise<string[]> {
    if (!this.prefetchEnabled || !this.translationEnabled) {
      return [];
    }

    const images = this.adapter.detectMangaImages();
    if (!images || images.length === 0) {
      return [];
    }

    for (const img of images) {
      if (!this.stateMap.has(img.id)) {
        this.updateState(img.id, { status: 'idle' }, handler);
      }
    }

    const sortedImages = [...images].sort((a, b) => a.pageIndex - b.pageIndex);
    const nearestImage = this.getNearestImageToViewport(sortedImages) || sortedImages[0];

    const queued = await this.prefetchUpcomingImages(sortedImages, nearestImage, handler);
    this.pumpQueue();
    return queued;
  }

  private async prefetchUpcomingImages(
    sortedImages: MangaImage[],
    referenceImage: MangaImage,
    handler?: OrchestratorEventHandler
  ): Promise<string[]> {
    if (!this.prefetchEnabled || !this.translationEnabled) {
      return [];
    }

    const refIndex = sortedImages.findIndex((img) => img.id === referenceImage.id);
    if (refIndex < 0) return [];

    const lookAheadCount = this.options.lookAheadCount ?? 2;
    const queuedIds: string[] = [];

    for (let offset = 1; offset <= lookAheadCount; offset++) {
      const upcomingIndex = refIndex + offset;
      if (upcomingIndex >= sortedImages.length) break;

      const upcomingImg = sortedImages[upcomingIndex];
      const state = this.stateMap.get(upcomingImg.id);

      if (state && (state.status === 'translating' || state.status === 'completed')) {
        continue;
      }

      // Check cache before queuing provider work
      const cached = await this.checkCache(upcomingImg);
      if (cached) {
        this.updateState(upcomingImg.id, { status: 'completed', result: cached }, handler);
        try {
          this.renderer.render(cached);
        } catch (renderError) {
          console.error(
            '[Koma Orchestrator] Rendering cached prefetch result failed:',
            renderError
          );
        }
        if (handler?.onComplete) {
          try {
            handler.onComplete(upcomingImg.id, cached);
          } catch (e) {
            console.error('[Koma Orchestrator] onComplete callback threw:', e);
          }
        }
        continue;
      }

      // Look-ahead priorities: 1 for next image, 2 for next-next image
      const priority =
        offset === 1
          ? PREFETCH_PRIORITY.NEXT
          : offset === 2
            ? PREFETCH_PRIORITY.NEXT_NEXT
            : PREFETCH_PRIORITY.BACKGROUND;

      this.queue.enqueue({
        imageId: upcomingImg.id,
        priority,
        source: 'prefetch',
        handler,
      });
      queuedIds.push(upcomingImg.id);
    }

    return queuedIds;
  }

  public async retry(imageId: string, handler?: OrchestratorEventHandler): Promise<boolean> {
    const state = this.stateMap.get(imageId);
    if (!state || state.status !== 'failed') {
      return false;
    }

    // User-requested retry gets high priority
    this.queue.enqueue({
      imageId,
      priority: PREFETCH_PRIORITY.VISIBLE,
      source: 'user',
      handler,
    });

    this.pumpQueue();
    return true;
  }

  private pumpQueue(): void {
    const limit = this.options.concurrencyLimit || 1;

    while (this.inFlightCount < limit && this.queue.size > 0) {
      const peekTask = this.queue.peek();
      if (!peekTask) break;

      if (peekTask.source === 'prefetch' && (!this.prefetchEnabled || !this.translationEnabled)) {
        this.queue.dequeue();
        continue;
      }

      const task = this.queue.dequeue();
      if (!task) break;

      const state = this.stateMap.get(task.imageId);
      if (state && (state.status === 'completed' || state.status === 'translating')) {
        continue;
      }

      this.inFlightCount++;
      this.executeTask(task).catch((err) => {
        console.error('[Koma Orchestrator] Task execution crashed for', task.imageId, err);
      });
    }
  }

  private async executeTask(task: QueueItem): Promise<boolean> {
    const currentSession = this.sessionId;
    const { imageId, handler } = task;

    this.updateState(imageId, { status: 'translating', error: undefined }, handler);

    try {
      const images = this.adapter.detectMangaImages();
      const targetImage = images.find((img) => img.id === imageId);
      if (!targetImage) {
        const err = new Error(`Image ${imageId} no longer detected by adapter`);
        this.updateState(imageId, { status: 'failed', error: err }, handler);
        if (handler?.onError) handler.onError(imageId, err);
        return false;
      }

      const result = await this.provider.translatePage({
        image: targetImage,
        targetLanguage: this.options.targetLanguage ?? 'id',
      });

      if (this.sessionId !== currentSession) return false;

      this.updateState(imageId, { status: 'completed', result }, handler);

      try {
        this.renderer.render(result);
      } catch (renderError) {
        console.error('[Koma Orchestrator] Rendering failed for', imageId, renderError);
      }

      try {
        if (handler?.onComplete) {
          handler.onComplete(imageId, result);
        }
      } catch (e) {
        console.error('[Koma Orchestrator] onComplete callback threw:', e);
      }

      if (this.prefetchEnabled && this.translationEnabled) {
        const sorted = [...images].sort((a, b) => a.pageIndex - b.pageIndex);
        await this.prefetchUpcomingImages(sorted, targetImage, handler);
      }

      return true;
    } catch (error) {
      if (this.sessionId !== currentSession) return false;
      const err = error instanceof Error ? error : new Error(String(error));
      this.updateState(imageId, { status: 'failed', error: err }, handler);

      try {
        if (handler?.onError) {
          handler.onError(imageId, err);
        }
      } catch (e) {
        console.error('[Koma Orchestrator] onError callback threw:', e);
      }

      return false;
    } finally {
      if (this.sessionId === currentSession) {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.pumpQueue();
      }
    }
  }
}
