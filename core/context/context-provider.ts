import {
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '@core/contracts';
import { IContextManager } from './types';

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
    // Supply current context memory unless caller provides an explicit override.
    const effectiveContext = request.context ?? this.contextManager.getPacket();
    const enrichedRequest: TranslationRequest = {
      ...request,
      context: effectiveContext,
    };

    // Failures bubble up directly, ensuring failed runs never pollute context history.
    const result = await (signal
      ? this.innerProvider.translatePage(enrichedRequest, signal)
      : this.innerProvider.translatePage(enrichedRequest));

    signal?.throwIfAborted();
    this.contextManager.recordTranslation(result, request.image.pageIndex);

    return result;
  }

  resetContext(): void {
    this.contextManager.reset();
  }

  getContextManager(): IContextManager {
    return this.contextManager;
  }
}
