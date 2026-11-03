import {
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  validateTranslationResult,
} from '@core/contracts';
import { IContextManager } from './types';
import { InvalidProviderResponseError } from '@core/errors';

export class ContextAwareProvider implements TranslationProvider {
  constructor(
    private innerProvider: TranslationProvider,
    private contextManager: IContextManager
  ) {}

  get id(): string {
    return this.innerProvider.id;
  }

  get name(): string {
    return this.innerProvider.name;
  }

  get modelName(): string | undefined {
    return this.innerProvider.modelName;
  }

  get cacheIdentity(): string | undefined {
    return this.innerProvider.cacheIdentity;
  }

  capabilities(): ProviderCapabilities {
    return this.innerProvider.capabilities();
  }

  async translatePage(
    request: TranslationRequest,
    signal?: AbortSignal
  ): Promise<TranslationResult> {
    signal?.throwIfAborted();
    await this.contextManager.ready?.();
    signal?.throwIfAborted();
    // Supply current context memory unless caller provides an explicit override.
    const effectiveContext =
      request.context ?? this.contextManager.getPacket(request.image.pageIndex);
    const enrichedRequest: TranslationRequest = {
      ...request,
      context: effectiveContext,
    };

    // Failures bubble up directly, ensuring failed runs never pollute context history.
    const result = await (signal
      ? this.innerProvider.translatePage(enrichedRequest, signal)
      : this.innerProvider.translatePage(enrichedRequest));

    signal?.throwIfAborted();
    if (!validateTranslationResult(result).valid) {
      throw new InvalidProviderResponseError(
        'The provider returned an invalid translation result.',
        this.innerProvider.id
      );
    }
    if (this.contextManager.commitTranslation) {
      await this.contextManager.commitTranslation(
        result,
        request.image.pageIndex,
        request.image.id,
        signal
      );
    } else {
      this.contextManager.recordTranslation(result, request.image.pageIndex, request.image.id);
      await this.contextManager.flush?.();
      signal?.throwIfAborted();
    }

    return result;
  }

  resetContext(): void | Promise<void> {
    return this.contextManager.reset();
  }

  getContextManager(): IContextManager {
    return this.contextManager;
  }
}
