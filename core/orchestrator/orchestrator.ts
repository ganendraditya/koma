import { TranslationProvider } from '@core/contracts';
import { SiteAdapter } from '@adapters';
import {
  ITranslationOrchestrator,
  IRenderer,
  OrchestratorOptions,
  ImageTranslationState,
  OrchestratorEventHandler,
} from './types';

export class TranslationOrchestrator implements ITranslationOrchestrator {
  private readonly provider: TranslationProvider;
  private readonly adapter: SiteAdapter;
  private readonly renderer: IRenderer;
  private readonly options: OrchestratorOptions;

  private stateMap: Map<string, ImageTranslationState> = new Map();
  private inFlightCount = 0;
  private sessionId = 0;

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
    };
  }

  public getState(): Map<string, ImageTranslationState> {
    return new Map(this.stateMap);
  }

  public reset(): void {
    this.sessionId++;
    this.stateMap.clear();
    this.inFlightCount = 0;
  }

  private updateState(imageId: string, partial: Partial<ImageTranslationState>, handler?: OrchestratorEventHandler) {
    const existing = this.stateMap.get(imageId) || { imageId, status: 'idle' };
    const updated: ImageTranslationState = { ...existing, ...partial };
    this.stateMap.set(imageId, updated);

    if (handler?.onProgress) {
      // Fire and forget callbacks
      try {
        handler.onProgress(updated);
      } catch (e) {
        console.error('[Koma Orchestrator] onProgress callback threw:', e);
      }
    }
    
    return updated;
  }

  public async translateNext(handler?: OrchestratorEventHandler): Promise<boolean> {
    const images = this.adapter.detectMangaImages();
    if (!images || images.length === 0) {
      return false;
    }

    // Initialize state for newly discovered images
    let discoveredNew = false;
    for (const img of images) {
      if (!this.stateMap.has(img.id)) {
        this.updateState(img.id, { status: 'idle' }, handler);
        discoveredNew = true;
      }
    }

    const sortedImages = [...images].sort((a, b) => a.pageIndex - b.pageIndex);
    const limit = this.options.concurrencyLimit || 1;
    let startedAny = false;

    // Fill up the concurrency slots
    for (const img of sortedImages) {
      if (this.inFlightCount >= limit) {
        break; // Concurrency saturated
      }

      const state = this.stateMap.get(img.id);
      if (state && state.status === 'idle') {
        // Start process in background without awaiting it to allow concurrency
        this.processImage(img.id, handler).catch(e => {
          console.error('[Koma Orchestrator] Background translation crashed for', img.id, e);
        });
        startedAny = true;
      }
    }

    return startedAny || discoveredNew;
  }

  public async retry(imageId: string, handler?: OrchestratorEventHandler): Promise<boolean> {
    const state = this.stateMap.get(imageId);
    if (!state || state.status !== 'failed') {
      return false; // Cannot retry if it doesn't exist or isn't failed
    }

    return await this.processImage(imageId, handler);
  }

  private async processImage(imageId: string, handler?: OrchestratorEventHandler): Promise<boolean> {
    // Check concurrency limit
    if (this.inFlightCount >= (this.options.concurrencyLimit || 1)) {
      // TODO: Implement queuing logic to buffer translation requests when the concurrency limit is reached instead of dropping them silently.
      return false; 
    }

    const state = this.stateMap.get(imageId);
    if (!state || state.status === 'translating' || state.status === 'completed') {
      return false; // Prevent duplicate work
    }

    // Find the original image details from the adapter
    const images = this.adapter.detectMangaImages();
    const targetImage = images.find(img => img.id === imageId);
    if (!targetImage) {
      const err = new Error(`Image ${imageId} no longer detected by adapter`);
      this.updateState(imageId, { status: 'failed', error: err }, handler);
      if (handler?.onError) handler.onError(imageId, err);
      return false;
    }

    const currentSession = this.sessionId;
    this.inFlightCount++;
    this.updateState(imageId, { status: 'translating', error: undefined }, handler);

    try {
      // Fetch actual image data
      // Since Koma is DOM based, the adapter provides a URL or data URL in targetImage.url or base64Data
      const result = await this.provider.translatePage({
        image: targetImage,
        targetLanguage: this.options.targetLanguage ?? 'id',
      });

      if (this.sessionId !== currentSession) return false;

      this.updateState(imageId, { status: 'completed', result }, handler);
      
      // Render immediately upon success
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
      
      // Attempt to pull next item from queue if any are left
      this.pumpQueue(handler);
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
      
      this.pumpQueue(handler);
      return false;
    } finally {
      if (this.sessionId === currentSession) {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      }
    }
  }

  /**
   * Helper to continue processing remaining idle images after a slot frees up.
   */
  private pumpQueue(handler?: OrchestratorEventHandler): void {
    const limit = this.options.concurrencyLimit || 1;
    // We expect inFlightCount to decrease soon in the finally block, 
    // or we check if there's room assuming the caller's finally block is about to execute.
    // To avoid race conditions, we can just call translateNext in the next microtask.
    Promise.resolve().then(() => {
       if (this.inFlightCount < limit) {
         this.translateNext(handler).catch(() => {});
       }
    });
  }
}
