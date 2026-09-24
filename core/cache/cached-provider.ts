import {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  ProviderCapabilities,
} from '../contracts';
import { TranslationCache } from './types';
import { generateCacheKey } from './key';
import { logPipeline } from '../diagnostics';

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
  private readonly provider: TranslationProvider;
  private readonly cache: TranslationCache;
  private readonly inFlight = new Map<string, Promise<TranslationResult>>();

  constructor(provider: TranslationProvider, cache: TranslationCache) {
    this.provider = provider;
    this.cache = cache;
    this.id = provider.id;
    this.name = provider.name;
    this.modelName = provider.modelName;
  }

  capabilities(): ProviderCapabilities {
    return this.provider.capabilities();
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    const modelId = request.options?.modelName || this.provider.modelName;

    const cacheKey = generateCacheKey({
      image: request.image,
      targetLanguage: request.targetLanguage,
      sourceLanguage: request.sourceLanguage,
      providerId: this.provider.id,
      modelId,
      context: request.context,
      customPrompt: request.options?.customPrompt,
    });

    if (request.options?.bypassCache) {
      logPipeline('cache', 'bypass');
      const result = await this.provider.translatePage(request);
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
      const result = await ongoing;
      return rebindResultToRequest(result, request);
    }

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      logPipeline('cache', 'hit');
      return rebindResultToRequest(cached, request);
    }
    logPipeline('cache', 'miss');

    const ongoingAfterCache = this.inFlight.get(cacheKey);
    if (ongoingAfterCache) {
      logPipeline('cache', 'in-flight');
      const result = await ongoingAfterCache;
      return rebindResultToRequest(result, request);
    }

    const execute = async (): Promise<TranslationResult> => {
      const result = await this.provider.translatePage(request);
      try {
        await this.cache.set(cacheKey, result);
      } catch {
        // Cache persistence failure should not interrupt the translation flow.
      }
      return result;
    };

    const task = execute().finally(() => {
      if (this.inFlight.get(cacheKey) === task) {
        this.inFlight.delete(cacheKey);
      }
    });

    this.inFlight.set(cacheKey, task);
    const result = await task;
    return rebindResultToRequest(result, request);
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }
}
