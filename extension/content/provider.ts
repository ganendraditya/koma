import type {
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '@core/contracts';
import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '@core/errors';
import { validateTranslationResult } from '@core/contracts';
import { loadImageData } from '@providers/common/image';
import {
  EXTENSION_MESSAGE_TYPES,
  type ProviderRuntimeConfig,
  type ProviderTranslationResponse,
  type SerializedProviderError,
} from '@shared/messages';

function deserializeError(error: SerializedProviderError): ProviderError {
  if (error.code === 'KOMA_AUTH_ERROR')
    return new ProviderAuthError(error.message, error.providerId);
  if (error.code === 'KOMA_RATE_LIMIT_ERROR')
    return new ProviderRateLimitError(error.message, error.providerId, error.retryAfterSeconds);
  if (error.code === 'KOMA_TIMEOUT_ERROR')
    return new ProviderTimeoutError(error.message, error.providerId, error.timeoutMs);
  if (error.code === 'KOMA_INVALID_RESPONSE_ERROR')
    return new InvalidProviderResponseError(
      error.message,
      error.providerId,
      undefined,
      undefined,
      error.reason
    );
  return new ProviderError(error.message, error.code, error.providerId);
}

export class ExtensionTranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly name: string;
  readonly modelName: string;
  readonly cacheIdentity: string;
  private readonly pending = new Set<() => void>();
  private cancelled = false;

  constructor(private readonly config: ProviderRuntimeConfig) {
    this.id = config.id;
    this.name = config.name;
    this.modelName = config.modelName;
    this.cacheIdentity = config.cacheIdentity;
  }

  capabilities(): ProviderCapabilities {
    return this.config.capabilities;
  }

  cancel(): void {
    this.cancelled = true;
    for (const cancel of this.pending) cancel();
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    if (this.cancelled)
      throw new ProviderError(
        'Provider settings changed. Press Translate again.',
        'KOMA_SETTINGS_CHANGED',
        this.id
      );
    const timeoutMs = request.options?.timeoutMs ?? 120000;
    const controller = new AbortController();
    const cancelLoad = () => controller.abort();
    this.pending.add(cancelLoad);
    const loadTimeout = setTimeout(cancelLoad, timeoutMs);
    const start = performance.now();
    let image: Awaited<ReturnType<typeof loadImageData>>;
    try {
      image = await loadImageData(request.image, this.id, undefined, controller.signal);
    } catch (error) {
      if (controller.signal.aborted)
        throw new ProviderTimeoutError(
          'Image loading timed out or was cancelled.',
          this.id,
          timeoutMs
        );
      throw error;
    } finally {
      clearTimeout(loadTimeout);
      this.pending.delete(cancelLoad);
    }
    if (this.cancelled)
      throw new ProviderError(
        'Provider settings changed. Press Translate again.',
        'KOMA_SETTINGS_CHANGED',
        this.id
      );
    const remaining = Math.max(1, timeoutMs - (performance.now() - start));
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'koma-translation' });
      let settled = false;
      const finish = (error?: Error, result?: TranslationResult) => {
        if (settled) return;
        settled = true;
        clearInterval(keepAlive);
        clearTimeout(deadline);
        this.pending.delete(cancel);
        port.disconnect();
        if (error) reject(error);
        else resolve(result!);
      };
      const cancel = () =>
        finish(
          new ProviderError(
            'Provider settings changed. Press Translate again.',
            'KOMA_SETTINGS_CHANGED',
            this.id
          )
        );
      // Port messages reset MV3 idle timers; an open port alone does not.
      const keepAlive = setInterval(() => {
        try {
          port.postMessage({ type: 'KEEP_ALIVE' });
        } catch {
          finish(
            new ProviderError(
              'The extension worker disconnected. Retry the translation.',
              'KOMA_NETWORK_ERROR',
              this.id
            )
          );
        }
      }, 20000);
      const deadline = setTimeout(
        () =>
          finish(
            new ProviderTimeoutError(
              'Translation timed out. Try a lower reasoning effort or retry.',
              this.id,
              timeoutMs
            )
          ),
        remaining + 1000
      );
      this.pending.add(cancel);
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        finish(
          new ProviderError(
            'The extension worker disconnected. Retry the translation.',
            'KOMA_NETWORK_ERROR',
            this.id
          )
        );
      });
      port.onMessage.addListener((response: ProviderTranslationResponse) => {
        if (!response.success) {
          finish(deserializeError(response.error));
          return;
        }
        if (!validateTranslationResult(response.result).valid) {
          finish(
            new InvalidProviderResponseError('The worker returned an invalid translation.', this.id)
          );
          return;
        }
        finish(undefined, response.result);
      });
      try {
        port.postMessage({
          type: EXTENSION_MESSAGE_TYPES.TRANSLATE_IMAGE,
          revision: this.config.revision,
          request: {
            ...request,
            image: {
              id: request.image.id,
              pageIndex: request.image.pageIndex,
              base64Data: image.base64Data,
              mimeType: image.mimeType,
            },
            options: { ...request.options, timeoutMs: remaining },
          },
        });
      } catch {
        finish(
          new ProviderError(
            'Could not contact the extension worker.',
            'KOMA_NETWORK_ERROR',
            this.id
          )
        );
      }
    });
  }
}
