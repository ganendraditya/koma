import { MangaImage, TranslationProvider, TranslationResult } from '@core/contracts';
import { CachedTranslationProvider } from '@core/cache';
import { SiteAdapter } from '@adapters';
import { InvalidProviderResponseError, ProviderRateLimitError } from '@core/errors';
import { logPipeline, pipelineFailure } from '@core/diagnostics';
import {
  ITranslationOrchestrator,
  IRenderer,
  OrchestratorOptions,
  ImageTranslationState,
  OrchestratorEventHandler,
  ReadingSessionState,
} from './types';
import { PrefetchQueue, QueueItem } from './prefetch-queue';
import {
  defaultResolveImagePosition,
  findNearestImageToViewport,
  getDefaultViewport,
} from './viewport';

export class TranslationOrchestrator implements ITranslationOrchestrator {
  private readonly provider: TranslationProvider;
  private readonly queue = new PrefetchQueue();
  private readonly stateMap = new Map<string, ImageTranslationState>();
  private controller = new AbortController();
  private inFlightCount = 0;
  private prefetchEnabled: boolean;
  private translationEnabled = true;
  private pageVisible = true;
  private overlaysVisible = true;
  private started = false;
  private disposed = false;
  private handler?: OrchestratorEventHandler;
  private cooldownUntil = 0;
  private cooldownTimer?: ReturnType<typeof setTimeout>;

  constructor(
    provider: TranslationProvider,
    private readonly adapter: SiteAdapter,
    private readonly renderer: IRenderer,
    private readonly options: OrchestratorOptions = {}
  ) {
    this.provider = options.cache
      ? new CachedTranslationProvider(provider, options.cache)
      : provider;
    this.prefetchEnabled = options.prefetchEnabled ?? true;
  }

  getState(): Map<string, ImageTranslationState> {
    return new Map(this.stateMap);
  }
  getQueueSize(): number {
    return this.queue.size;
  }
  getQueuedImageIds(): string[] {
    return this.queue.getQueuedImageIds();
  }
  isPrefetchEnabled(): boolean {
    return this.prefetchEnabled;
  }
  isTranslationEnabled(): boolean {
    return this.translationEnabled && !this.disposed;
  }

  getSessionState(): ReadingSessionState {
    const states = [...this.stateMap.values()];
    const acceptedCount = states.filter((state) => state.result).length;
    const failure = states.find((state) => state.status === 'failed');
    return {
      status: !this.started
        ? 'idle'
        : !this.translationEnabled
          ? 'paused'
          : this.inFlightCount || this.queue.size
            ? 'active'
            : failure
              ? 'failed'
              : acceptedCount
                ? 'completed'
                : 'active',
      overlaysVisible: this.overlaysVisible,
      acceptedCount,
      queuedCount: this.queue.size,
      activeCount: this.inFlightCount,
      cooldownUntil: this.cooldownUntil > Date.now() ? this.cooldownUntil : undefined,
      error: failure?.error?.message,
    };
  }

  private notify(): void {
    try {
      this.handler?.onSessionChange?.(this.getSessionState());
    } catch {
      console.error('[Koma Orchestrator] Session callback threw');
    }
  }

  private cancelPending(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.queue.clear();
    this.inFlightCount = 0;
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = undefined;
    for (const state of this.stateMap.values()) {
      if (state.status === 'translating') state.status = state.result ? 'completed' : 'idle';
    }
  }

  reset(): void {
    this.cancelPending();
    this.stateMap.clear();
    this.renderer.removeAllOverlays?.();
    this.overlaysVisible = true;
    this.started = false;
    this.cooldownUntil = 0;
    this.notify();
  }

  dispose(): void {
    this.reset();
    this.translationEnabled = false;
    this.disposed = true;
  }

  setTranslationEnabled(enabled: boolean): void {
    if (this.disposed || this.translationEnabled === enabled) return;
    this.translationEnabled = enabled;
    if (!enabled) this.cancelPending();
    this.notify();
  }

  setPageVisible(visible: boolean): void {
    if (this.pageVisible === visible) return;
    this.pageVisible = visible;
    if (!visible) this.cancelPending();
    this.notify();
  }

  setOverlaysVisible(visible: boolean): void {
    if (this.disposed || this.overlaysVisible === visible) return;
    if (!visible) this.renderer.removeAllOverlays?.();
    else {
      const images = new Set(this.adapter.detectMangaImages().map((image) => image.id));
      for (const state of this.stateMap.values()) {
        if (state.result && images.has(state.imageId)) this.render(state.result);
      }
    }
    this.overlaysVisible = visible;
    this.notify();
  }

  setPrefetchEnabled(enabled: boolean): void {
    this.prefetchEnabled = enabled;
    if (!enabled) this.queue.removePrefetchTasks();
    else if (this.translationEnabled) void this.prefetchUpcoming();
    this.notify();
  }

  getNearestImageToViewport(images?: MangaImage[]): MangaImage | null {
    return findNearestImageToViewport(
      images ?? this.adapter.detectMangaImages(),
      this.options.positionResolver ??
        ((image) => defaultResolveImagePosition(image, this.adapter)),
      this.options.viewportProvider?.() ?? getDefaultViewport()
    );
  }

  private detect(): MangaImage[] {
    const start = performance.now();
    try {
      const images = this.adapter.detectMangaImages();
      logPipeline('detection', 'scan', performance.now() - start);
      return [...images].sort((a, b) => a.pageIndex - b.pageIndex);
    } catch {
      throw pipelineFailure('detection');
    }
  }

  private updateState(imageId: string, partial: Partial<ImageTranslationState>): void {
    const state = {
      ...(this.stateMap.get(imageId) ?? { imageId, status: 'idle' as const }),
      ...partial,
    };
    this.stateMap.set(imageId, state);
    try {
      this.handler?.onProgress?.(state);
    } catch {
      console.error('[Koma Orchestrator] Progress callback threw');
    }
  }

  private async scheduleWindow(
    includeVisible: boolean,
    retryFailed: boolean,
    handler?: OrchestratorEventHandler
  ): Promise<string[]> {
    if (handler) this.handler = handler;
    if (!this.isTranslationEnabled() || !this.pageVisible) return [];
    let images: MangaImage[];
    try {
      images = this.detect();
    } catch {
      return [];
    }
    if (!images.length) return [];
    this.started = true;
    for (const image of images) {
      if (!this.stateMap.has(image.id)) this.updateState(image.id, { status: 'idle' });
    }
    const nearest = this.getNearestImageToViewport(images) ?? images[0];
    const index = images.findIndex((image) => image.id === nearest.id);
    const count = this.prefetchEnabled
      ? Math.max(0, Math.floor(this.options.lookAheadCount ?? 2))
      : 0;
    const window = images.slice(index, index + count + 1);
    const eligible = new Set(window.map((image) => image.id));
    // Rebuild priorities from the current viewport, never from a completed page.
    const previouslyQueued = new Set(
      this.queue
        .getSortedItems()
        .filter((task) => task.source === 'user')
        .map((task) => task.imageId)
    );
    this.queue.clear();
    const queued: string[] = [];
    for (const [offset, image] of window.entries()) {
      const state = this.stateMap.get(image.id)!;
      if (
        (!includeVisible && offset === 0) ||
        state.status === 'completed' ||
        state.status === 'translating'
      )
        continue;
      if (state.status === 'failed' && !retryFailed && !previouslyQueued.has(image.id)) continue;
      this.queue.enqueue({
        imageId: image.id,
        priority: offset,
        source: offset === 0 || (retryFailed && state.status === 'failed') ? 'user' : 'prefetch',
      });
      queued.push(image.id);
    }
    // Accepted overlays can be rebound after the reader remounts a virtualized page.
    if (this.overlaysVisible) {
      for (const state of this.stateMap.values()) {
        if (
          state.result &&
          eligible.has(state.imageId) &&
          this.renderer.hasOverlay?.(state.imageId) === false
        )
          this.render(state.result);
      }
    }
    this.pumpQueue();
    this.notify();
    return queued;
  }

  async translateNext(handler?: OrchestratorEventHandler): Promise<boolean> {
    return (await this.scheduleWindow(true, true, handler)).length > 0;
  }
  async translateVisible(handler?: OrchestratorEventHandler): Promise<boolean> {
    return (await this.scheduleWindow(true, false, handler)).length > 0;
  }
  async prefetchUpcoming(handler?: OrchestratorEventHandler): Promise<string[]> {
    if (!this.prefetchEnabled) return [];
    return this.scheduleWindow(false, false, handler);
  }

  async retry(imageId: string, handler?: OrchestratorEventHandler): Promise<boolean> {
    if (
      !this.isTranslationEnabled() ||
      !this.pageVisible ||
      this.stateMap.get(imageId)?.status !== 'failed'
    )
      return false;
    if (handler) this.handler = handler;
    this.queue.enqueue({ imageId, priority: 0, source: 'user' });
    this.pumpQueue();
    this.notify();
    return true;
  }

  private pumpQueue(): void {
    if (!this.isTranslationEnabled() || !this.pageVisible || !this.queue.size) return;
    const remaining = this.cooldownUntil - Date.now();
    if (remaining > 0) {
      if (!this.cooldownTimer)
        this.cooldownTimer = setTimeout(
          () => {
            this.cooldownTimer = undefined;
            this.pumpQueue();
            this.notify();
          },
          Math.min(remaining, 2147483647)
        );
      return;
    }
    const limit = Math.max(1, this.options.concurrencyLimit ?? 1);
    while (this.inFlightCount < limit && this.queue.size) {
      const task = this.queue.dequeue()!;
      const state = this.stateMap.get(task.imageId);
      if (state?.status === 'completed' || state?.status === 'translating') continue;
      if (task.source === 'prefetch' && !this.prefetchEnabled) continue;
      this.inFlightCount++;
      void this.executeTask(task, this.controller.signal);
    }
  }

  private render(result: TranslationResult): void {
    const start = performance.now();
    try {
      this.renderer.render(result);
      logPipeline('render', 'duration', performance.now() - start);
    } catch {
      throw pipelineFailure('render');
    }
  }

  private async executeTask(task: QueueItem, signal: AbortSignal): Promise<void> {
    const { imageId } = task;
    this.updateState(imageId, { status: 'translating', error: undefined });
    try {
      const image = this.detect().find((image) => image.id === imageId);
      if (!image) throw pipelineFailure('detection');
      const start = performance.now();
      let result: TranslationResult;
      try {
        result = await this.provider.translatePage(
          { image, targetLanguage: this.options.targetLanguage ?? 'id' },
          signal
        );
      } catch (error) {
        if (signal.aborted) return;
        throw pipelineFailure(
          error instanceof InvalidProviderResponseError ? 'normalization' : 'provider',
          error
        );
      }
      if (signal.aborted) return;
      if (this.overlaysVisible) this.render(result);
      this.updateState(imageId, { status: 'completed', result });
      logPipeline('total', 'translation', performance.now() - start);
      try {
        this.handler?.onComplete?.(imageId, result);
      } catch {
        console.error('[Koma Orchestrator] Completion callback threw');
      }
    } catch (error) {
      if (signal.aborted) return;
      const err = error instanceof Error ? error : pipelineFailure('provider');
      if (err instanceof ProviderRateLimitError) {
        const seconds = err.retryAfterSeconds;
        const configuredCooldown = this.options.rateLimitCooldownMs;
        const fallback = Math.min(
          60000,
          Math.max(1000, Number.isFinite(configuredCooldown) ? configuredCooldown! : 30000)
        );
        const delay =
          Number.isFinite(seconds) && seconds! >= 0 ? Math.max(1000, seconds! * 1000) : fallback;
        this.cooldownUntil = Date.now() + delay;
      }
      this.updateState(imageId, { status: 'failed', error: err });
      try {
        this.handler?.onError?.(imageId, err);
      } catch {
        console.error('[Koma Orchestrator] Error callback threw');
      }
    } finally {
      if (!signal.aborted) {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.pumpQueue();
        this.notify();
      }
    }
  }
}
