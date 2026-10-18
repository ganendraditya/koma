import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_OVERSIZE_WARNING,
  CACHE_PERSISTENCE_WARNING,
  CONTEXT_CHANGED_WARNING,
  ReadingTranslationProvider,
  ReplayStore,
  REPLAY_PREFIX,
  replayKey,
  sha256,
  serializedBytes,
  type ReplayIdentity,
  type ReplayRecord,
} from '../core/cache';
import { ContextManager, ContextStore, PersistentContextManager } from '../core/context';
import type { TranslationProvider, TranslationRequest, TranslationResult } from '../core/contracts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function storage() {
  const data: Record<string, unknown> = {};
  const area = {
    get: vi.fn(async (keys: string[] | null) =>
      keys === null
        ? structuredClone(data)
        : Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, structuredClone(values));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete data[key];
    }),
  };
  return { data, area };
}

const reading = { site: 'mangadex', chapterId: 'chapter-a', seriesId: 'series-a' };
function identity(pageIndex = 0): ReplayIdentity {
  return {
    reading,
    pageIndex,
    sourceIdentity: `filename-${pageIndex}`,
    contentHash: 'a'.repeat(64),
    contextRevision: 'b'.repeat(64),
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    providerId: 'test',
    modelId: 'model-a',
    configuration: '["endpoint","prompt","auto"]',
    promptVersion: 1,
  };
}
function result(pageIndex = 0): TranslationResult {
  return {
    imageId: `image-${pageIndex}`,
    pageId: `page_${pageIndex}`,
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    bubbles: [
      {
        id: 'bubble',
        box: { ymin: 100, xmin: 100, ymax: 300, xmax: 400 },
        sourceText: '待て',
        translatedText: `Page ${pageIndex}`,
        readingOrder: 1,
      },
    ],
    contextDelta: { glossaryUpdates: [{ original: '名前', translation: `Name ${pageIndex}` }] },
  };
}
function record(pageIndex = 0): ReplayRecord {
  return {
    schemaVersion: 2,
    identity: identity(pageIndex),
    result: result(pageIndex),
    acceptedAt: 1,
    lastAccessedAt: 1,
    requestContextHash: 'c'.repeat(64),
  };
}
async function save(cache: ReplayStore, value: ReplayRecord) {
  const { generation } = await cache.lookup(value.identity);
  return cache.accept(value, generation);
}
function request(
  pageIndex = 0,
  url = `blob:https://mangadex.org/first-${pageIndex}`
): TranslationRequest {
  return {
    image: {
      id: `image-${pageIndex}`,
      sourceIdentity: `filename-${pageIndex}`,
      pageIndex,
      url,
      width: 800,
      height: 1200,
    },
    targetLanguage: 'en',
  };
}
function runtime(
  context: ContextManager,
  cache: ReplayStore,
  overrides: Partial<TranslationProvider> = {}
) {
  const translate = vi.fn(async (req: TranslationRequest) => result(req.image.pageIndex));
  const provider: TranslationProvider = {
    id: 'test',
    name: 'Test',
    modelName: 'model-a',
    cacheIdentity: '["endpoint","prompt","auto"]',
    capabilities: () => ({ vision: false, ocr: false, translation: true, boundingBoxes: true }),
    translatePage: translate,
    ...overrides,
  };
  const prepare = vi.fn(async (req: TranslationRequest) => ({
    ...req,
    image: {
      ...req.image,
      base64Data: btoa(`bytes-${req.image.pageIndex}`),
      mimeType: 'image/png',
    },
  }));
  const warn = vi.fn();
  const wrapped = new ReadingTranslationProvider(provider, {
    context,
    cache,
    getScope: () => ({ reading, targetLanguage: 'en' }),
    prepare,
    warn,
  });
  return { wrapped, translate, prepare, warn };
}

describe('Accepted reading replay', () => {
  it('restores three pages with full persisted context and new blob URLs without inference', async () => {
    const { area, data } = storage();
    const context = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await context.setScope({ reading, targetLanguage: 'en' });
    const cold = runtime(context, new ReplayStore({ storageArea: area }));
    for (let page = 0; page < 3; page++) {
      const translated = await cold.wrapped.translatePage(request(page));
      await cold.wrapped.acceptTranslation(translated);
    }
    expect(cold.translate).toHaveBeenCalledTimes(3);
    cold.translate.mock.calls.forEach(([req], page) => {
      expect(req.context?.recentDialogue?.map((d) => d.pageIndex)).toEqual(
        Array.from({ length: page }, (_, i) => i)
      );
      expect(req.image.base64Data).toBe(btoa(`bytes-${page}`));
    });
    const restored = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await restored.setScope({ reading, targetLanguage: 'en' });
    const replay = runtime(restored, new ReplayStore({ storageArea: area }));
    for (let repeat = 0; repeat < 2; repeat++) {
      for (let page = 0; page < 3; page++) {
        const req = request(page, `blob:https://mangadex.org/reloaded-${page}`);
        req.image.id = `new-session-${page}`;
        const translated = await replay.wrapped.translatePage(req);
        expect(translated.imageId).toBe(req.image.id);
        expect(translated.bubbles).toEqual(result(page).bubbles);
        await replay.wrapped.acceptTranslation(translated);
      }
    }
    expect(replay.translate).not.toHaveBeenCalled();
    expect(replay.prepare).toHaveBeenCalledTimes(6);
    expect(restored.getDialogueHistory().map((d) => d.pageIndex)).toEqual([0, 1, 2]);
    expect(
      JSON.stringify(Object.entries(data).filter(([k]) => k.startsWith(REPLAY_PREFIX)))
    ).not.toContain('base64Data');
  });

  it('does not publish or commit a result before the renderer accepts it', async () => {
    const context = new ContextManager();
    const cache = new ReplayStore();
    const { wrapped } = runtime(context, cache);
    const translated = await wrapped.translatePage(request());
    expect(await cache.size()).toBe(0);
    expect(context.getDialogueCount()).toBe(0);
    await wrapped.acceptTranslation(translated);
    expect(await cache.size()).toBe(1);
    expect(context.getDialogueCount()).toBe(1);
  });

  it('does not publish cancelled or invalid language results', async () => {
    const context = new ContextManager();
    const cache = new ReplayStore();
    const { wrapped } = runtime(context, cache);
    const translated = await wrapped.translatePage(request());
    const cancelled = AbortSignal.abort();
    await expect(wrapped.acceptTranslation(translated, cancelled)).rejects.toThrow();
    expect(await cache.size()).toBe(0);
    expect(context.getDialogueCount()).toBe(0);
    const wrong = runtime(context, cache, {
      translatePage: async () => ({ ...result(), targetLanguage: 'id' }),
    });
    await expect(wrong.wrapped.translatePage(request())).rejects.toThrow('invalid translation');
  });

  it('warns and skips publication when the glossary changes mid-translation', async () => {
    const { area } = storage();
    const context = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await context.setScope({ reading, targetLanguage: 'en' });
    const { wrapped, warn } = runtime(context, new ReplayStore({ storageArea: area }));
    const translated = await wrapped.translatePage(request(0));

    context.addGlossaryEntry({ original: '名前', translation: 'User name', isHard: true });
    await context.flush();

    await expect(wrapped.acceptTranslation(translated)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(CONTEXT_CHANGED_WARNING);
    expect(context.getDialogueCount()).toBe(0);
    expect(await new ReplayStore({ storageArea: area }).size()).toBe(0);
  });

  it('misses when bytes change even if the filename and URL are unchanged', async () => {
    const cache = new ReplayStore();
    const { wrapped, prepare, translate } = runtime(new ContextManager(), cache);
    await wrapped.acceptTranslation(await wrapped.translatePage(request()));
    prepare.mockImplementationOnce(async (req) => ({
      ...req,
      image: { ...req.image, base64Data: btoa('different bytes'), mimeType: 'image/png' },
    }));
    await wrapped.acceptTranslation(await wrapped.translatePage(request()));
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('invalidates a persisted glossary edit but not model soft updates or rolling dialogue', async () => {
    const { area } = storage();
    const context = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await context.setScope({ reading, targetLanguage: 'en' });
    const { wrapped, translate } = runtime(context, new ReplayStore({ storageArea: area }));
    await wrapped.acceptTranslation(await wrapped.translatePage(request()));
    await wrapped.acceptTranslation(await wrapped.translatePage(request()));
    expect(translate).toHaveBeenCalledTimes(1);
    context.addGlossaryEntry({ original: '名前', translation: 'User name', isHard: true });
    await context.flush();
    const restored = new PersistentContextManager({
      store: new ContextStore({ storageArea: area }),
    });
    await restored.setScope({ reading, targetLanguage: 'en' });
    const changed = runtime(restored, new ReplayStore({ storageArea: area }));
    await changed.wrapped.acceptTranslation(await changed.wrapped.translatePage(request()));
    expect(changed.translate).toHaveBeenCalledTimes(1);
    expect(changed.translate.mock.calls[0][0].context?.recentDialogue).toEqual([]);
    expect(changed.translate.mock.calls[0][0].context?.glossary).toContainEqual({
      original: '名前',
      translation: 'User name',
      isHard: true,
    });
  });

  it('retranslation invalidates the page and later replay without future dialogue in its prompt', async () => {
    const context = new ContextManager();
    const { wrapped, translate } = runtime(context, new ReplayStore());
    for (let page = 0; page < 3; page++)
      await wrapped.acceptTranslation(await wrapped.translatePage(request(page)));
    const redo = request(1);
    redo.options = { bypassCache: true };
    await wrapped.acceptTranslation(await wrapped.translatePage(redo));
    expect(translate.mock.calls[3][0].context?.recentDialogue?.map((d) => d.pageIndex)).toEqual([
      0,
    ]);
    await wrapped.acceptTranslation(await wrapped.translatePage(request(0)));
    expect(translate).toHaveBeenCalledTimes(4);
    await wrapped.acceptTranslation(await wrapped.translatePage(request(2)));
    expect(translate).toHaveBeenCalledTimes(5);
    expect(context.getDialogueCount()).toBe(3);
  });

  it.each(['customPrompt', 'temperature', 'sourceLanguage', 'modelName', 'cacheIdentity'] as const)(
    'isolates changed %s',
    async (field) => {
      const cache = new ReplayStore();
      const context = new ContextManager();
      const first = runtime(context, cache);
      await first.wrapped.acceptTranslation(await first.wrapped.translatePage(request()));
      const next = runtime(
        context,
        cache,
        field === 'cacheIdentity' ? { cacheIdentity: 'changed endpoint' } : {}
      );
      const req = request();
      if (field === 'sourceLanguage') req.sourceLanguage = 'ko';
      else if (field !== 'cacheIdentity')
        req.options = { [field]: field === 'temperature' ? 0.5 : 'changed' };
      await next.wrapped.acceptTranslation(await next.wrapped.translatePage(req));
      expect(next.translate).toHaveBeenCalledTimes(1);
    }
  );
});

describe('Persistent replay ownership and budgets', () => {
  it('scans extension storage once for cache maintenance instead of on every operation', async () => {
    const { area } = storage();
    const cache = new ReplayStore({ storageArea: area });

    await save(cache, record(0));
    await cache.lookup(identity(0));
    await save(cache, record(1));
    await cache.size();
    await cache.invalidate(reading, 'en', 1);

    expect(area.get).toHaveBeenCalledTimes(1);
    expect(area.get).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it('safe-misses v1 and purges corrupt v2 records without touching context/settings', async () => {
    const { data, area } = storage();
    data['koma_cache:koma:cache:v1:old'] = { result: result() };
    data[`${REPLAY_PREFIX}corrupt`] = { schemaVersion: 1 };
    data.koma_provider_settings = { apiKey: 'dummy-secret' };
    data['koma_context:v1:chapter'] = { dialogue: 'kept' };
    const cache = new ReplayStore({ storageArea: area });
    expect((await cache.lookup(identity())).record).toBeNull();
    expect(Object.keys(data)).toEqual(['koma_provider_settings', 'koma_context:v1:chapter']);
  });

  it('applies reduced persistent budgets during restart maintenance', async () => {
    const { data, area } = storage();
    const original = new ReplayStore({ storageArea: area });
    for (let page = 0; page < 3; page++) await save(original, record(page));
    const restart = new ReplayStore({ storageArea: area, maxRecords: 1 });
    expect(await restart.size()).toBe(1);
    expect(Object.keys(data)).toEqual([await replayKey(identity(2))]);
  });

  it('bounds memory-only replay with LRU without persisting oversized lookups', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area, maxRecordBytes: 10, maxMemoryEntries: 2 });
    await save(cache, record(0));
    await save(cache, record(1));
    await cache.lookup(identity(0));
    await save(cache, record(2));
    expect((await cache.lookup(identity(1))).record).toBeNull();
    expect((await cache.lookup(identity(0))).record).not.toBeNull();
    expect(await cache.size()).toBe(2);
    expect(area.set).not.toHaveBeenCalled();
    expect(data).toEqual({});
  });

  it('serializes clear behind an active write and rejects queued pre-clear acceptance', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    const { generation } = await cache.lookup(identity());
    let release!: () => void;
    area.set.mockImplementationOnce(async (values) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(data, structuredClone(values));
    });
    const accepting = cache.accept(record(), generation);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const clearing = cache.clear();
    const late = cache.accept(record(1), generation);
    release();
    await Promise.all([accepting, clearing]);
    expect((await late).warning).toContain('not saved');
    expect(data).toEqual({});
    expect(await cache.size()).toBe(0);
  });

  it.each([
    'targetLanguage',
    'providerId',
    'modelId',
    'sourceIdentity',
    'promptVersion',
    'reading',
  ] as const)('does not reuse a descriptor with changed %s', async (field) => {
    const cache = new ReplayStore();
    await save(cache, record());
    const changed = identity();
    if (field === 'reading') changed.reading = { ...reading, chapterId: 'chapter-b' };
    else if (field === 'promptVersion') changed.promptVersion = 2;
    else changed[field] = 'changed';
    expect((await cache.lookup(changed)).record).toBeNull();
  });

  it('verifies the full descriptor on lookup instead of trusting only its digest key', async () => {
    const { data, area } = storage();
    const key = await replayKey(identity());
    data[key] = { ...record(), identity: identity(1) };
    expect((await new ReplayStore({ storageArea: area }).lookup(identity())).record).toBeNull();
    expect(data[key]).toBeUndefined();
  });

  it('serializes concurrent accepts and evicts persistent LRU deterministically across restart', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area, maxRecords: 2 });
    await Promise.all([save(cache, record(0)), save(cache, record(1))]);
    await cache.lookup(identity(0));
    await save(cache, record(2));
    expect(data[await replayKey(identity(1))]).toBeUndefined();
    const restart = new ReplayStore({ storageArea: area, maxRecords: 2 });
    expect((await restart.lookup(identity(0))).record).not.toBeNull();
    expect((await restart.lookup(identity(2))).record).not.toBeNull();
  });

  it('enforces byte and per-record limits while retaining oversize results only in memory', async () => {
    const { data, area } = storage();
    const bytes = serializedBytes(await replayKey(identity()), record());
    const cache = new ReplayStore({ storageArea: area, maxBytes: bytes * 2 - 1 });
    for (let page = 0; page < 3; page++) await save(cache, record(page));
    expect(Object.keys(data).filter((k) => k.startsWith(REPLAY_PREFIX))).toHaveLength(1);
    const oversize = new ReplayStore({ storageArea: area, maxRecordBytes: 10 });
    expect(await save(oversize, record(3))).toEqual({ warning: CACHE_OVERSIZE_WARNING });
    expect((await oversize.lookup(identity(3))).record).not.toBeNull();
    expect(data[await replayKey(identity(3))]).toBeUndefined();
  });

  it('does not bypass the shared-storage headroom budget on retry', async () => {
    const { data, area } = storage();
    data.koma_context = 'x'.repeat(2000);
    const cache = new ReplayStore({ storageArea: area, quotaBytes: 2200 });
    expect(await save(cache, record())).toEqual({ warning: CACHE_PERSISTENCE_WARNING });
    expect(area.set).not.toHaveBeenCalled();
    expect(data.koma_context).toHaveLength(2000);
  });

  it('updates the cached quota index when unrelated extension storage changes', async () => {
    const { data, area } = storage();
    const listeners: Array<
      (changes: Record<string, { newValue?: unknown }>, areaName: string) => void
    > = [];
    vi.stubGlobal('chrome', {
      runtime: {},
      storage: {
        onChanged: {
          addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        },
      },
    });
    const cache = new ReplayStore({ storageArea: area, quotaBytes: 2200 });
    await cache.size();

    data.koma_context = 'x'.repeat(2000);
    for (const listener of listeners) {
      listener({ koma_context: { newValue: data.koma_context } }, 'local');
    }

    expect(await save(cache, record())).toEqual({ warning: CACHE_PERSISTENCE_WARNING });
    expect(area.set).not.toHaveBeenCalled();
    expect(area.get).toHaveBeenCalledTimes(1);
  });

  it('retries a quota write once after eviction and does not expose storage payloads', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    await save(cache, record());
    area.set.mockRejectedValueOnce(new Error('quota dummy-secret'));
    expect(await save(cache, record(1))).toEqual({});
    expect(data[await replayKey(identity())]).toBeUndefined();
    area.set.mockRejectedValue(new Error('quota dummy-secret'));
    const before = area.set.mock.calls.length;
    expect(await save(cache, record(2))).toEqual({ warning: CACHE_PERSISTENCE_WARNING });
    expect(area.set.mock.calls.length - before).toBe(2);
    expect((await cache.lookup(identity(2))).record).not.toBeNull();
  });

  it('keeps translation usable on read failure without writing against an unknown storage budget', async () => {
    const { area } = storage();
    area.get.mockRejectedValue(new Error('unavailable'));
    const cache = new ReplayStore({ storageArea: area });
    expect(await save(cache, record())).toEqual({ warning: CACHE_PERSISTENCE_WARNING });
    expect((await cache.lookup(identity())).record).not.toBeNull();
    expect(area.set).not.toHaveBeenCalled();
  });

  it('fences late acceptance after clear and after a worker restart', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    const old = await cache.lookup(identity());
    await save(cache, record(1));
    data.koma_provider = { apiKey: 'dummy-secret' };
    data['koma_context:v1:scope'] = { glossary: 'kept' };
    await cache.clear();
    await cache.accept(record(), old.generation);
    expect(await cache.size()).toBe(0);
    expect(Object.keys(data)).toEqual(['koma_provider', 'koma_context:v1:scope']);
    const restart = new ReplayStore({ storageArea: area });
    await restart.accept(record(), (await cache.lookup(identity())).generation);
    expect(await restart.size()).toBe(0);
  });

  it('does not stale an in-flight write when an unrelated series is invalidated', async () => {
    const { area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    const active = await cache.lookup(identity());
    const other = record();
    other.identity.reading = { site: 'mangadex', chapterId: 'chapter-b', seriesId: 'series-b' };
    const unrelated = await cache.lookup(other.identity);

    await cache.invalidate(other.identity.reading, 'en');

    expect(await cache.accept(record(), active.generation)).toEqual({});
    expect((await cache.accept(other, unrelated.generation)).warning).toContain('not saved');
  });

  it('scopes page-suffix invalidation to the selected chapter pages', async () => {
    const { area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    const first = await cache.lookup(identity(0));
    const suffix = await cache.lookup(identity(1));
    const anotherChapter = record(0);
    anotherChapter.identity.reading = { ...reading, chapterId: 'chapter-b' };
    const otherChapter = await cache.lookup(anotherChapter.identity);

    await cache.invalidate(reading, 'en', 1);

    expect(await cache.accept(record(0), first.generation)).toEqual({});
    expect((await cache.accept(record(1), suffix.generation)).warning).toContain('not saved');
    expect(await cache.accept(anotherChapter, otherChapter.generation)).toEqual({});
  });

  it('invalidates only the chapter suffix or matching series/target and retains records', async () => {
    const { data, area } = storage();
    const cache = new ReplayStore({ storageArea: area });
    for (let page = 0; page < 3; page++) await save(cache, record(page));
    const other = record(3);
    other.identity.reading = { ...reading, chapterId: 'chapter-b' };
    await save(cache, other);
    await cache.invalidate(reading, 'en', 1);
    expect((await cache.lookup(identity())).record).not.toBeNull();
    expect((await cache.lookup(identity(1))).record).toBeNull();
    expect((await cache.lookup(other.identity)).record).not.toBeNull();
    await cache.invalidate(reading, 'id');
    expect((await cache.lookup(other.identity)).record).not.toBeNull();
    await cache.invalidate(reading, 'en');
    expect((await cache.lookup(other.identity)).record).toBeNull();
    expect(Object.keys(data)).toHaveLength(4);
  });

  it('persists normalized domain data only, including whitelisted nested fields', async () => {
    const { data, area } = storage();
    const value = record();
    Object.assign(value.result, {
      rawVendor: { apiKey: 'dummy-secret' },
      base64Data: 'image buffer',
    });
    Object.assign(value.identity.reading, { rawVendor: 'dummy-secret' });
    Object.assign(value.result.bubbles[0], { rawVendor: 'dummy-secret' });
    await save(new ReplayStore({ storageArea: area }), value);
    expect(JSON.stringify(data)).not.toMatch(/dummy-secret|rawVendor|base64Data/);
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
