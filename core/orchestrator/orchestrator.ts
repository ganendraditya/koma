import { TranslationProvider } from '@core/contracts';
import { SiteAdapter } from '../../adapters';
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

  public async translateNext(handler?: OrchestratorEventHandler): Promise<void> {
    const images = this.adapter.detectMangaImages();
    if (!images || images.length === 0) {
      return;
    }

    // Initialize state for newly discovered images
    for (const img of images) {
      if (!this.stateMap.has(img.id)) {
        this.updateState(img.id, { status: 'idle' });
      }
    }

    // Find the next eligible image (reading order)
    const eligibleImage = images.find(img => {
      const state = this.stateMap.get(img.id);
      return state && (state.status === 'idle');
    });

    if (!eligibleImage) {
      // Nothing to do
      return;
    }

    await this.processImage(eligibleImage.id, handler);
  }

  public async retry(imageId: string, handler?: OrchestratorEventHandler): Promise<void> {
    const state = this.stateMap.get(imageId);
    if (!state || state.status !== 'failed') {
      return; // Cannot retry if it doesn't exist or isn't failed
    }

    await this.processImage(imageId, handler);
  }

  private async processImage(imageId: string, handler?: OrchestratorEventHandler): Promise<void> {
    // Check concurrency limit (for future use with queueing)
    if (this.inFlightCount >= (this.options.concurrencyLimit || 1)) {
      return;
    }

    const state = this.stateMap.get(imageId);
    if (!state || state.status === 'translating' || state.status === 'completed') {
      return; // Prevent duplicate work
    }

    // Find the original image details from the adapter
    const images = this.adapter.detectMangaImages();
    const targetImage = images.find(img => img.id === imageId);
    if (!targetImage) {
      const err = new Error(`Image ${imageId} no longer detected by adapter`);
      this.updateState(imageId, { status: 'failed', error: err }, handler);
      if (handler?.onError) handler.onError(imageId, err);
      return;
    }

    this.inFlightCount++;
    this.updateState(imageId, { status: 'translating', error: undefined }, handler);

    try {
      // Fetch actual image data (e.g. converting img element to base64 or blob URL)
      // Since Koma is DOM based, the adapter would give us a URL or data URL in targetImage.src
      const result = await this.provider.translatePage({
        image: targetImage,
        targetLanguage: 'id', // Default to Indonesian for now, or get from options
      });

      this.updateState(imageId, { status: 'completed', result }, handler);
      
      // Render immediately upon success
      try {
        this.renderer.render(result);
      } catch (renderError) {
        console.error('[Koma Orchestrator] Rendering failed for', imageId, renderError);
        // We do not fail the overall state since translation succeeded, but we might log it
      }

      if (handler?.onComplete) {
        handler.onComplete(imageId, result);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.updateState(imageId, { status: 'failed', error: err }, handler);
      if (handler?.onError) handler.onError(imageId, err);
    } finally {
      this.inFlightCount--;
    }
  }
}
