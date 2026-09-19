import { TranslationResult } from '@core/contracts';

export type TranslationStatus = 'idle' | 'translating' | 'completed' | 'failed';

export interface ImageTranslationState {
  imageId: string;
  status: TranslationStatus;
  result?: TranslationResult;
  error?: Error;
}

export interface OrchestratorOptions {
  /** Maximum number of concurrent translations */
  concurrencyLimit?: number;
}

export interface IRenderer {
  render(result: TranslationResult): void;
}

/**
 * High-level callback interface for progress tracking in the UI.
 */
export interface OrchestratorEventHandler {
  onProgress?: (state: ImageTranslationState) => void;
  onError?: (imageId: string, error: Error) => void;
  onComplete?: (imageId: string, result: TranslationResult) => void;
}

export interface ITranslationOrchestrator {
  /** 
   * Triggers translation for the next untranslated image(s) on the page. 
   * Idempotent per image.
   */
  translateNext(handler?: OrchestratorEventHandler): Promise<void>;
  
  /** 
   * Retries translation for a specific image ID if it previously failed. 
   */
  retry(imageId: string, handler?: OrchestratorEventHandler): Promise<void>;

  /**
   * Retrieves the current translation state for all known images.
   */
  getState(): Map<string, ImageTranslationState>;

  /**
   * Clears internal state (useful for page navigation or testing).
   */
  reset(): void;
}
