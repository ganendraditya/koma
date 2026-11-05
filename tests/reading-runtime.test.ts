// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import popupHtml from '../extension/popup/index.html?raw';
import { defaultProviderConfig } from '../providers/config';
import { EXTENSION_MESSAGE_TYPES } from '../shared/messages';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
});

async function setup() {
  vi.stubGlobal('crypto', {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, bytes: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer,
    },
  });
  const chapter = 'f4d00fe4-ed62-446b-a144-5f3d42ca923c';
  const navigation = new EventTarget();
  vi.stubGlobal('navigation', navigation);
  window.history.replaceState({}, '', `/chapter/${chapter}`);
  document.body.innerHTML =
    '<div class="md--reader-wrap"><div class="md--reader-pages"></div></div>';
  let visible = 0;
  const addImage = (pageIndex: number) => {
    const image = document.createElement('img');
    image.className = 'img';
    image.alt = `${pageIndex + 1}-${'a'.repeat(32)}.png`;
    image.src = 'data:image/png;base64,aGVsbG8=';
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 800 },
      naturalHeight: { value: 1200 },
    });
    image.getBoundingClientRect = () =>
      ({
        top: (pageIndex - visible) * 1500,
        bottom: (pageIndex - visible) * 1500 + 1200,
        width: 800,
        height: 1200,
      }) as DOMRect;
    document.querySelector('.md--reader-pages')!.append(image);
  };
  for (let page = 0; page < 8; page++) addImage(page);
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: (keys: string[] | null, done: (value: Record<string, unknown>) => void) =>
      done(keys ? Object.fromEntries(keys.map((key) => [key, data[key]])) : { ...data }),
    set: (values: Record<string, unknown>, done: () => void) => {
      Object.assign(data, values);
      done();
    },
    remove: (keys: string | string[], done: () => void) => {
      for (const key of [keys].flat()) delete data[key];
      done();
    },
  });
  const listeners: Listener[] = [];
  const runtime = {
    id: 'test-extension',
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
    sendMessage: vi.fn(),
    connect: vi.fn(),
  };
  vi.stubGlobal('chrome', {
    runtime,
    storage: { local: area(local), session: area(session) },
    permissions: { request: vi.fn().mockResolvedValue(true) },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 3, url: window.location.href }]),
      sendMessage: (_id: number, message: unknown, done?: (value: unknown) => void) => {
        if (done) return listeners[0](message, {}, done);
        return new Promise((resolve) => listeners[0](message, {}, resolve));
      },
    },
  });
  const { getRuntimeProviderConfig, handleTranslationPort } =
    await import('../extension/background/translation');
  const { handleContextStorageMessage } = await import('../extension/background/context');
  const { handleCacheMessage } = await import('../extension/background/cache');
  const { saveProviderSettings } = await import('../extension/settings/storage');
  await saveProviderSettings(
    {
      ...defaultProviderConfig('openai-compatible'),
      baseUrl: 'http://localhost:1234/v1',
      modelName: 'controlled-vision',
    },
    'en'
  );
  runtime.sendMessage.mockImplementation((message, done) => {
    if (message.type === EXTENSION_MESSAGE_TYPES.CACHE_COMMAND) {
      handleCacheMessage(
        message,
        {
          id: runtime.id,
          url: window.location.href,
          frameId: 0,
          tab: { id: 3 } as chrome.tabs.Tab,
        },
        done
      );
    } else if (message.type === EXTENSION_MESSAGE_TYPES.GET_PROVIDER_CONFIG) {
      void getRuntimeProviderConfig().then((config) => done({ success: true, config }));
    } else if (message.type === EXTENSION_MESSAGE_TYPES.CONTEXT_STORAGE_COMMAND) {
      handleContextStorageMessage(
        message,
        {
          id: runtime.id,
          frameId: 0,
          url: window.location.href,
          tab: { id: 3, url: window.location.href } as chrome.tabs.Tab,
        } as chrome.runtime.MessageSender,
        (response) => done?.(response)
      );
    } else {
      for (const listener of listeners)
        listener(message, { tab: { id: 3 } as chrome.tabs.Tab }, () => {});
      done?.({ status: 'OK', version: '0.1.0' });
    }
  });
  runtime.connect.mockImplementation(() => {
    const workerListeners: ((message: unknown) => void)[] = [];
    const clientListeners: ((message: unknown) => void)[] = [];
    const disconnect: (() => void)[] = [];
    handleTranslationPort({
      name: 'koma-translation',
      sender: { id: runtime.id },
      onMessage: { addListener: (fn: (message: unknown) => void) => workerListeners.push(fn) },
      onDisconnect: { addListener: (fn: () => void) => disconnect.push(fn) },
      postMessage: (message: unknown) => clientListeners.forEach((fn) => fn(message)),
    } as unknown as chrome.runtime.Port);
    return {
      onMessage: { addListener: (fn: (message: unknown) => void) => clientListeners.push(fn) },
      onDisconnect: { addListener: () => {} },
      postMessage: (message: unknown) => workerListeners.forEach((fn) => fn(message)),
      disconnect: () => disconnect.forEach((fn) => fn()),
    };
  });
  const response = () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              bubbles: [
                {
                  box_2d: [100, 100, 300, 400],
                  source_text: '待て',
                  translated_text: 'Controlled translation.',
                },
              ],
            }),
          },
          finish_reason: 'stop',
        },
      ],
    });
  const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith('data:')
      ? Promise.resolve(
          new Response('controlled image', { headers: { 'content-type': 'image/png' } })
        )
      : fetchFn(input, init)
  );
  const content = await import('../extension/content/content-script');
  const popup = document.implementation.createHTMLDocument('Popup');
  popup.documentElement.innerHTML = popupHtml;
  const { initializePopup } = await import('../extension/popup/popup');
  await initializePopup(popup);
  const click = (label: string) => {
    const button = [...popup.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === label
    );
    if (!button) throw new Error(`Missing control: ${label}`);
    expect(button.disabled).toBe(false);
    button.click();
  };
  const ready = (count: number) =>
    vi.waitFor(() =>
      expect(document.querySelectorAll('[data-koma-bubble-text]')).toHaveLength(count)
    );
  return {
    runtime,
    getRuntimeProviderConfig,
    navigation,
    content,
    popup,
    click,
    ready,
    fetchFn,
    response,
    local,
    addImage,
    move: (page: number) => {
      visible = page;
      window.dispatchEvent(new Event('scroll'));
    },
  };
}

describe('Popup to reader to worker session commands', () => {
  const reader = () => document.querySelector('[data-koma-reader-status]')!.shadowRoot!;
  const readerText = () => reader().querySelector('[role="status"]')!.textContent;
  const readerButton = (label: string) => {
    const button = [...reader().querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === label && !node.hidden
    );
    if (!button) throw new Error(`Missing reader control: ${label}`);
    return button;
  };

  it.each(['popup', 'reader'])(
    'retries a failed upcoming page from the %s without scrolling or repeating completed work',
    async (surface) => {
      const { popup, click, ready, fetchFn, response } = await setup();
      fetchFn
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
      click('Translate');
      await ready(2);
      await vi.waitFor(() =>
        expect(popup.getElementById('session-status')?.textContent).toContain('Use Retry Pages')
      );
      expect(fetchFn).toHaveBeenCalledTimes(3);
      if (surface === 'reader') {
        expect(readerText()).toBe('Translation needs attention');
        expect(reader().querySelector('.details')?.textContent).toContain(
          'Retry failed pages near your viewport'
        );
        readerButton('Retry Pages').click();
      } else click('Retry Pages');
      await ready(3);
      expect(fetchFn).toHaveBeenCalledTimes(4);
      await vi.waitFor(() =>
        expect(popup.getElementById('session-status')?.textContent).toContain('3 pages ready')
      );
    }
  );

  it('sends a popup-pinned glossary term as mandatory context for the next request', async () => {
    const { popup, click, ready, fetchFn } = await setup();
    popup.getElementById('btn-toggle-context')!.click();
    await vi.waitFor(() => expect(popup.getElementById('context-scope')?.hidden).toBe(false));
    expect(popup.getElementById('context-status')?.textContent).toContain('No dialogue kept yet');

    const original = popup.getElementById('context-original') as HTMLInputElement;
    const translation = popup.getElementById('context-translation') as HTMLInputElement;
    const pin = popup.getElementById('context-pin') as HTMLInputElement;
    const save = popup.getElementById('btn-save-term') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    original.value = '覇気';
    original.dispatchEvent(new Event('input'));
    translation.value = 'Haki';
    translation.dispatchEvent(new Event('input'));
    expect(save.disabled).toBe(false);
    pin.checked = true;
    click('Save Term');

    await vi.waitFor(() =>
      expect(popup.getElementById('context-glossary-list')?.textContent).toContain('Haki')
    );
    expect(popup.getElementById('context-feedback')?.textContent).toContain(
      'Retranslate Visible Page'
    );
    const termRow = popup.getElementById('context-glossary-list')!.querySelector('.context-badge');
    expect(termRow?.textContent).toBe('Pinned');

    click('Translate');
    await ready(3);
    const body = String(fetchFn.mock.calls[0][1]!.body);
    expect(body).toContain('覇気');
    expect(body).toContain('[MANDATORY]');
    await vi.waitFor(() => expect(popup.getElementById('context-status')?.hidden).toBe(true));
  });

  it('keeps reader feedback current without popup interaction and routes reader Pause/Resume through transport', async () => {
    const { click, ready, fetchFn, response, content, runtime, getRuntimeProviderConfig } =
      await setup();
    expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
    let release!: (value: Response) => void;
    let signal!: AbortSignal;
    fetchFn.mockImplementationOnce((_url, init) => {
      signal = init!.signal!;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    let settings!: (value: unknown) => void;
    runtime.sendMessage.mockImplementationOnce((_message, done) => {
      settings = done;
    });
    click('Translate');
    await vi.waitFor(() => expect(readerText()).toBe('Preparing translation'));
    settings({ success: true, config: await getRuntimeProviderConfig() });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(readerText()).toBe('Translating pages');
    expect(reader().querySelector('.counts')?.textContent).toBe(
      '0 pages ready, 1 active, 2 queued'
    );
    readerButton('Hide Status').click();
    const compact = readerButton('Koma: Translating pages');
    expect(reader().querySelector('section')?.hidden).toBe(true);
    expect(reader().activeElement).toBe(compact);
    expect(compact.getAttribute('aria-label')).toContain('Show Status');
    compact.click();
    expect(reader().activeElement?.textContent).toBe('Hide Status');
    readerButton('Pause').click();
    expect(signal.aborted).toBe(true);
    expect(readerText()).toBe('Translation paused');
    release(response());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readerText()).toBe('Translation paused');
    expect(content.sessionContextManager.getDialogueCount()).toBe(0);
    readerButton('Resume').click();
    await ready(3);
    await vi.waitFor(() => expect(readerText()).toBe('Pages ready'));
    expect(reader().querySelector('.counts')?.textContent).toBe(
      '3 pages ready, 0 active, 0 queued'
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
    readerButton('Hide Status').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
    );
    expect(reader().querySelector('section')?.hidden).toBe(true);
    expect(readerButton('Koma: Pages ready').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('[data-koma-reader-status]')).toHaveLength(1);
  });

  it('reports waiting for images and updates when production observation sees them load', async () => {
    const { click, ready, fetchFn, addImage, content } = await setup();
    document.querySelector('.md--reader-pages')!.replaceChildren();
    click('Translate');
    await vi.waitFor(() => expect(readerText()).toBe('Waiting for manga images'));
    expect(fetchFn).not.toHaveBeenCalled();
    addImage(0);
    await ready(1);
    await vi.waitFor(() => expect(readerText()).toBe('Pages ready'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    content.handleContentScriptMessage({ type: EXTENSION_MESSAGE_TYPES.RESET_CONTEXT });
    expect(readerText()).toBe('Translation paused');
  });

  it('promotes active context when MangaDex exposes the title link after the chapter starts', async () => {
    const { click, content, local } = await setup();
    document.querySelector('.md--reader-pages')!.replaceChildren();
    click('Translate');
    await vi.waitFor(() => expect(readerText()).toBe('Waiting for manga images'));
    await content.sessionContextManager.ready?.();

    content.sessionContextManager.addGlossaryEntry({
      original: 'late-term',
      translation: 'Late term',
      isHard: true,
    });
    await content.sessionContextManager.flush?.();

    document
      .querySelector('.md--reader-wrap')!
      .insertAdjacentHTML(
        'afterbegin',
        '<a href="/title/11111111-1111-4111-8111-111111111111/example-series">Example series</a>'
      );

    const storedScopes = () =>
      Object.keys(local)
        .filter((key) => key.startsWith('koma_context:v1:'))
        .map((key) => JSON.parse(decodeURIComponent(key.slice('koma_context:v1:'.length))));
    await vi.waitFor(() =>
      expect(
        storedScopes().some(
          (scope) => scope[0] === 'series' && scope[2] === '11111111-1111-4111-8111-111111111111'
        )
      ).toBe(true)
    );
    await content.sessionContextManager.flush?.();

    expect(content.sessionContextManager.getGlossary()).toContainEqual({
      original: 'late-term',
      translation: 'Late term',
      isHard: true,
    });
    expect(storedScopes().some((scope) => scope[0] === 'chapter' && scope[2] === null)).toBe(true);
    expect(
      storedScopes().some(
        (scope) => scope[0] === 'chapter' && scope[2] === '11111111-1111-4111-8111-111111111111'
      )
    ).toBe(true);
  });

  it('shows a real cooldown, blocks early retry and recovers only on explicit reader retry', async () => {
    const { click, fetchFn } = await setup();
    vi.useFakeTimers();
    try {
      fetchFn.mockResolvedValueOnce(
        new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
      );
      click('Translate');
      await vi.advanceTimersByTimeAsync(0);
      expect(readerText()).toBe('Rate limit reached');
      expect(reader().querySelector('.cooldown')?.textContent).toBe('Wait 3s before retrying.');
      expect(readerButton('Retry Pages').disabled).toBe(true);
      readerButton('Retry Pages').click();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(reader().querySelector('.cooldown')?.textContent).toBe('Wait 1s before retrying.');
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(readerText()).toBe('Translation needs attention');
      expect(readerButton('Retry Pages').disabled).toBe(false);
      readerButton('Retry Pages').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(readerText()).toBe('Pages ready');
      expect(fetchFn).toHaveBeenCalledTimes(4);
      window.dispatchEvent(new Event('pagehide'));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains actionable provider failures and reader retry leaves successful pages usable', async () => {
    const { click, fetchFn, ready } = await setup();
    fetchFn.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    click('Translate');
    await ready(2);
    await vi.waitFor(() => expect(readerText()).toBe('Translation needs attention'));
    expect(reader().querySelector('.details')?.textContent).toContain('Check your API key');
    readerButton('Retry Pages').click();
    await ready(3);
    await vi.waitFor(() => expect(readerText()).toBe('Pages ready'));
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('removes cooldown feedback and its timer when saved settings dispose the session', async () => {
    const { click, fetchFn, content } = await setup();
    vi.useFakeTimers();
    try {
      fetchFn.mockResolvedValueOnce(
        new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
      );
      click('Translate');
      await vi.advanceTimersByTimeAsync(0);
      expect(readerText()).toBe('Rate limit reached');
      content.handleContentScriptMessage({
        type: EXTENSION_MESSAGE_TYPES.PROVIDER_SETTINGS_CHANGED,
      });
      expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
      await vi.advanceTimersByTimeAsync(10000);
      expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resurrect preparation feedback when a configuration callback fails after teardown', async () => {
    const { click, runtime, fetchFn } = await setup();
    let respond!: (value: unknown) => void;
    runtime.sendMessage.mockImplementationOnce((_message, done) => {
      respond = done;
    });
    click('Translate');
    await vi.waitFor(() => expect(readerText()).toBe('Preparing translation'));
    window.dispatchEvent(new Event('pagehide'));
    expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
    respond({ success: false, error: 'Delayed settings error' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['settings', 'navigation', 'SPA navigation', 'teardown'])(
    'rejects delayed results after %s replaces the session',
    async (action) => {
      const { content, click, fetchFn, response, local, navigation } = await setup();
      let release!: (value: Response) => void;
      let signal!: AbortSignal;
      fetchFn.mockImplementationOnce((_url, init) => {
        signal = init!.signal!;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      click('Translate');
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
      if (action === 'settings')
        content.handleContentScriptMessage({
          type: EXTENSION_MESSAGE_TYPES.PROVIDER_SETTINGS_CHANGED,
        });
      else if (action === 'navigation') {
        window.history.pushState({}, '', '/chapter/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else if (action === 'SPA navigation') {
        const event = new Event('navigate');
        Object.defineProperty(event, 'destination', {
          value: { url: 'https://mangadex.org/chapter/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        });
        navigation.dispatchEvent(event);
      } else window.dispatchEvent(new Event('pagehide'));
      expect(signal.aborted).toBe(true);
      expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
      release(response());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(content.sessionContextManager.getDialogueCount()).toBe(0);
      expect(Object.keys(local).filter((key) => key.startsWith('koma_context:v1:'))).toHaveLength(
        0
      );
      expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:'))).toHaveLength(0);
      expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-koma-reader-status]')).toBeNull();
    }
  );

  it('aborts transport on Pause, rejects late success, resumes, and replays Hide/Show without provider work', async () => {
    const { content, popup, click, ready, fetchFn, response, local } = await setup();
    let release!: (value: Response) => void;
    let signal!: AbortSignal;
    fetchFn.mockImplementationOnce((_url?: unknown, init?: RequestInit) => {
      signal = init!.signal!;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    click('Translate');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    click('Pause');
    expect(signal.aborted).toBe(true);
    expect(popup.getElementById('session-status')?.textContent).toContain('Paused');
    release(response());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(content.sessionContextManager.getDialogueCount()).toBe(0);
    expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:'))).toHaveLength(0);
    expect(document.querySelectorAll('[data-koma-bubble-text]')).toHaveLength(0);
    click('Resume');
    await ready(3);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    for (let repeat = 0; repeat < 3; repeat++) {
      click('Hide Overlays');
      expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(0);
      expect(reader().querySelector('.details')?.textContent).toContain('Overlays are hidden.');
      click('Show Overlays');
      await ready(3);
      expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(3);
      expect(reader().querySelector('.details')?.textContent).not.toContain('Overlays are hidden.');
    }
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(content.sessionContextManager.getDialogueCount()).toBe(3);
  });

  it('uses production scroll and loaded-image events while preserving the window bound and navigation cleanup', async () => {
    const { content, click, ready, fetchFn, move, addImage } = await setup();
    click('Translate');
    await ready(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    move(5);
    await ready(6);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    addImage(8);
    addImage(9);
    move(7);
    await ready(8);
    expect(fetchFn).toHaveBeenCalledTimes(8);
    window.history.pushState({}, '', '/chapter/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(0);
    expect(content.sessionContextManager.getDialogueCount()).toBe(0);
    move(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchFn).toHaveBeenCalledTimes(8);
  });

  it('dispatches nothing in hidden tabs and starts the current window on foreground', async () => {
    const { click, ready, fetchFn, move } = await setup();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    click('Translate');
    await ready(3);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    move(5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await ready(6);
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('clears persisted reader context from the popup without deleting provider settings', async () => {
    const { click, ready, popup, local, content } = await setup();
    click('Translate');
    await ready(3);
    await vi.waitFor(() =>
      expect(Object.keys(local).some((key) => key.startsWith('koma_context:v1:'))).toBe(true)
    );

    const savedSettings = local.koma_provider_settings;
    popup.getElementById('btn-reset-context')!.click();
    await vi.waitFor(() =>
      expect(popup.getElementById('settings-feedback')?.textContent).toContain(
        'Context cleared for this reading scope.'
      )
    );

    expect(Object.keys(local).some((key) => key.startsWith('koma_context:v1:'))).toBe(false);
    expect(local.koma_provider_settings).toEqual(savedSettings);
    expect(content.sessionContextManager.getDialogueCount()).toBe(0);
    await ready(3);
  });

  it.each(['popup', 'reader'])(
    'Clear Cache from the %s preserves displayed results and context and resumes only explicitly',
    async (surface) => {
      const { click, ready, local, content, popup, fetchFn, move } = await setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      click('Translate');
      await ready(3);
      await vi.waitFor(() =>
        expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:v2:'))).toHaveLength(3)
      );
      const context = structuredClone(
        Object.fromEntries(Object.entries(local).filter(([k]) => k.startsWith('koma_context:')))
      );
      const settings = structuredClone(local.koma_provider_settings);
      if (surface === 'popup') click('Clear Cache');
      else readerButton('Clear Cache').click();
      await vi.waitFor(() =>
        expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:'))).toHaveLength(0)
      );
      await vi.waitFor(() =>
        expect(
          surface === 'popup'
            ? popup.getElementById('cache-feedback')?.textContent
            : reader().querySelector('.cache-feedback')?.textContent
        ).toContain('Translation cache cleared')
      );
      expect(content.sessionContextManager.getDialogueCount()).toBe(3);
      expect(local.koma_provider_settings).toEqual(settings);
      expect(
        Object.fromEntries(Object.entries(local).filter(([k]) => k.startsWith('koma_context:')))
      ).toEqual(context);
      await ready(3);
      move(4);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fetchFn).toHaveBeenCalledTimes(3);
      click('Resume');
      await ready(6);
      expect(fetchFn).toHaveBeenCalledTimes(6);
    }
  );

  it('Clear Cache cancels active transport and rejects late cache/context publication', async () => {
    const { click, ready, fetchFn, response, local, content } = await setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let release!: (value: Response) => void;
    let signal!: AbortSignal;
    fetchFn.mockImplementationOnce((_url, init) => {
      signal = init!.signal!;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    click('Translate');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    click('Clear Cache');
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    release(response());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:'))).toHaveLength(0);
    expect(content.sessionContextManager.getDialogueCount()).toBe(0);
    expect(document.querySelectorAll('[data-koma-bubble-text]')).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    click('Resume');
    await ready(3);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('requires confirmation for Clear Cache and explicit provider-cost retranslation', async () => {
    const { click, ready, local, fetchFn, popup } = await setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click('Translate');
    await ready(3);
    click('Clear Cache');
    expect(popup.getElementById('cache-feedback')?.textContent).toBe('');
    click('Retranslate Visible Page');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    confirm.mockReturnValue(true);
    click('Retranslate Visible Page');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect(popup.getElementById('session-status')?.textContent).toContain('3 pages ready')
    );
    const records = Object.values(local).filter(
      (v: unknown) => v && typeof v === 'object' && 'invalidated' in v
    );
    expect(records).toHaveLength(2);
  });

  it('does not restart translation while Reset Context is still invalidating replay', async () => {
    const { click, ready, runtime, content, fetchFn } = await setup();
    click('Translate');
    await ready(3);
    let complete!: () => void;
    const send = runtime.sendMessage.getMockImplementation()!;
    runtime.sendMessage.mockImplementation((message, done) => {
      if (
        message.type === EXTENSION_MESSAGE_TYPES.CACHE_COMMAND &&
        message.operation === 'invalidate'
      ) {
        complete = () => send(message, done);
      } else send(message, done);
    });
    const reset = vi.fn();
    content.handleContentScriptMessage(
      { type: EXTENSION_MESSAGE_TYPES.RESET_CONTEXT },
      undefined,
      reset
    );
    const translate = vi.fn();
    content.handleContentScriptMessage(
      { type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE },
      undefined,
      translate
    );
    expect(translate).toHaveBeenCalledWith({
      success: false,
      error: 'Wait for Reset Context to finish before resuming.',
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    complete();
    await vi.waitFor(() =>
      expect(reset).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await ready(3);
  });
});
