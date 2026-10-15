// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import popupHtml from '../extension/popup/index.html?raw';
import { EXTENSION_MESSAGE_TYPES } from '../shared/messages';
import type { ContextCommandResponse, ContextView } from '../shared/messages';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
type PendingCommand = {
  operation: string;
  done: (response: ContextCommandResponse) => void;
};

function area(data: Record<string, unknown>) {
  return {
    get(keys: string[] | null, done: (value: Record<string, unknown>) => void) {
      done(keys ? Object.fromEntries(keys.map((key) => [key, data[key]])) : { ...data });
    },
    set(values: Record<string, unknown>, done: () => void) {
      Object.assign(data, values);
      done();
    },
    remove(keys: string | string[], done: () => void) {
      for (const key of [keys].flat()) delete data[key];
      done();
    },
  };
}

const view: ContextView = {
  supported: true,
  scope: {
    site: 'mangadex',
    chapterId: 'f4d00fe4-ed62-446b-a144-5f3d42ca923c',
    seriesId: '0f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    targetLanguage: 'en',
  },
  glossary: [{ original: '覇気', translation: 'Ambition', isHard: true }],
  dialogue: [],
  dialogueCount: 0,
  dialogueLimit: 15,
  glossaryLimit: 50,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.documentElement.innerHTML = '';
});

async function setup() {
  const local: Record<string, unknown> = {};
  const listeners: Listener[] = [];
  const pending: PendingCommand[] = [];
  let replyPageStatus: (() => void) | undefined;
  const runtime = {
    lastError: undefined,
    onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
  };
  const popup = document.implementation.createHTMLDocument('Popup');
  popup.documentElement.innerHTML = popupHtml;
  vi.stubGlobal('chrome', {
    runtime,
    storage: { local: area(local), session: area({}) },
    tabs: {
      query: vi
        .fn()
        .mockResolvedValue([
          { id: 3, url: 'https://mangadex.org/chapter/f4d00fe4-ed62-446b-a144-5f3d42ca923c' },
        ]),
      sendMessage: vi.fn((_tabId: number, message, done) => {
        if (message.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
          replyPageStatus = () => done({ imageCount: 3, isSupportedSite: true });
        } else if (message.type === EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND) {
          pending.push({ operation: message.operation, done });
        }
      }),
    },
  });

  const { initializePopup } = await import('../extension/popup/popup');
  await initializePopup(popup);
  replyPageStatus?.();
  await vi.waitFor(() => expect(pending[0]?.operation).toBe('view'));
  popup.getElementById('btn-toggle-context')!.click();
  await vi.waitFor(() => expect(pending[1]?.operation).toBe('view'));
  pending.shift()!.done({ success: true, view });
  pending.shift()!.done({ success: true, view });
  popup.querySelector<HTMLButtonElement>('[aria-label="Edit 覇気"]')!.click();
  (popup.getElementById('context-translation') as HTMLInputElement).value = 'Haki';
  popup.getElementById('context-translation')!.dispatchEvent(new Event('input'));

  return { popup, listeners, pending, local };
}

describe('popup glossary save lifecycle', () => {
  it('completes a successful save even when page progress requests a newer view', async () => {
    const { popup, listeners, pending } = await setup();
    popup
      .getElementById('context-term-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const saveResponse = pending.shift()!;
    expect(saveResponse.operation).toBe('save');

    listeners[0](
      {
        type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
        imageId: 'image-0',
        status: 'completed',
      },
      { tab: { id: 3 } as chrome.tabs.Tab },
      () => {}
    );
    const firstView = pending.shift()!;
    expect(firstView.operation).toBe('view');

    const savedView: ContextView = {
      ...view,
      glossary: [{ original: '覇気', translation: 'Haki', isHard: true }],
    };
    saveResponse.done({ success: true, outcome: 'updated', view: savedView });
    await vi.waitFor(() => expect(pending[0]?.operation).toBe('view'));
    firstView.done({ success: true, view });
    pending.shift()!.done({ success: true, view: savedView });

    expect((popup.getElementById('context-translation') as HTMLInputElement).value).toBe('');
    expect((popup.getElementById('context-original') as HTMLInputElement).disabled).toBe(false);
    expect(popup.getElementById('btn-cancel-term')!.hidden).toBe(true);
    expect(popup.getElementById('context-feedback')!.textContent).toContain(
      'Updated existing term.'
    );
    expect(popup.getElementById('context-glossary-list')!.textContent).toContain('Haki');
  });

  it('does not clear a newer draft typed while the earlier save is pending', async () => {
    const { popup, listeners, pending } = await setup();
    popup
      .getElementById('context-term-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const saveResponse = pending.shift()!;
    const translation = popup.getElementById('context-translation') as HTMLInputElement;
    translation.value = 'Will of D.';
    translation.dispatchEvent(new Event('input'));

    listeners[0](
      {
        type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
        imageId: 'image-0',
        status: 'completed',
      },
      { tab: { id: 3 } as chrome.tabs.Tab },
      () => {}
    );
    const firstView = pending.shift()!;
    const savedView: ContextView = {
      ...view,
      glossary: [{ original: '覇気', translation: 'Haki', isHard: true }],
    };
    saveResponse.done({ success: true, outcome: 'updated', view: savedView });
    await vi.waitFor(() => expect(pending[0]?.operation).toBe('view'));
    firstView.done({ success: true, view });
    pending.shift()!.done({ success: true, view: savedView });

    expect(translation.value).toBe('Will of D.');
    expect(popup.getElementById('context-feedback')!.textContent).toContain(
      'Updated existing term.'
    );
  });

  it('keeps the editor draft when a stale glossary edit is rejected', async () => {
    const { popup, pending } = await setup();
    popup
      .getElementById('context-term-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const saveResponse = pending.shift()!;
    const latestView: ContextView = {
      ...view,
      glossary: [{ original: '覇気', translation: 'Haki', isHard: true }],
    };
    saveResponse.done({
      success: false,
      code: 'CONTEXT_CONFLICT',
      error: 'This term changed in another tab. Your draft is still here.',
      view: latestView,
    });

    expect((popup.getElementById('context-translation') as HTMLInputElement).value).toBe('Haki');
    expect((popup.getElementById('context-original') as HTMLInputElement).disabled).toBe(true);
    expect(popup.getElementById('btn-cancel-term')!.hidden).toBe(false);
    expect(popup.getElementById('context-feedback')!.textContent).toContain(
      'changed in another tab'
    );
    expect(popup.getElementById('context-glossary-list')!.textContent).toContain('Haki');
  });
});
