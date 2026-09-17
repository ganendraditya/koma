export * from '@core/contracts/provider';

/**
 * Base configuration options required by client-configured providers.
 */
export interface TranslationProviderConfig {
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
  modelName?: string;
}
