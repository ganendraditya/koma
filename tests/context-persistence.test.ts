import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContextStorageArea,
  ContextStore,
  ContextAwareProvider,
  PersistentContextManager,
} from '@core/context';
import type {
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '@core/contracts';

function createMemoryStorage() {
  const data: Record<string, unknown> = {};
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const area: ContextStorageArea = {
    get(keys, callback) {
      const result =
        keys === null
          ? copy(data)
          : Object.fromEntries(
              keys.filter((key) => key in data).map((key) => [key, copy(data[key])])
            );
      callback?.(result);
    },
    set(items, callback) {
      Object.assign(data, copy(items));
      callback?.();
    },
    remove(keys, callback) {
      for (const key of [keys].flat()) delete data[key];
      callback?.();
    },
  };
  return { area, data };
}

const chapterOne = {
  reading: {
    site: 'mangadex',
    seriesId: '11111111-1111-4111-8111-111111111111',
    chapterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  targetLanguage: 'id',
};

function result(text: string) {
  return {
    bubbles: [
      {
        id: 'bubble_1',
        sourceText: '原文',
        translatedText: text,
      },
    ],
  };
}

function provider(id: string, text: string): TranslationProvider {
  const capabilities: ProviderCapabilities = {
    vision: true,
    ocr: true,
    translation: true,
    boundingBoxes: true,
  };
  return {
    id,
    name: id,
    capabilities: () => capabilities,
    async translatePage(request: TranslationRequest): Promise<TranslationResult> {
      return {
        pageId: 'page_0',
        imageId: request.image.id,
        sourceLanguage: 'ja',
        targetLanguage: request.targetLanguage,
        bubbles: [
          {
            id: `bubble-${id}`,
            sourceText: '原文',
            translatedText: text,
            box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
          },
        ],
      };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Persistent reading context', () => {
  it('restores chapter dialogue and shares glossary only within the known series and target language', async () => {
    const { area, data } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area });
    const manager = new PersistentContextManager({ store });
    await manager.setScope(chapterOne);
    manager.recordTranslation(result('Terjemahan halaman satu'), 0, 'mangadex:chapter-one:0');
    manager.addGlossaryEntry({ original: '覇気', translation: 'Haki', isHard: true });
    await manager.flush();

    const saved = JSON.stringify(data);
    expect(saved).toContain('Terjemahan halaman satu');
    expect(saved).toContain('Haki');
    expect(saved).not.toContain('base64Data');
    expect(saved).not.toContain('apiKey');
    expect(Object.keys(data).filter((key) => key.startsWith('koma_context:v1:'))).toHaveLength(2);

    const reloaded = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await reloaded.setScope(chapterOne);
    expect(reloaded.getPacket().targetLanguage).toBe('id');
    expect(reloaded.getPacket(1).recentDialogue?.map((entry) => entry.translatedText)).toEqual([
      'Terjemahan halaman satu',
    ]);
    expect(reloaded.getGlossary()).toEqual([
      { original: '覇気', translation: 'Haki', isHard: true },
    ]);

    const nextChapter = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await nextChapter.setScope({
      ...chapterOne,
      reading: { ...chapterOne.reading, chapterId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
    expect(nextChapter.getDialogueCount()).toBe(0);
    expect(nextChapter.getGlossary()).toHaveLength(1);

    const otherTarget = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await otherTarget.setScope({ ...chapterOne, targetLanguage: 'en' });
    expect(otherTarget.getDialogueCount()).toBe(0);
    expect(otherTarget.getGlossary()).toHaveLength(0);
  });

  it('uses chapter-only glossary scope when the adapter cannot identify a series', async () => {
    const { area } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area });
    const first = new PersistentContextManager({ store });
    await first.setScope({
      reading: { site: 'mangadex', chapterId: 'chapter-one' },
      targetLanguage: 'id',
    });
    first.addGlossaryEntry({ original: '先輩', translation: 'Kakak kelas', isHard: true });
    await first.flush();

    const second = new PersistentContextManager({ store: new ContextStore({ storageArea: area }) });
    await second.setScope({
      reading: { site: 'mangadex', chapterId: 'chapter-two' },
      targetLanguage: 'id',
    });
    expect(second.getGlossary()).toEqual([]);
  });

  it('retains scoped context when the active translation provider changes', async () => {
    const { area } = createMemoryStorage();
    const manager = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await manager.setScope(chapterOne);
    const firstProvider = new ContextAwareProvider(provider('provider-a', 'Terjemahan A'), manager);
    await firstProvider.translatePage({
      image: { id: 'page-0', pageIndex: 0 },
      targetLanguage: 'id',
    });

    await manager.setScope(chapterOne);
    const secondProvider = new ContextAwareProvider(
      provider('provider-b', 'Terjemahan B'),
      manager
    );
    const request: TranslationRequest = {
      image: { id: 'page-1', pageIndex: 1 },
      targetLanguage: 'id',
    };
    await secondProvider.translatePage(request);
    expect(manager.getPacket(2).recentDialogue?.map((entry) => entry.translatedText)).toEqual([
      'Terjemahan A',
      'Terjemahan B',
    ]);
  });

  it('clears only the active chapter and series context on reset', async () => {
    const { area, data } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area });
    const active = new PersistentContextManager({ store });
    await active.setScope(chapterOne);
    active.recordTranslation(result('Chapter dialogue'), 0, 'chapter-one-page-0');
    active.addGlossaryEntry({ original: '覇気', translation: 'Haki', isHard: true });
    await active.flush();

    const unrelated = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await unrelated.setScope({
      reading: {
        site: 'mangadex',
        seriesId: '22222222-2222-4222-8222-222222222222',
        chapterId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      targetLanguage: 'id',
    });
    unrelated.addGlossaryEntry({ original: '別語', translation: 'Istilah lain', isHard: true });
    await unrelated.flush();

    await active.reset();
    expect(active.getDialogueCount()).toBe(0);
    expect(active.getGlossary()).toEqual([]);
    expect(
      Object.values(data).some((record) => JSON.stringify(record).includes('Chapter dialogue'))
    ).toBe(false);
    expect(
      Object.values(data).some((record) => JSON.stringify(record).includes('Istilah lain'))
    ).toBe(true);
  });

  it('resets the captured scope without switching or deleting a different active chapter', async () => {
    const { area } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area });
    const chapterA = {
      reading: { site: 'mangadex', chapterId: 'chapter-a' },
      targetLanguage: 'id',
    };
    const chapterB = {
      reading: { site: 'mangadex', seriesId: 'series-b', chapterId: 'chapter-b' },
      targetLanguage: 'id',
    };

    const seedA = new PersistentContextManager({ store });
    await seedA.setScope(chapterA);
    seedA.recordTranslation(result('Chapter A dialogue'), 0, 'chapter-a-page');
    await seedA.flush();

    const seedB = new PersistentContextManager({ store });
    await seedB.setScope(chapterB);
    seedB.recordTranslation(result('Chapter B dialogue'), 0, 'chapter-b-page');
    await seedB.flush();

    const active = new PersistentContextManager({ store });
    await active.setScope(chapterB);
    await active.resetScope(chapterA);

    expect(active.getDialogueHistory().map((entry) => entry.translatedText)).toEqual([
      'Chapter B dialogue',
    ]);

    const reloadedA = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await reloadedA.setScope(chapterA);
    expect(reloadedA.getDialogueCount()).toBe(0);

    const reloadedB = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await reloadedB.setScope(chapterB);
    expect(reloadedB.getDialogueHistory().map((entry) => entry.translatedText)).toEqual([
      'Chapter B dialogue',
    ]);
  });

  it('waits for an in-flight scope load before deleting that scope and fences later reloads', async () => {
    const { area } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area });
    const chapterA = {
      reading: { site: 'mangadex', chapterId: 'chapter-a' },
      targetLanguage: 'id',
    };
    const chapterB = {
      reading: { site: 'mangadex', seriesId: 'series-b', chapterId: 'chapter-b' },
      targetLanguage: 'id',
    };

    const seedA = new PersistentContextManager({ store });
    await seedA.setScope(chapterA);
    seedA.recordTranslation(result('Stale Chapter A dialogue'), 0, 'chapter-a-page');
    await seedA.flush();

    const seedB = new PersistentContextManager({ store });
    await seedB.setScope(chapterB);
    seedB.recordTranslation(result('Chapter B dialogue'), 0, 'chapter-b-page');
    await seedB.flush();

    const get = area.get.bind(area);
    let releaseChapterA!: () => void;
    let delayChapterA = true;
    area.get = (keys, callback) => {
      if (delayChapterA && Array.isArray(keys) && keys.some((key) => key.includes('chapter-a'))) {
        delayChapterA = false;
        releaseChapterA = () => get(keys, callback);
        return;
      }
      get(keys, callback);
    };

    const active = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await active.setScope(chapterB);
    const loadingA = active.setScope(chapterA);
    await vi.waitFor(() => expect(releaseChapterA).toBeTypeOf('function'));
    await active.setScope(chapterB);
    const resetA = active.resetScope(chapterA);
    const reloadA = active.setScope(chapterA);

    releaseChapterA();
    await Promise.all([loadingA, resetA, reloadA]);
    expect(active.getDialogueCount()).toBe(0);

    const reloadedB = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await reloadedB.setScope(chapterB);
    expect(reloadedB.getDialogueHistory().map((entry) => entry.translatedText)).toEqual([
      'Chapter B dialogue',
    ]);
  });

  it('rolls back a context commit when cancellation arrives during its persistence flush', async () => {
    const { area, data } = createMemoryStorage();
    const manager = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await manager.setScope(chapterOne);
    const providerWithContext = new ContextAwareProvider(
      provider('delayed-storage', 'Committed before pause'),
      manager
    );

    const set = area.set.bind(area);
    let finishWrite!: () => void;
    let deferFirstWrite = true;
    area.set = (items, callback) => {
      if (!deferFirstWrite) {
        set(items, callback);
        return;
      }
      deferFirstWrite = false;
      set(items, () => {
        finishWrite = () => callback?.();
      });
    };

    const controller = new AbortController();
    const translation = providerWithContext.translatePage(
      {
        image: { id: 'mangadex:chapter-one:0', pageIndex: 0 },
        targetLanguage: 'id',
      },
      controller.signal
    );
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    controller.abort();
    finishWrite();

    await expect(translation).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.getDialogueCount()).toBe(0);
    expect(JSON.stringify(data)).not.toContain('Committed before pause');
  });

  it('does not restore a canceled commit after a scoped reset', async () => {
    const { area, data } = createMemoryStorage();
    const manager = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await manager.setScope(chapterOne);
    const providerWithContext = new ContextAwareProvider(
      provider('reset-during-flush', 'Must stay cleared'),
      manager
    );

    const set = area.set.bind(area);
    let finishWrite!: () => void;
    let deferFirstWrite = true;
    area.set = (items, callback) => {
      if (!deferFirstWrite) {
        set(items, callback);
        return;
      }
      deferFirstWrite = false;
      set(items, () => {
        finishWrite = () => callback?.();
      });
    };

    const controller = new AbortController();
    const translation = providerWithContext.translatePage(
      {
        image: { id: 'mangadex:chapter-one:0', pageIndex: 0 },
        targetLanguage: 'id',
      },
      controller.signal
    );
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    const reset = manager.resetScope(chapterOne);
    controller.abort();
    finishWrite();

    await expect(translation).rejects.toMatchObject({ name: 'AbortError' });
    await reset;
    expect(manager.getDialogueCount()).toBe(0);
    expect(JSON.stringify(data)).not.toContain('Must stay cleared');
  });

  it('keeps the configured number of scopes and evicts the least-recently-used record deterministically', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { area, data } = createMemoryStorage();
    const store = new ContextStore({ storageArea: area, maxScopes: 2 });
    const empty = { dialogueContributions: [], glossary: [] };

    await store.save('a', empty);
    now = 200;
    await store.save('b', empty);
    now = 300;
    await store.load('a');
    now = 400;
    await store.save('c', empty);

    const keys = Object.keys(data).filter((key) => key.startsWith('koma_context:v1:'));
    expect(keys.map((key) => key.split(':').at(-1)).sort()).toEqual(['a', 'c']);
  });

  it('purges corrupt snapshots and remains usable when storage operations fail', async () => {
    const { area, data } = createMemoryStorage();
    data['koma_context:v1:corrupt'] = { schemaVersion: 99, dialogueContributions: 'bad' };
    const store = new ContextStore({ storageArea: area });
    expect(await store.load('corrupt')).toBeNull();
    expect(data['koma_context:v1:corrupt']).toBeUndefined();

    const unavailable: ContextStorageArea = {
      get() {
        throw new Error('storage unavailable');
      },
      set() {
        throw new Error('storage unavailable');
      },
      remove() {
        throw new Error('storage unavailable');
      },
    };
    await expect(
      new ContextStore({ storageArea: unavailable }).save('failing', {
        dialogueContributions: [],
      })
    ).rejects.toThrow('storage unavailable');

    const manager = new PersistentContextManager({
      store: new ContextStore({ storageArea: unavailable }),
    });
    await manager.setScope(chapterOne);
    manager.recordTranslation(result('Memory remains usable'), 0, 'chapter-one-page-0');
    await expect(manager.flush()).resolves.toBeUndefined();
    expect(manager.getDialogueCount()).toBe(1);
  });
});
