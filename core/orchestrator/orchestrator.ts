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
    for (const img of images) {
      if (!this.stateMap.has(img.id)) {
        this.updateState(img.id, { status: 'idle' });
      }
    }

    // Find the next eligible image (reading order)
    const sortedImages = [...images].sort((a, b) => a.pageIndex - b.pageIndex);
    const eligibleImage = sortedImages.find(img => {
      const state = this.stateMap.get(img.id);
      return state && (state.status === 'idle');
    });

    if (!eligibleImage) {
      // Nothing to do
      return false;
    }

    return await this.processImage(eligibleImage.id, handler);
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
      return false; // Rejects silently. Real queues would buffer here.
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

      if (handler?.onComplete) {
        handler.onComplete(imageId, result);
      }
      return true;
    } catch (error) {
      if (this.sessionId !== currentSession) return false;
      const err = error instanceof Error ? error : new Error(String(error));
      this.updateState(imageId, { status: 'failed', error: err }, handler);
      if (handler?.onError) handler.onError(imageId, err);
      return false;
    } finally {
      if (this.sessionId === currentSession) {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      }
    }
  }
}
