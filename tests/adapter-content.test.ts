// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/mangadex-reader.html?raw';
import {
  EXTENSION_MESSAGE_TYPES,
  type CheckPageStatusResponse,
  type DiagnosticReport,
  type ProviderRuntimeConfig,
} from '@shared';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
});

async function loadContent(url: string) {
  document.body.innerHTML = fixture;
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 800 },
      naturalHeight: { value: 1200 },
    });
  });
  window.history.replaceState({}, '', url);
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener },
      sendMessage: vi.fn((message, respond) =>
        respond(
          message.type === EXTENSION_MESSAGE_TYPES.GET_PROVIDER_CONFIG
            ? { success: true, config: { ...runtimeConfig, configured: false } }
            : { status: 'OK', version: '0.1.0' }
        )
      ),
    },
  });
  await import('../extension/content/content-script');
  return addListener.mock.calls[0][0] as Listener;
}

describe('Adapter content-script integration', () => {
  it('reports adapter counts through the actual status and diagnostic handlers', async () => {
    const listener = await loadContent(
      'https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c'
    );
    const respond = vi.fn();
    listener({ type: EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS }, {}, respond);
    const status: CheckPageStatusResponse = respond.mock.lastCall![0];
    expect(status).toMatchObject({ active: true, isSupportedSite: true, imageCount: 2 });

    listener({ type: EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC }, {}, respond);
    const report: DiagnosticReport = respond.mock.lastCall![0];
    expect(report.contentScript.detectedImages).toBe(2);
    expect(report.serviceWorker.reachable).toBe(true);
  });

  it('reports unsupported pages without counting their artwork', async () => {
    const listener = await loadContent('https://mangadex.org/titles');
    const respond = vi.fn();
    listener({ type: EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS }, {}, respond);
    expect(respond.mock.lastCall![0]).toMatchObject({ isSupportedSite: false, imageCount: 0 });
    listener({ type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE }, {}, respond);
    expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
    listener({ type: EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC }, {}, respond);
    expect(respond.mock.lastCall![0].contentScript.detectedImages).toBe(0);
  });

  it('handles TRANSLATE_ACTIVE_PAGE and reports error when API key is missing', async () => {
    const listener = await loadContent(
      'https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c'
    );
    const respond = vi.fn();
    const keptOpen = listener({ type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE }, {}, respond);
    expect(keptOpen).toBe(true);

    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond.mock.lastCall![0]).toEqual({
      success: false,
      error: 'Configure Google Gemini in Provider Settings before translating.',
    });
    const status = document.querySelector('[data-koma-reader-status]')!.shadowRoot!;
    expect(status.querySelector('[role="status"]')?.textContent).toBe(
      'Translation could not start'
    );
    expect(status.querySelector('.details')?.textContent).toContain('Configure Google Gemini');
    expect(status.querySelector('button.action')?.textContent).toBe('Retry Translation');
  });

  it('renders with browser-bound fetch, carries context, and reuses cached translations', async () => {
    await loadContent('https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c');
    const prompts: string[] = [];
    const fetchMock = vi.fn(async function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      if (!String(input).startsWith('https://generativelanguage.googleapis.com/')) {
        return new Response('image bytes', { headers: { 'content-type': 'image/png' } });
      }
      const payload = JSON.parse(init?.body as string);
      prompts.push(payload.systemInstruction.parts[0].text);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    bubbles: [
                      {
                        box_2d: [100, 100, 300, 400],
                        source_text: '待て',
                        translated_text: 'Wait here.',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { handleTranslationPort } = await import('../extension/background/translation');
    const { saveProviderSettings } = await import('../extension/settings/storage');
    const { defaultProviderConfig } = await import('../providers/config');
    const { getRuntimeProviderConfig } = await import('../extension/background/translation');
    await saveProviderSettings(
      { ...defaultProviderConfig('gemini'), apiKey: 'test-key', modelName: 'test-model' },
      'en'
    );
    let config = await getRuntimeProviderConfig();
    chrome.runtime.id = 'test-extension';
    chrome.runtime.connect = vi.fn(() => {
      const workerListeners: ((message: unknown) => void)[] = [];
      const clientListeners: ((message: unknown) => void)[] = [];
      const disconnectListeners: (() => void)[] = [];
      const worker = {
        name: 'koma-translation',
        sender: { id: chrome.runtime.id },
        onMessage: {
          addListener: (listener: (message: unknown) => void) => workerListeners.push(listener),
        },
        onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
        postMessage: (message: unknown) => clientListeners.forEach((listener) => listener(message)),
      };
      handleTranslationPort(worker as unknown as chrome.runtime.Port);
      return {
        onMessage: {
          addListener: (listener: (message: unknown) => void) => clientListeners.push(listener),
        },
        onDisconnect: { addListener: vi.fn() },
        postMessage: (message: unknown) => workerListeners.forEach((listener) => listener(message)),
        disconnect: () => disconnectListeners.forEach((listener) => listener()),
      } as unknown as chrome.runtime.Port;
    });
    const { getOrCreateOrchestrator, overlayRenderer, translationCache, sessionContextManager } =
      await import('../extension/content/content-script');
    const orchestrator = getOrCreateOrchestrator(config);
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-koma-bubble-text]')).toHaveLength(2)
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('Wait here.');
    expect(prompts[1]).toContain('Wait here.');
    expect(await translationCache.size()).toBe(2);

    overlayRenderer.removeAllOverlays();
    sessionContextManager.reset();
    orchestrator.reset();
    fetchMock.mockClear();
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-koma-bubble-text]')).toHaveLength(2)
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionContextManager.getDialogueCount()).toBe(2);

    await saveProviderSettings(
      { ...defaultProviderConfig('gemini'), apiKey: 'test-key', modelName: 'other-model' },
      'en'
    );
    config = await getRuntimeProviderConfig();
    const changedModel = getOrCreateOrchestrator(config);
    sessionContextManager.reset();
    await changedModel.translateNext();
    await vi.waitFor(() =>
      expect([...changedModel.getState().values()].every((s) => s.status === 'completed')).toBe(
        true
      )
    );
    expect(prompts).toHaveLength(4);
    overlayRenderer.removeAllOverlays();
  });
});

const runtimeConfig: ProviderRuntimeConfig = {
  revision: 0,
  id: 'gemini-multimodal',
  name: 'Google Gemini',
  modelName: 'test-model',
  cacheIdentity: 'test',
  targetLanguage: 'en',
  configured: true,
  capabilities: { vision: true, ocr: true, translation: true, boundingBoxes: true },
};
