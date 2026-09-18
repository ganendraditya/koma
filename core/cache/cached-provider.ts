import {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  ProviderCapabilities,
} from '../contracts';
import { TranslationCache } from './types';
import { generateCacheKey } from './key';

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
    });

    if (request.options?.bypassCache) {
      const result = await this.provider.translatePage(request);
      try {
        await this.cache.set(cacheKey, result);
      } catch {
        // Cache persistence failure should not interrupt the translation flow.
      }
      return result;
    }

    const ongoing = this.inFlight.get(cacheKey);
    if (ongoing) {
      return ongoing;
    }

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const ongoingAfterCache = this.inFlight.get(cacheKey);
    if (ongoingAfterCache) {
      return ongoingAfterCache;
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
    return task;
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }
}
