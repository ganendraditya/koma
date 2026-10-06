import {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  ProviderCapabilities,
} from '../contracts';
import { TranslationCache } from './types';
import { generateCacheKey } from './key';
import { logPipeline } from '../diagnostics';

interface InFlightTranslation {
  task: Promise<TranslationResult>;
  controller: AbortController;
  consumers: number;
}

function rebindResultToRequest(
  result: TranslationResult,
  request: TranslationRequest
): TranslationResult {
  const pageId =
    request.image.pageIndex !== undefined ? `page_${request.image.pageIndex}` : result.pageId;

  return {
    ...result,
    imageId: request.image.id,
    pageId,
  };
}

export class CachedTranslationProvider implements TranslationProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly modelName?: string;
  public readonly cacheIdentity?: string;
  public readonly cache: TranslationCache;
  private readonly provider: TranslationProvider;
  private readonly inFlight = new Map<string, InFlightTranslation>();

  constructor(provider: TranslationProvider, cache: TranslationCache) {
    this.provider = provider;
    this.cache = cache;
    this.id = provider.id;
    this.name = provider.name;
    this.modelName = provider.modelName;
    this.cacheIdentity = provider.cacheIdentity;
  }

  capabilities(): ProviderCapabilities {
    return this.provider.capabilities();
  }

  async translatePage(
    request: TranslationRequest,
    signal?: AbortSignal
  ): Promise<TranslationResult> {
    signal?.throwIfAborted();
    const modelId = request.options?.modelName || this.provider.modelName;

    const cacheKey = generateCacheKey({
      image: request.image,
      targetLanguage: request.targetLanguage,
      sourceLanguage: request.sourceLanguage,
      providerId: this.provider.id,
      modelId,
      cacheIdentity: this.cacheIdentity,
      context: request.context,
      customPrompt: request.options?.customPrompt,
    });

    if (request.options?.bypassCache) {
      logPipeline('cache', 'bypass');
      const result = await (signal
        ? this.provider.translatePage(request, signal)
        : this.provider.translatePage(request));
      signal?.throwIfAborted();
      try {
        await this.cache.set(cacheKey, result);
      } catch {
        // Cache persistence failure should not interrupt the translation flow.
      }
      return rebindResultToRequest(result, request);
    }

    const ongoing = this.inFlight.get(cacheKey);
    if (ongoing) {
      logPipeline('cache', 'in-flight');
      const result = await this.waitForTask(cacheKey, ongoing, signal);
      signal?.throwIfAborted();
      return rebindResultToRequest(result, request);
    }

    const cached = await this.cache.get(cacheKey);
    signal?.throwIfAborted();
    if (cached) {
      logPipeline('cache', 'hit');
      return rebindResultToRequest(cached, request);
    }
    logPipeline('cache', 'miss');

    const ongoingAfterCache = this.inFlight.get(cacheKey);
    if (ongoingAfterCache) {
      logPipeline('cache', 'in-flight');
      const result = await this.waitForTask(cacheKey, ongoingAfterCache, signal);
      signal?.throwIfAborted();
      return rebindResultToRequest(result, request);
    }

    const controller = new AbortController();
    const execute = async (): Promise<TranslationResult> => {
      const result = await this.provider.translatePage(request, controller.signal);
      controller.signal.throwIfAborted();
      try {
        await this.cache.set(cacheKey, result);
      } catch {
        // Cache persistence failure should not interrupt the translation flow.
      }
      return result;
    };

    const task = execute().finally(() => {
      if (this.inFlight.get(cacheKey) === entry) {
        this.inFlight.delete(cacheKey);
      }
    });

    const entry = { task, controller, consumers: 0 };
    this.inFlight.set(cacheKey, entry);
    const result = await this.waitForTask(cacheKey, entry, signal);
    signal?.throwIfAborted();
    return rebindResultToRequest(result, request);
  }

  private waitForTask(
    cacheKey: string,
    entry: InFlightTranslation,
    signal?: AbortSignal
  ): Promise<TranslationResult> {
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = (): boolean => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        entry.consumers--;
        return true;
      };
      const onAbort = (): void => {
        if (!release()) return;
        reject(signal?.reason);
        // Shared transport belongs to all callers, not to the first caller's signal.
        if (entry.consumers === 0) {
          if (this.inFlight.get(cacheKey) === entry) this.inFlight.delete(cacheKey);
          entry.controller.abort(signal?.reason);
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.task.then(
        (result) => {
          if (release()) resolve(result);
        },
        (error) => {
          if (release()) reject(error);
        }
      );
      if (signal?.aborted) onAbort();
    });
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }
}
