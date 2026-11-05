// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mangadex.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { EXTENSION_MESSAGE_TYPES } from '../shared/messages';
import { CONTEXT_TERM_MAX_LENGTH } from '../shared/messages';
import type {
  ContextCommandOperation,
  ContextCommandResponse,
  ContextCommandOutcome,
  ProviderRuntimeConfig,
} from '../shared/messages';
import type { IContextManager } from '../core/context';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

const CHAPTER = 'f4d00fe4-ed62-446b-a144-5f3d42ca923c';
const CHAPTER_2 = 'a4d00fe4-ed62-446b-a144-5f3d42ca923d';
const SERIES = '0f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

function area(data: Record<string, unknown>) {
  return {
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
  };
}

function storedScopes(local: Record<string, unknown>) {
  return Object.entries(local)
    .filter(([key]) => key.startsWith('koma_context:v1:'))
    .map(([key, value]) => {
      const decoded = JSON.parse(decodeURIComponent(key.slice('koma_context:v1:'.length))) as [
        string,
        string,
        string | null,
        string | null,
        string,
      ];
      return {
        kind: decoded[0],
        seriesId: decoded[2],
        chapterId: decoded[3],
        targetLanguage: decoded[4],
        record: value as {
          replayRevision?: string;
          glossary?: { original: string; translation: string; isHard?: boolean }[];
        },
      };
    });
}

async function setup(options: { seriesLink?: boolean } = {}) {
  vi.stubGlobal('crypto', {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, bytes: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer,
    },
  });
  vi.stubGlobal('navigation', new EventTarget());
  window.history.replaceState({}, '', `/chapter/${CHAPTER}`);
  document.body.innerHTML = `<div class="md--reader-wrap">${
    options.seriesLink === false ? '' : `<a href="/title/${SERIES}">Series</a>`
  }</div><div class="md--reader-pages"></div>`;

  const local: Record<string, unknown> = {};
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
    storage: { local: area(local), session: area({}) },
  });

  const content = await import('../extension/content/content-script');
  const { handleContextStorageMessage } = await import('../extension/background/context');
  runtime.sendMessage.mockImplementation((message, done) => {
    if (message.type === EXTENSION_MESSAGE_TYPES.CONTEXT_STORAGE_COMMAND) {
      handleContextStorageMessage(
        message,
        {
          id: runtime.id,
          frameId: 0,
          url: window.location.href,
        } as chrome.runtime.MessageSender,
        (response) => done?.(response)
      );
    }
  });
  const command = (request: ContextCommandOperation) =>
    new Promise<ContextCommandResponse>((resolve) => {
      listeners[0](
        // The popup always sends its selected target language alongside the command.
        { type: EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND, targetLanguage: 'en', ...request },
        { id: 'test-extension' },
        resolve
      );
    });

  return {
    local,
    command,
    content,
    manager: content.sessionContextManager as IContextManager,
  };
}

const save = (original: string, translation: string, pinned: boolean) =>
  ({ operation: 'save', original, translation, pinned }) as const;

describe('context command surface', () => {
  it('rejects malformed commands without touching stored data', async () => {
    const { command, local } = await setup();
    await command({ operation: 'save', original: '覇気', translation: 'Haki', pinned: true });

    const unknownOperation = await command({
      operation: 'delete',
      original: '覇気',
    } as unknown as ContextCommandOperation);
    expect(unknownOperation.success).toBe(false);
    expect(unknownOperation.error).toBe('Invalid context command.');

    const nonString = await command({
      operation: 'save',
      original: 42,
      translation: 'Haki',
      pinned: true,
    } as unknown as ContextCommandOperation);
    expect(nonString.success).toBe(false);
    expect(nonString.error).toBe('Invalid context command.');

    const oversize = await command({
      operation: 'save',
      original: 'x'.repeat(CONTEXT_TERM_MAX_LENGTH + 1),
      translation: 'too long',
      pinned: false,
    });
    expect(oversize.success).toBe(false);
    expect(oversize.error).toBe('Invalid context command.');

    const response = await command({ operation: 'view' });
    expect(response.view?.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
    const series = storedScopes(local).find((entry) => entry.kind === 'series');
    expect(series?.record.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
  });

  it('reports the active scope, limits and an empty glossary before any edit', async () => {
    const { command } = await setup();
    const response = await command({ operation: 'view' });

    expect(response.success).toBe(true);
    expect(response.view?.supported).toBe(true);
    expect(response.view?.scope).toEqual({
      site: 'mangadex',
      chapterId: CHAPTER,
      seriesId: SERIES,
      targetLanguage: 'en',
    });
    expect(response.view?.glossary).toEqual([]);
    expect(response.view?.dialogue).toEqual([]);
    expect(response.view?.dialogueCount).toBe(0);
    expect(response.view?.dialogueLimit).toBe(15);
    expect(response.view?.glossaryLimit).toBe(50);
  });

  it('loads the new chapter scope before acknowledging a pin saved after navigation', async () => {
    const { command, local, content } = await setup();
    const config: ProviderRuntimeConfig = {
      revision: 1,
      id: 'openai-compatible',
      name: 'Fixture provider',
      modelName: 'fixture-vision',
      cacheIdentity: 'fixture-cache',
      targetLanguage: 'en',
      configured: true,
      capabilities: { vision: true, ocr: true, translation: true, boundingBoxes: true },
    };
    await command(save('ルフィ', 'Luffy', true));
    content.getOrCreateOrchestrator(config);
    await content.sessionContextManager.ready?.();

    window.history.pushState({}, '', `/chapter/${CHAPTER_2}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const response = await command(save('覇気', 'Haki', true));

    expect(response).toMatchObject({ success: true, outcome: 'added' });
    const series = storedScopes(local).find((entry) => entry.kind === 'series');
    expect(series?.record.glossary).toEqual([
      { original: 'ルフィ', translation: 'Luffy', isHard: true },
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);

    content.getOrCreateOrchestrator(config);
    await content.sessionContextManager.ready?.();
    const view = await command({ operation: 'view' });
    expect(view.view?.scope?.chapterId).toBe(CHAPTER_2);
    expect(view.view?.glossary).toEqual(series?.record.glossary);
  });

  it.each(['save', 'setPinned', 'remove'] as const)(
    'preserves a new pin when a stale tab sends %s',
    async (operation) => {
      const { local, content } = await setup();
      const { PersistentContextManager } = await import('../core/context');
      const { ExtensionContextStore } = await import('../extension/content/context-store');
      const scope = (chapterId: string) => ({
        reading: { site: 'mangadex', chapterId, seriesId: SERIES },
        targetLanguage: 'en',
      });
      const tabA = new PersistentContextManager({ store: new ExtensionContextStore() });
      const tabB = new PersistentContextManager({ store: new ExtensionContextStore() });
      const run = (
        manager: IContextManager,
        chapterId: string,
        command: ContextCommandOperation
      ) => {
        window.history.replaceState({}, '', `/chapter/${chapterId}`);
        return new Promise<ContextCommandResponse>((resolve) => {
          content.handleContentScriptMessage(
            { type: EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND, targetLanguage: 'en', ...command },
            { id: 'test-extension' } as chrome.runtime.MessageSender,
            (response) => resolve(response as ContextCommandResponse),
            manager
          );
        });
      };

      window.history.replaceState({}, '', `/chapter/${CHAPTER}`);
      await tabA.setScope(scope(CHAPTER));
      tabA.addGlossaryEntry({ original: '生徒会', translation: 'student council', isHard: false });
      tabA.addGlossaryEntry({ original: '消去', translation: 'remove me', isHard: true });
      await tabA.flush();
      window.history.replaceState({}, '', `/chapter/${CHAPTER_2}`);
      await tabB.setScope(scope(CHAPTER_2));

      const first = await run(tabA, CHAPTER, save('覇気', 'Haki', true));
      expect(first.success).toBe(true);
      const staleOperation: ContextCommandOperation =
        operation === 'save'
          ? save('ゾロ', 'Zoro', false)
          : operation === 'setPinned'
            ? { operation, original: '生徒会', pinned: true }
            : { operation, original: '消去' };
      const stale = await run(tabB, CHAPTER_2, staleOperation);
      expect(stale.success).toBe(true);
      const followup = await run(tabB, CHAPTER_2, save('猫又', 'Nekoma', false));
      expect(followup.success).toBe(true);

      window.history.replaceState({}, '', `/chapter/${CHAPTER_2}`);
      const fresh = new PersistentContextManager({ store: new ExtensionContextStore() });
      await fresh.setScope(scope(CHAPTER_2));
      expect(fresh.getGlossary()).toContainEqual({
        original: '覇気',
        translation: 'Haki',
        isHard: true,
      });
      if (operation === 'save') {
        expect(fresh.getGlossary()).toContainEqual({
          original: 'ゾロ',
          translation: 'Zoro',
          isHard: false,
        });
      } else if (operation === 'setPinned') {
        expect(fresh.getGlossary()).toContainEqual({
          original: '生徒会',
          translation: 'student council',
          isHard: true,
        });
      } else {
        expect(fresh.getGlossary()).not.toContainEqual(
          expect.objectContaining({ original: '消去' })
        );
      }
      expect(fresh.getGlossary()).toContainEqual({
        original: '猫又',
        translation: 'Nekoma',
        isHard: false,
      });
      expect(storedScopes(local).find((entry) => entry.kind === 'series')?.record.glossary).toEqual(
        fresh.getGlossary()
      );
    }
  );

  it('rejects a stale edit, reloads the winning term and returns the conflict to the editor', async () => {
    const { content } = await setup();
    const { PersistentContextManager } = await import('../core/context');
    const { ExtensionContextStore } = await import('../extension/content/context-store');
    const scope = {
      reading: { site: 'mangadex', chapterId: CHAPTER, seriesId: SERIES },
      targetLanguage: 'en',
    };
    const tabA = new PersistentContextManager({ store: new ExtensionContextStore() });
    const tabB = new PersistentContextManager({ store: new ExtensionContextStore() });
    await tabA.setScope(scope);
    tabA.addGlossaryEntry({ original: '覇気', translation: 'Ambition', isHard: false });
    await tabA.flush();
    await tabB.setScope(scope);
    tabA.addGlossaryEntry({ original: '覇気', translation: 'Haki', isHard: true });
    await tabA.flush();

    const response = await new Promise<ContextCommandResponse>((resolve) => {
      content.handleContentScriptMessage(
        {
          type: EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND,
          targetLanguage: 'en',
          ...save('覇気', 'Rubber', true),
        },
        { id: 'test-extension' } as chrome.runtime.MessageSender,
        (result) => resolve(result as ContextCommandResponse),
        tabB
      );
    });

    expect(response).toMatchObject({
      success: false,
      code: 'CONTEXT_CONFLICT',
      view: { glossary: [{ original: '覇気', translation: 'Haki', isHard: true }] },
    });
    expect(response.error).toContain('changed in another tab');
    expect(tabB.getGlossary()).toEqual([{ original: '覇気', translation: 'Haki', isHard: true }]);
  });

  it('adds a pinned term to the series and target-language scope and persists it', async () => {
    const { command, local } = await setup();
    const response = await command(save('覇気', 'Haki', true));

    expect(response.success).toBe(true);
    expect(response.outcome).toBe<ContextCommandOutcome>('added');
    expect(response.view?.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);

    const series = storedScopes(local).find((entry) => entry.kind === 'series');
    const chapter = storedScopes(local).find((entry) => entry.kind === 'chapter');
    expect(series?.seriesId).toBe(SERIES);
    expect(series?.targetLanguage).toBe('en');
    expect(series?.record.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
    // The chapter record keeps dialogue only; the glossary lives on the series scope.
    expect(chapter?.record.glossary ?? []).toEqual([]);
  });

  it('falls back to the chapter scope when the series is unknown', async () => {
    const { command, local } = await setup({ seriesLink: false });
    await command(save('覇気', 'Haki', true));

    const scopes = storedScopes(local);
    expect(scopes).toHaveLength(1);
    expect(scopes[0].kind).toBe('chapter');
    expect(scopes[0].chapterId).toBe(CHAPTER);
    expect(scopes[0].seriesId).toBeNull();
  });

  it('updates an existing term and advances the replay revision', async () => {
    const { command, local } = await setup();
    const revision = () =>
      storedScopes(local).find((entry) => entry.kind === 'series')?.record.replayRevision;
    await command(save('覇気', 'Ambition', false));
    const before = revision();
    expect(typeof before).toBe('string');

    const response = await command(save('覇気', 'Haki', true));

    expect(response.success).toBe(true);
    expect(response.outcome).toBe<ContextCommandOutcome>('updated');
    expect(response.view?.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
    expect(revision()).not.toBe(before);
  });

  it('pins and unpins without touching the translation and only advances the revision on change', async () => {
    const { command, local } = await setup();
    const revision = () =>
      storedScopes(local).find((entry) => entry.kind === 'series')?.record.replayRevision;
    await command(save('生徒会', 'student council', false));
    const afterAdd = revision();

    const pinned = await command({ operation: 'setPinned', original: '生徒会', pinned: true });
    expect(pinned.outcome).toBe<ContextCommandOutcome>('pinned');
    expect(pinned.view?.glossary).toEqual([
      { original: '生徒会', translation: 'student council', isHard: true },
    ]);
    const afterPin = revision();
    expect(afterPin).not.toBe(afterAdd);

    const again = await command({ operation: 'setPinned', original: '生徒会', pinned: true });
    expect(again.outcome).toBe<ContextCommandOutcome>('unchanged');
    expect(revision()).toBe(afterPin);

    const unpinned = await command({ operation: 'setPinned', original: '生徒会', pinned: false });
    expect(unpinned.outcome).toBe<ContextCommandOutcome>('unpinned');
    expect(unpinned.view?.glossary).toEqual([
      { original: '生徒会', translation: 'student council', isHard: false },
    ]);
  });

  it('keeps a pinned term when the model proposes a soft glossary update', async () => {
    const { command, manager } = await setup();
    await command(save('覇気', 'Haki', true));

    manager.recordTranslation(
      {
        imageId: 'image-0',
        pageId: 'page_0',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        bubbles: [],
        contextDelta: { glossaryUpdates: [{ original: '覇気', translation: 'Ambition' }] },
      },
      0,
      'image-0'
    );

    const response = await command({ operation: 'view' });
    expect(response.view?.glossary).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
  });

  it('removes a term and reports unknown terms', async () => {
    const { command } = await setup();
    await command(save('覇気', 'Haki', true));

    const removed = await command({ operation: 'remove', original: '覇気' });
    expect(removed.success).toBe(true);
    expect(removed.outcome).toBe<ContextCommandOutcome>('removed');
    expect(removed.view?.glossary).toEqual([]);

    const missing = await command({ operation: 'remove', original: '覇気' });
    expect(missing.success).toBe(false);
    expect(missing.error).toBe('That term is no longer in the glossary.');
  });

  it('rejects empty values without writing anything', async () => {
    const { command, local } = await setup();

    const blankOriginal = await command(save('   ', 'Haki', true));
    expect(blankOriginal.success).toBe(false);
    expect(blankOriginal.error).toBe('Enter both the original term and its translation.');

    const blankTranslation = await command(save('覇気', '  ', true));
    expect(blankTranslation.success).toBe(false);
    expect(blankTranslation.error).toBe('Enter both the original term and its translation.');

    expect(storedScopes(local)).toEqual([]);
  });

  it('reports the glossary to a fresh reader session on the same scope', async () => {
    const { command, local } = await setup();
    await command(save('覇気', 'Haki', true));

    const { PersistentContextManager, ContextStore } = await import('../core/context');
    const reloaded = new PersistentContextManager({
      store: new ContextStore({ storageArea: area(local) }),
    });
    await reloaded.setScope({
      reading: { site: 'mangadex', chapterId: CHAPTER, seriesId: SERIES },
      targetLanguage: 'en',
    });

    expect(reloaded.getGlossary()).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);
  });
});
