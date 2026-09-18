import { describe, it, expect } from 'vitest';
import { generateCacheKey } from '../core/cache';
import type { TranslationResult } from '../core/contracts';

describe('KOMA-008 Stage 1: Deterministic Cache Key Generator', () => {
  it('generates identical keys for identical parameters', () => {
    const key1 = generateCacheKey({
      image: { id: 'img_001', url: 'https://cdn.example.com/ch1/p1.png' },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    });

    const key2 = generateCacheKey({
      image: { id: 'img_001', url: 'https://cdn.example.com/ch1/p1.png' },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    });

    expect(key1).toBe(key2);
  });

  it('strips transient query parameters like tokens and timestamps from image URLs', () => {
    const keyWithToken = generateCacheKey({
      image: {
        id: 'img_001',
        url: 'https://cdn.example.com/ch1/p1.png?token=secret123&t=1690000000',
      },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    });

    const keyWithoutToken = generateCacheKey({
      image: { id: 'img_001', url: 'https://cdn.example.com/ch1/p1.png' },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    });

    expect(keyWithToken).toBe(keyWithoutToken);
  });

  it('falls back to image.id for blob or data URLs', () => {
    const keyBlob = generateCacheKey({
      image: { id: 'page_42', url: 'blob:https://reader.example/uuid-1234' },
      targetLanguage: 'en',
    });

    const keyData = generateCacheKey({
      image: { id: 'page_42', url: 'data:image/png;base64,iVBORw0KGgo...' },
      targetLanguage: 'en',
    });

    expect(keyBlob).toContain(':page_42:');
    expect(keyData).toContain(':page_42:');
  });

  it('includes target language, providerId, and modelId in cache identity', () => {
    const baseInput = {
      image: { id: 'ch1_p1', url: 'https://cdn.example.com/p1.png' },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    };

    const keyBase = generateCacheKey(baseInput);

    const keyDiffLang = generateCacheKey({
      ...baseInput,
      targetLanguage: 'en',
    });

    const keyDiffModel = generateCacheKey({
      ...baseInput,
      modelId: 'gemini-3.8-flash',
    });

    const keyDiffProvider = generateCacheKey({
      ...baseInput,
      providerId: 'openai-multimodal',
    });

    expect(keyBase).not.toBe(keyDiffLang);
    expect(keyBase).not.toBe(keyDiffModel);
    expect(keyBase).not.toBe(keyDiffProvider);
  });

  it('differentiates cache keys when sourceLanguage is specified', () => {
    const keyJa = generateCacheKey({
      image: { id: 'img_001', url: 'https://cdn.example.com/p1.png' },
      sourceLanguage: 'ja',
      targetLanguage: 'id',
    });

    const keyKo = generateCacheKey({
      image: { id: 'img_001', url: 'https://cdn.example.com/p1.png' },
      sourceLanguage: 'ko',
      targetLanguage: 'id',
    });

    expect(keyJa).not.toBe(keyKo);
    expect(keyJa).toContain(':ja:');
    expect(keyKo).toContain(':ko:');
  });

  it('normalizes relative URLs and strips transient parameters', () => {
    const key1 = generateCacheKey({
      image: { id: 'img_rel', url: '/chapters/01/page_02.png?token=secret123&t=99999' },
      targetLanguage: 'id',
    });

    const key2 = generateCacheKey({
      image: { id: 'img_rel', url: '/chapters/01/page_02.png?token=differentToken&t=00000' },
      targetLanguage: 'id',
    });

    expect(key1).toBe(key2);
  });

  it('normalizes case for language, provider, and model', () => {
    const keyLower = generateCacheKey({
      image: { id: 'img_1' },
      targetLanguage: 'id',
      providerId: 'gemini-multimodal',
      modelId: 'gemini-3.5-flash-lite',
    });

    const keyUpper = generateCacheKey({
      image: { id: 'img_1' },
      targetLanguage: ' ID ',
      providerId: ' Gemini-Multimodal ',
      modelId: ' GEMINI-3.5-FLASH-LITE ',
    });

    expect(keyLower).toBe(keyUpper);
  });
});

describe('KOMA-008 Stage 2: Cache Store Engine (Memory + Persistent Storage)', () => {
  const sampleResult = {
    pageId: 'page_1',
    imageId: 'img_001',
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles: [
      {
        id: 'bubble_1',
        box: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
        sourceText: 'こんにちは',
        translatedText: 'Halo',
      },
    ],
  };

  it('stores and retrieves translation results in-memory', async () => {
    const cache = new (await import('../core/cache')).KomaTranslationCache();
    await cache.set('test_key_1', sampleResult);

    const retrieved = await cache.get('test_key_1');
    expect(retrieved).toEqual(sampleResult);
    expect(await cache.has('test_key_1')).toBe(true);
    expect(await cache.size()).toBe(1);

    await cache.delete('test_key_1');
    expect(await cache.has('test_key_1')).toBe(false);
    expect(await cache.get('test_key_1')).toBeNull();
  });

  it('evicts oldest entries when maxMemoryEntries is exceeded', async () => {
    const { KomaTranslationCache } = await import('../core/cache');
    const cache = new KomaTranslationCache({ maxMemoryEntries: 2 });

    await cache.set('key_1', { ...sampleResult, imageId: '1' });
    await cache.set('key_2', { ...sampleResult, imageId: '2' });
    await cache.set('key_3', { ...sampleResult, imageId: '3' });

    expect(await cache.has('key_1')).toBe(false);
    expect(await cache.has('key_2')).toBe(true);
    expect(await cache.has('key_3')).toBe(true);
  });

  it('interacts seamlessly with persistent storage backend', async () => {
    const { KomaTranslationCache } = await import('../core/cache');
    const storageStore: Record<string, unknown> = {};

    const mockStorage = {
      get: (
        keys: string | string[] | null | Record<string, unknown>,
        cb?: (items: Record<string, unknown>) => void
      ) => {
        if (keys === null) {
          cb?.({ ...storageStore });
          return Promise.resolve({ ...storageStore });
        }
        const key = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys[0] : '';
        const res = { [key]: storageStore[key] };
        cb?.(res);
        return Promise.resolve(res);
      },
      set: (items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageStore, items);
        cb?.();
        return Promise.resolve();
      },
      remove: (keys: string | string[], cb?: () => void) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) {
          delete storageStore[k];
        }
        cb?.();
        return Promise.resolve();
      },
    };

    const cache = new KomaTranslationCache({ storageArea: mockStorage });
    await cache.set('persist_key', sampleResult);

    expect(storageStore['koma_cache:persist_key']).toBeDefined();

    // Create fresh cache instance with empty memory to verify retrieval from storage
    const freshCache = new KomaTranslationCache({ storageArea: mockStorage });
    const loaded = await freshCache.get('persist_key');
    expect(loaded).toEqual(sampleResult);

    await freshCache.clear();
    expect(storageStore['koma_cache:persist_key']).toBeUndefined();
    expect(await freshCache.get('persist_key')).toBeNull();
  });

  it('fails gracefully and purges corrupted cache records without crashing', async () => {
    const { KomaTranslationCache } = await import('../core/cache');
    const storageStore: Record<string, unknown> = {
      'koma_cache:corrupt_key': {
        key: 'corrupt_key',
        result: { invalid: 'this is not a valid TranslationResult' },
      },
    };

    const mockStorage = {
      get: (keys: string | string[] | null | Record<string, unknown>) => {
        const key = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys[0] : '';
        return Promise.resolve({ [key]: storageStore[key] });
      },
      set: (items: Record<string, unknown>) => {
        Object.assign(storageStore, items);
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) {
          delete storageStore[k];
        }
        return Promise.resolve();
      },
    };

    const cache = new KomaTranslationCache({ storageArea: mockStorage });
    const result = await cache.get('corrupt_key');

    expect(result).toBeNull();
    // Corrupt key should have been purged
    expect(storageStore['koma_cache:corrupt_key']).toBeUndefined();
  });

  it('rejects caching invalid results when calling set()', async () => {
    const { KomaTranslationCache } = await import('../core/cache');
    const cache = new KomaTranslationCache();

    await cache.set('bad_result', { randomField: 123 } as unknown as TranslationResult);
    expect(await cache.get('bad_result')).toBeNull();
    expect(await cache.has('bad_result')).toBe(false);
  });
});

describe('KOMA-008 Stage 3: Cached Provider Wrapper (End-to-End Cache Hit Verification)', () => {
  const mockImage = {
    id: 'ch1_pg5',
    url: 'https://cdn.example.com/ch1/pg5.jpg?token=secret123',
    pageIndex: 4,
  };

  const mockResult = {
    pageId: 'page_4',
    imageId: 'ch1_pg5',
    sourceLanguage: 'ja',
    targetLanguage: 'id',
    bubbles: [
      {
        id: 'bubble_001',
        box: { ymin: 150, xmin: 500, ymax: 280, xmax: 750 },
        sourceText: '待て！',
        translatedText: 'Tunggu!',
      },
    ],
  };

  it('proves the core verification loop: 1st translation = 1 request, 2nd translation = 0 requests', async () => {
    const { CachedTranslationProvider, KomaTranslationCache } = await import('../core/cache');
    const { vi } = await import('vitest');

    const rawTranslateMock = vi.fn().mockResolvedValue(mockResult);
    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn().mockReturnValue({
        vision: true,
        ocr: true,
        translation: true,
        boundingBoxes: true,
        local: false,
        supportedSourceLanguages: ['ja'],
        supportedTargetLanguages: ['id', 'en'],
      }),
      translatePage: rawTranslateMock,
    };

    const cache = new KomaTranslationCache();
    const cachedProvider = new CachedTranslationProvider(mockProvider, cache);

    // First translation: Cache miss -> invokes provider
    const firstRes = await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });

    expect(rawTranslateMock).toHaveBeenCalledTimes(1);
    expect(firstRes).toEqual(mockResult);

    // Second translation with identical parameters: Cache hit -> 0 provider calls
    const secondRes = await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });

    expect(rawTranslateMock).toHaveBeenCalledTimes(1); // Still 1!
    expect(secondRes).toEqual(mockResult);

    // Overlays can be recreated from cached result identically
    expect(secondRes.bubbles[0].box).toEqual({ ymin: 150, xmin: 500, ymax: 280, xmax: 750 });
    expect(secondRes.bubbles[0].translatedText).toBe('Tunggu!');
  });

  it('bypasses cache when bypassCache option is true', async () => {
    const { CachedTranslationProvider, KomaTranslationCache } = await import('../core/cache');
    const { vi } = await import('vitest');

    const rawTranslateMock = vi.fn().mockResolvedValue(mockResult);
    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn(),
      translatePage: rawTranslateMock,
    };

    const cache = new KomaTranslationCache();
    const cachedProvider = new CachedTranslationProvider(mockProvider, cache);

    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(1);

    // Call again with bypassCache: true
    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
      options: { bypassCache: true },
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(2);
  });

  it('triggers fresh provider request when target language differs', async () => {
    const { CachedTranslationProvider, KomaTranslationCache } = await import('../core/cache');
    const { vi } = await import('vitest');

    const rawTranslateMock = vi
      .fn()
      .mockImplementation(async (req) => ({ ...mockResult, targetLanguage: req.targetLanguage }));

    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn(),
      translatePage: rawTranslateMock,
    };

    const cache = new KomaTranslationCache();
    const cachedProvider = new CachedTranslationProvider(mockProvider, cache);

    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(1);

    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'en',
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(2);
  });

  it('allows developers to clear cache and triggers fresh request afterwards', async () => {
    const { CachedTranslationProvider, KomaTranslationCache } = await import('../core/cache');
    const { vi } = await import('vitest');

    const rawTranslateMock = vi.fn().mockResolvedValue(mockResult);
    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn(),
      translatePage: rawTranslateMock,
    };

    const cache = new KomaTranslationCache();
    const cachedProvider = new CachedTranslationProvider(mockProvider, cache);

    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(1);

    await cachedProvider.clearCache();

    await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });
    expect(rawTranslateMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent in-flight requests for the same image to prevent cache stampede', async () => {
    const { CachedTranslationProvider, KomaTranslationCache } = await import('../core/cache');
    const { vi } = await import('vitest');

    // Simulate provider with network latency
    let resolveDelay: (val: typeof mockResult) => void;
    const delayedPromise = new Promise<typeof mockResult>((resolve) => {
      resolveDelay = resolve;
    });
    const rawTranslateMock = vi.fn().mockImplementation(() => delayedPromise);

    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn(),
      translatePage: rawTranslateMock,
    };

    const cache = new KomaTranslationCache();
    const cachedProvider = new CachedTranslationProvider(mockProvider, cache);

    // Fire 2 concurrent requests for identical image before the first resolves
    const req1 = cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });
    const req2 = cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });

    // Resolve the delayed provider response
    resolveDelay!(mockResult);

    const [res1, res2] = await Promise.all([req1, req2]);

    expect(res1).toEqual(mockResult);
    expect(res2).toEqual(mockResult);
    // Even though cache had not resolved yet, only 1 actual provider call was made
    expect(rawTranslateMock).toHaveBeenCalledTimes(1);
  });

  it('still returns translation result when cache.set throws an error', async () => {
    const { CachedTranslationProvider } = await import('../core/cache');
    const { vi } = await import('vitest');

    const rawTranslateMock = vi.fn().mockResolvedValue(mockResult);
    const mockProvider = {
      id: 'gemini-multimodal',
      name: 'Google Gemini Multimodal',
      capabilities: vi.fn(),
      translatePage: rawTranslateMock,
    };

    const failingCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error('QUOTA_BYTES_EXCEEDED')),
      has: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(false),
      clear: vi.fn().mockResolvedValue(undefined),
      size: vi.fn().mockResolvedValue(0),
    };

    const cachedProvider = new CachedTranslationProvider(mockProvider, failingCache);

    const result = await cachedProvider.translatePage({
      image: mockImage,
      targetLanguage: 'id',
    });

    expect(result).toEqual(mockResult);
    expect(rawTranslateMock).toHaveBeenCalledTimes(1);
  });
});
