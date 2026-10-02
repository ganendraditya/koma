import type { TranslationProvider } from '@core/contracts';
import type { ProviderConfig } from './config';
import { GeminiTranslationProvider } from './gemini/provider';
import { OpenAITranslationProvider } from './openai/provider';

export function createTranslationProvider(
  config: ProviderConfig,
  fetchFn?: typeof fetch
): TranslationProvider {
  return config.provider === 'gemini'
    ? new GeminiTranslationProvider({ apiKey: config.apiKey, modelName: config.modelName, fetchFn })
    : new OpenAITranslationProvider({ ...config, provider: config.provider, fetchFn });
}
