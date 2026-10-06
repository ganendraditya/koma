export * from '@core/contracts/provider';
export * from './gemini';
export * from './openai/provider';
export * from './config';
export * from './factory';

/**
 * Base configuration options required by client-configured providers.
 */
export interface TranslationProviderConfig {
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
  modelName?: string;
}
