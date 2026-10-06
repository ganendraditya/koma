// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const chapter = 'f4d00fe4-ed62-446b-a144-5f3d42ca923c';
  const navigation = new EventTarget();
  vi.stubGlobal('navigation', navigation);
  window.history.replaceState({}, '', `/chapter/${chapter}`);
  document.body.innerHTML = '<div class="md--reader-pages"></div>';
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
      sendMessage: (_id: number, message: unknown, done: (value: unknown) => void) =>
        listeners[0](message, {}, done),
    },
  });
  const { getRuntimeProviderConfig, handleTranslationPort } =
    await import('../extension/background/translation');
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
    if (message.type === EXTENSION_MESSAGE_TYPES.GET_PROVIDER_CONFIG) {
      void getRuntimeProviderConfig().then((config) => done({ success: true, config }));
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
  it('retries a failed upcoming page from the popup without scrolling or repeating completed work', async () => {
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
    click('Retry Pages');
    await ready(3);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    await vi.waitFor(() =>
      expect(popup.getElementById('session-status')?.textContent).toContain('3 pages ready')
    );
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
      release(response());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(content.sessionContextManager.getDialogueCount()).toBe(0);
      expect(Object.keys(local).filter((key) => key.startsWith('koma_cache:'))).toHaveLength(0);
      expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
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
      click('Show Overlays');
      await ready(3);
      expect(document.querySelectorAll('[data-koma-wrapper]')).toHaveLength(3);
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
});
