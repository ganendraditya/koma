import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProviderConfig } from '../providers/config';
import { getProviderSettings, saveProviderSettings } from '../extension/settings/storage';
import {
  getRuntimeProviderConfig,
  handleTranslationPort,
} from '../extension/background/translation';
import { ExtensionTranslationProvider } from '../extension/content/provider';
import { CachedTranslationProvider } from '../core/cache/cached-provider';
import { ProviderAuthError, ProviderError } from '../core/errors';
import type { TranslationResult } from '../core/contracts';

const result: TranslationResult = {
  pageId: 'page_0',
  imageId: 'img',
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  bubbles: [
    {
      id: 'bubble_001',
      box: { ymin: 100, xmin: 100, ymax: 200, xmax: 200 },
      translatedText: 'Wait!',
    },
  ],
};
const request = {
  image: { id: 'img', pageIndex: 0, base64Data: 'aGVsbG8=', mimeType: 'image/png' },
  targetLanguage: 'en',
};

function runtime() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>) => ({
    get: (keys: string[], done: (value: Record<string, unknown>) => void) =>
      done(Object.fromEntries(keys.map((key) => [key, values[key]]))),
    set: (data: Record<string, unknown>, done: () => void) => {
      Object.assign(values, data);
      done();
    },
  });
  let lastPort: chrome.runtime.Port;
  const sent: unknown[] = [];
  const connect = vi.fn(() => {
    const workerListeners: ((message: unknown) => void)[] = [];
    const clientListeners: ((message: unknown) => void)[] = [];
    const disconnectListeners: (() => void)[] = [];
    const worker = {
      name: 'koma-translation',
      sender: { id: 'test-extension' },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => workerListeners.push(listener),
      },
      onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
      postMessage: (message: unknown) => clientListeners.forEach((listener) => listener(message)),
    };
    handleTranslationPort(worker as unknown as chrome.runtime.Port);
    lastPort = {
      onMessage: {
        addListener: (listener: (message: unknown) => void) => clientListeners.push(listener),
      },
      onDisconnect: { addListener: vi.fn() },
      postMessage: (message: unknown) => {
        sent.push(message);
        workerListeners.forEach((listener) => listener(message));
      },
      disconnect: () => disconnectListeners.forEach((listener) => listener()),
    } as unknown as chrome.runtime.Port;
    return lastPort;
  });
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', connect },
    storage: { local: area(local), session: area(session) },
  });
  return { sent, connect };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Extension provider bridge', () => {
  it('uses worker-owned credentials and transports only normalized results and typed errors', async () => {
    const { sent } = runtime();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'worker-secret' },
      'en'
    );
    const metadata = await getRuntimeProviderConfig();
    expect(JSON.stringify(metadata)).not.toContain('worker-secret');
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  bubbles: [{ box_2d: [100, 100, 200, 200], translated_text: 'Wait!' }],
                }),
              },
            ],
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchFn);
    const provider = new ExtensionTranslationProvider(metadata);
    expect((await provider.translatePage(request)).bubbles[0].translatedText).toBe('Wait!');
    expect(JSON.stringify(sent)).not.toContain('worker-secret');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer worker-secret');
    fetchFn.mockResolvedValue(new Response('', { status: 401 }));
    await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('cancels in-flight work when settings change and rejects stale configuration', async () => {
    runtime();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'worker-secret' },
      'en'
    );
    const old = await getRuntimeProviderConfig();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            requestSignal = init.signal;
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      )
    );
    const provider = new ExtensionTranslationProvider(old);
    const pending = provider.translatePage(request);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'KOMA_SETTINGS_CHANGED' });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    provider.cancel();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    const settings = await getProviderSettings();
    await saveProviderSettings({ ...settings.profiles.openai, modelName: 'gpt-5-mini' }, 'en');
    await expect(
      new ExtensionTranslationProvider(old).translatePage(request)
    ).rejects.toMatchObject({ code: 'KOMA_SETTINGS_CHANGED' });
  });

  it('keeps the worker alive during a slow response and cleans up the port timer', async () => {
    vi.useFakeTimers();
    const { sent } = runtime();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'worker-secret' },
      'en'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 45000));
        return Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{"bubbles":[]}' }] }],
        });
      })
    );
    const pending = new ExtensionTranslationProvider(
      await getRuntimeProviderConfig()
    ).translatePage(request);
    await vi.advanceTimersByTimeAsync(45001);
    expect((await pending).bubbles).toEqual([]);
    expect(
      sent.filter((message) => (message as { type: string }).type === 'KEEP_ALIVE')
    ).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates cached translations by endpoint and reasoning configuration', async () => {
    const values = new Map<string, TranslationResult>();
    const cache = {
      get: async (key: string) => values.get(key) || null,
      set: async (key: string, value: TranslationResult) => {
        values.set(key, value);
      },
      clear: async () => values.clear(),
      delete: async (key: string) => values.delete(key),
      has: async (key: string) => values.has(key),
      size: async () => values.size,
    };
    const translate = vi.fn().mockResolvedValue(result);
    const wrap = (identity: string) =>
      new CachedTranslationProvider(
        {
          id: 'openai-compatible',
          name: 'compatible',
          modelName: 'vision-model',
          cacheIdentity: identity,
          capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
          translatePage: translate,
        },
        cache
      );
    await wrap('endpoint-a:low').translatePage(request);
    await wrap('endpoint-a:low').translatePage(request);
    await wrap('endpoint-b:low').translatePage(request);
    await wrap('endpoint-b:high').translatePage(request);
    expect(translate).toHaveBeenCalledTimes(3);
    expect(await cache.size()).toBe(3);
  });

  it('never accepts a reader URL as an arbitrary worker fetch request', async () => {
    runtime();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'worker-secret' },
      'en'
    );
    vi.stubGlobal('fetch', vi.fn());
    const config = await getRuntimeProviderConfig();
    const workerMessages: ((message: unknown) => void)[] = [];
    const postMessage = vi.fn();
    handleTranslationPort({
      name: 'koma-translation',
      sender: { id: 'test-extension' },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => workerMessages.push(listener),
      },
      onDisconnect: { addListener: vi.fn() },
      postMessage,
    } as unknown as chrome.runtime.Port);
    workerMessages[0]({
      type: 'TRANSLATE_IMAGE',
      revision: config.revision,
      request: { ...request, image: { ...request.image, url: 'https://private.example' } },
    });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage.mock.calls[0][0].error).toMatchObject({ code: 'KOMA_INVALID_IMAGE_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0][0].error).not.toBeInstanceOf(ProviderError);
  });
});
