import { MangaImage } from './image';
import { Bubble } from './bubble';
import { ContextPacket, ContextDelta } from './context';

/**
 * Functional capabilities exposed by a translation provider.
 * Used by Koma Core to determine whether a provider can handle vision,
 * bounding-box generation, or requires external preprocessing.
 */
export interface ProviderCapabilities {
  /**
   * Can directly ingest and analyze image data.
   */
  vision: boolean;

  /**
   * Can detect and extract text from images.
   */
  ocr: boolean;

  /**
   * Can translate text from source to target language.
   */
  translation: boolean;

  /**
   * Can return localized [ymin, xmin, ymax, xmax] bounding boxes for text regions.
   */
  boundingBoxes: boolean;

  /**
   * Runs locally on device (e.g. WebGPU, Wasm, local server) without third-party network calls.
   */
  local?: boolean;

  /**
   * Supported source languages (ISO codes). If empty or omitted, universal support is assumed.
   */
  supportedSourceLanguages?: string[];

  /**
   * Supported target languages (ISO codes). If empty or omitted, universal support is assumed.
   */
  supportedTargetLanguages?: string[];
}

/**
 * Configuration options for an individual translation invocation.
 */
export interface TranslationOptions {
  /**
   * Wall-clock request timeout in milliseconds.
   */
  timeoutMs?: number;

  /**
   * Model temperature / creativity (0.0 = deterministic, 1.0 = creative).
   */
  temperature?: number;

  /**
   * Custom system instructions or style guide.
   */
  customPrompt?: string;
}

/**
 * Standardized request passed to a TranslationProvider.
 */
export interface TranslationRequest {
  /**
   * The manga image to be translated.
   */
  image: MangaImage;

  /**
   * Desired target language ISO code (e.g. 'id', 'en').
   */
  targetLanguage: string;

  /**
   * Source language ISO code if known (e.g. 'ja', 'ko', 'zh').
   */
  sourceLanguage?: string;

  /**
   * Optional contextual history and glossary from previous pages.
   */
  context?: ContextPacket;

  /**
   * Additional invocation options.
   */
  options?: TranslationOptions;
}

/**
 * Standardized, normalized translation output returned by all providers.
 * Downstream components (DOM Overlay Renderer, Caching, Context Engine)
 * MUST consume only this structure and NEVER inspect raw provider responses.
 */
export interface TranslationResult {
  /**
   * Unique identifier of the page or chapter.
   */
  pageId: string;

  /**
   * Reference ID of the processed MangaImage.
   */
  imageId: string;

  /**
   * Source language of the manga text.
   */
  sourceLanguage: string;

  /**
   * Target language of the translated bubbles.
   */
  targetLanguage: string;

  /**
   * List of detected and translated dialogue bubbles with bounding boxes.
   */
  bubbles: Bubble[];

  /**
   * Optional contextual discoveries made during translation.
   */
  contextDelta?: ContextDelta;

  /**
   * Total model/provider processing duration in milliseconds.
   */
  durationMs?: number;

  /**
   * Identifier of the provider that performed the translation.
   */
  providerId?: string;

  /**
   * Specific model version used (e.g. 'gemini-1.5-flash').
   */
  modelId?: string;
}

/**
 * Provider-agnostic contract that every translation backend must fulfill.
 */
export interface TranslationProvider {
  /**
   * Unique machine-readable identifier of this provider (e.g. 'gemini-multimodal', 'deepl-nmt').
   */
  readonly id: string;

  /**
   * Human-readable display label (e.g. 'Google Gemini 1.5 Flash').
   */
  readonly name: string;

  /**
   * Returns the capabilities of this provider instance.
   */
  capabilities(): ProviderCapabilities;

  /**
   * Translates a single manga image into normalized bubbles.
   *
   * @throws {KomaError} Standardized Koma error hierarchy on failure.
   */
  translatePage(request: TranslationRequest): Promise<TranslationResult>;
}
