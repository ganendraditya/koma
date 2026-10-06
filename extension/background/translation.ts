import { createTranslationProvider } from '@providers/factory';
import { providerCacheIdentity } from '@providers/config';
import {
  InvalidProviderResponseError,
  KomaError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '@core/errors';
import { getProviderSettings } from '../settings/storage';
import {
  EXTENSION_MESSAGE_TYPES,
  type ProviderRuntimeConfig,
  type ProviderTranslationRequest,
  type SerializedProviderError,
} from '@shared/messages';

export async function getRuntimeProviderConfig(): Promise<ProviderRuntimeConfig> {
  const settings = await getProviderSettings();
  const config = settings.profiles[settings.provider];
  const configured = Boolean(
    config.modelName && config.baseUrl && (config.apiKey || config.provider === 'openai-compatible')
  );
  return {
    revision: settings.revision,
    id: config.provider === 'gemini' ? 'gemini-multimodal' : config.provider,
    name:
      config.provider === 'gemini'
        ? 'Google Gemini'
        : config.provider === 'openai'
          ? 'OpenAI'
          : 'OpenAI-compatible',
    modelName: config.modelName,
    cacheIdentity: providerCacheIdentity(config),
    targetLanguage: settings.targetLanguage,
    configured,
    capabilities: { vision: true, ocr: true, translation: true, boundingBoxes: true },
  };
}

export function serializeProviderError(error: unknown): SerializedProviderError {
  if (!(error instanceof KomaError))
    return { code: 'KOMA_PROVIDER_ERROR', message: 'Translation could not be completed.' };
  return {
    code: error.code,
    message: error.message,
    providerId: error instanceof ProviderError ? error.providerId : undefined,
    timeoutMs: error instanceof ProviderTimeoutError ? error.timeoutMs : undefined,
    retryAfterSeconds:
      error instanceof ProviderRateLimitError ? error.retryAfterSeconds : undefined,
    reason: error instanceof InvalidProviderResponseError ? error.reason : undefined,
  };
}

export function handleTranslationPort(port: chrome.runtime.Port): void {
  if (port.name !== 'koma-translation' || port.sender?.id !== chrome.runtime.id) return;
  const cancelled = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => cancelled.abort());
  port.onMessage.addListener((message: ProviderTranslationRequest | { type: 'KEEP_ALIVE' }) => {
    if (message.type !== EXTENSION_MESSAGE_TYPES.TRANSLATE_IMAGE || started) return;
    started = true;
    void (async () => {
      try {
        const settings = await getProviderSettings();
        const config = settings.profiles[settings.provider];
        if (message.revision !== settings.revision)
          throw new ProviderError(
            'Provider settings changed. Press Translate again.',
            'KOMA_SETTINGS_CHANGED'
          );
        if (!message.request?.image?.base64Data || message.request.image.url) {
          throw new ProviderError(
            'Translation requires image data from the reader.',
            'KOMA_INVALID_IMAGE_ERROR'
          );
        }
        const controller = new AbortController();
        cancelled.signal.addEventListener('abort', () => controller.abort(), { once: true });
        const provider = createTranslationProvider(config, (input, init) => {
          init?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
          if (cancelled.signal.aborted || init?.signal?.aborted) controller.abort();
          return globalThis.fetch(input, { ...init, signal: controller.signal });
        });
        const result = await provider.translatePage(message.request);
        if ((await getProviderSettings()).revision !== message.revision)
          throw new ProviderError(
            'Provider settings changed. Press Translate again.',
            'KOMA_SETTINGS_CHANGED'
          );
        if (!cancelled.signal.aborted) port.postMessage({ success: true, result });
      } catch (error) {
        if (!cancelled.signal.aborted)
          port.postMessage({ success: false, error: serializeProviderError(error) });
      }
    })();
  });
}
