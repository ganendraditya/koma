import { DEFAULT_GEMINI_MODEL } from './gemini/types';
import { ProviderError } from '@core/errors';
import type { ReasoningEffort } from './openai/models';

export type ProviderId = 'gemini' | 'openai' | 'openai-compatible';
export type ApiFormat = 'responses' | 'chat-completions';
export type ResponseFormat = 'json-schema' | 'json-object' | 'prompt';

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  modelName: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  responseFormat: ResponseFormat;
  reasoningEffort: ReasoningEffort;
  rememberKey: boolean;
}

export function defaultProviderConfig(provider: ProviderId): ProviderConfig {
  return {
    provider,
    apiKey: '',
    rememberKey: false,
    reasoningEffort: 'auto',
    modelName:
      provider === 'gemini' ? DEFAULT_GEMINI_MODEL : provider === 'openai' ? 'gpt-4.1-mini' : '',
    baseUrl:
      provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : provider === 'openai'
          ? 'https://api.openai.com/v1'
          : '',
    apiFormat: provider === 'openai-compatible' ? 'chat-completions' : 'responses',
    responseFormat: provider === 'openai-compatible' ? 'prompt' : 'json-schema',
  };
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProviderError(
      'Enter a complete API base URL, including https:// or http://.',
      'KOMA_INVALID_REQUEST_ERROR'
    );
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ProviderError(
      'Use an HTTP(S) base URL without credentials, query parameters, or a fragment.',
      'KOMA_INVALID_REQUEST_ERROR'
    );
  }
  if (/\/(?:chat\/completions|responses)\/?$/.test(url.pathname)) {
    throw new ProviderError(
      'Enter the API base URL, such as https://api.openai.com/v1, without /responses or /chat/completions.',
      'KOMA_INVALID_REQUEST_ERROR'
    );
  }
  return url.href.replace(/\/+$/, '');
}

export function providerCacheIdentity(config: Omit<ProviderConfig, 'apiKey'>): string {
  return JSON.stringify([
    config.provider,
    config.baseUrl,
    config.modelName,
    config.apiFormat,
    config.responseFormat,
    config.reasoningEffort,
  ]);
}
