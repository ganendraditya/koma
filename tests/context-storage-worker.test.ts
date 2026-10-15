import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createContextScopeId,
  type ContextScopeIds,
  type ContextWriteOptions,
  type StoredContextSnapshot,
} from '../core/context/context-store';
import { EXTENSION_MESSAGE_TYPES } from '../shared/messages';

const CHAPTER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAPTER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERIES = '11111111-1111-4111-8111-111111111111';

function createStorage() {
  const data: Record<string, unknown> = {};
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    data,
    area: {
      get(keys: string[] | null, done: (values: Record<string, unknown>) => void) {
        const values = keys
          ? Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
          : data;
        done(clone(values));
      },
      set(values: Record<string, unknown>, done: () => void) {
        Object.assign(data, clone(values));
        done();
      },
      remove(keys: string | string[], done: () => void) {
        for (const key of [keys].flat()) delete data[key];
        done();
      },
    },
  };
}

function createScopeIds(chapterId = CHAPTER_A): ContextScopeIds {
  return {
    chapter: createContextScopeId({
      kind: 'chapter',
      site: 'mangadex',
      seriesId: SERIES,
      chapterId,
      targetLanguage: 'en',
    }),
    glossary: createContextScopeId({
      kind: 'series',
      site: 'mangadex',
      seriesId: SERIES,
      targetLanguage: 'en',
    }),
  };
}

function options(
  glossaryChanges: ContextWriteOptions['glossaryChanges'],
  revision = 0
): ContextWriteOptions {
  return {
    dialogueChanges: [],
    glossaryChanges,
    expectedGlossaryRevision: revision,
    expectedChapterGeneration: 0,
    expectedGlossaryGeneration: 0,
    maxDialogueEntries: 15,
  };
}

function update(
  original: string,
  next: { original: string; translation: string; isHard: boolean } | null,
  source: 'user' | 'model' = 'user',
  expected: { original: string; translation: string; isHard: boolean } | null = null
): ContextWriteOptions['glossaryChanges'][number] {
  return { original, expected, next, source };
}

async function setup() {
  const storage = createStorage();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', lastError: undefined },
    storage: { local: storage.area },
  });
  const { handleContextStorageMessage } = await import('../extension/background/context');
  const send = (request: object, chapterId = CHAPTER_A, host = 'mangadex.org') =>
    new Promise<Record<string, unknown>>((resolve) => {
      const keptOpen = handleContextStorageMessage(
        { type: EXTENSION_MESSAGE_TYPES.CONTEXT_STORAGE_COMMAND, ...request },
        {
          id: 'test-extension',
          frameId: 0,
          url: `https://${host}/chapter/${chapterId}`,
        } as chrome.runtime.MessageSender,
        (response) => resolve(response as Record<string, unknown>)
      );
      if (!keptOpen) resolve({ success: false, error: 'Request rejected synchronously.' });
    });
  return { data: storage.data, send };
}

function saveRequest(
  scopeIds: ContextScopeIds,
  glossaryChanges: ContextWriteOptions['glossaryChanges'],
  revision = 0
) {
  return {
    operation: 'saveContext',
    scopeIds,
    options: options(glossaryChanges, revision),
  };
}

function storedGlossary(data: Record<string, unknown>) {
  const record = data[`koma_context:v1:${createScopeIds().glossary}`] as
    StoredContextSnapshot | undefined;
  return record?.glossary ?? [];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Context storage service worker coordinator', () => {
  it('serializes stale writes while preserving changes to different glossary terms', async () => {
    const { data, send } = await setup();
    const luffy = { original: 'ルフィ', translation: 'Luffy', isHard: true };
    const zoro = { original: 'ゾロ', translation: 'Zoro', isHard: false };
    const [tabA, tabB] = await Promise.all([
      send(saveRequest(createScopeIds(CHAPTER_A), [update(luffy.original, luffy)]), CHAPTER_A),
      send(
        saveRequest(createScopeIds(CHAPTER_B), [update(zoro.original, zoro, 'model')]),
        CHAPTER_B
      ),
    ]);

    expect(tabA.success).toBe(true);
    expect(tabB.success).toBe(true);
    expect(storedGlossary(data)).toEqual([luffy, zoro]);
  });

  it('rejects stale edits to the same term without replacing the winning value', async () => {
    const { data, send } = await setup();
    const luffy = { original: 'ルフィ', translation: 'Luffy', isHard: true };
    const rubber = { original: 'ルフィ', translation: 'Rubber', isHard: true };
    const [first, stale] = await Promise.all([
      send(saveRequest(createScopeIds(), [update(luffy.original, luffy)])),
      send(saveRequest(createScopeIds(CHAPTER_B), [update(rubber.original, rubber)]), CHAPTER_B),
    ]);

    expect(first.success).toBe(true);
    expect(stale).toMatchObject({ success: false, code: 'CONTEXT_CONFLICT' });
    expect(storedGlossary(data)).toEqual([luffy]);
  });

  it('does not let stale model updates replace a pin or revive a removed term', async () => {
    const { data, send } = await setup();
    const pinned = { original: '覇気', translation: 'Haki', isHard: true };
    const soft = { original: '生徒会', translation: 'student council', isHard: false };
    const changedSoft = { ...soft, translation: 'student council room' };
    await send(saveRequest(createScopeIds(), [update(pinned.original, pinned)]));
    await send(
      saveRequest(createScopeIds(CHAPTER_B), [
        update(pinned.original, { ...pinned, translation: 'Ambition' }, 'model'),
      ]),
      CHAPTER_B
    );
    await send(saveRequest(createScopeIds(), [update(soft.original, soft)]), CHAPTER_A);
    const remove = await send(
      saveRequest(createScopeIds(), [update(soft.original, null, 'user', soft)], 2)
    );
    expect(remove.success).toBe(true);
    await send(
      saveRequest(
        createScopeIds(CHAPTER_B),
        [update(soft.original, changedSoft, 'model', soft)],
        1
      ),
      CHAPTER_B
    );

    expect(storedGlossary(data)).toEqual([pinned]);
  });

  it('fences writes from a tab that loaded its scope before a reset', async () => {
    const { data, send } = await setup();
    const scopeIds = createScopeIds();
    const stalePin = { original: '覇気', translation: 'Haki', isHard: true };
    const reset = await send({
      operation: 'remove',
      scopeIds: [scopeIds.chapter, scopeIds.glossary],
    });
    const staleWrite = await send(saveRequest(scopeIds, [update(stalePin.original, stalePin)]));

    expect(reset.success).toBe(true);
    expect(staleWrite).toMatchObject({ success: false, code: 'CONTEXT_SCOPE_RESET' });
    expect(storedGlossary(data)).toEqual([]);
    expect(data['koma_context_epoch:v1:koma_context:v1:' + scopeIds.glossary]).toBe(1);
  });

  it('rejects context storage requests from a non-reader page', async () => {
    const { send } = await setup();
    const scopeIds = createScopeIds();
    const response = await send(
      saveRequest(scopeIds, [
        update('覇気', { original: '覇気', translation: 'Haki', isHard: true }),
      ]),
      CHAPTER_A,
      'example.com'
    );
    expect(response.success).toBe(false);
  });
});
