// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/mangadex-reader.html?raw';
import {
  EXTENSION_MESSAGE_TYPES,
  type CheckPageStatusResponse,
  type DiagnosticReport,
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
      sendMessage: vi.fn((_message, respond) => respond({ status: 'OK', version: '0.1.0' })),
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
    listener({ type: EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC }, {}, respond);
    expect(respond.mock.lastCall![0].contentScript.detectedImages).toBe(0);
  });
});
