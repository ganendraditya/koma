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

  capabilities(): ProviderCapabilities {
    return this.innerProvider.capabilities();
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    // Supply current context memory unless caller provides an explicit override.
    const effectiveContext = request.context ?? this.contextManager.getPacket();
    const enrichedRequest: TranslationRequest = {
      ...request,
      context: effectiveContext,
    };

    // Failures bubble up directly, ensuring failed runs never pollute context history.
    const result = await this.innerProvider.translatePage(enrichedRequest);

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
