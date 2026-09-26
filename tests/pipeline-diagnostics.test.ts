import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationOrchestrator } from '../core/orchestrator/orchestrator';
import { CachedTranslationProvider } from '../core/cache/cached-provider';
import { KomaTranslationCache } from '../core/cache/cache';
import { generateCacheKey } from '../core/cache/key';
import { GeminiTranslationProvider } from '../providers/gemini/provider';
import type { SiteAdapter } from '../adapters';
import type { TranslationProvider, TranslationResult, TranslationRequest } from '../core/contracts';
import type { IRenderer } from '../core/orchestrator/types';
import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '../core/errors';
import { logPipeline } from '../core/diagnostics';

const image = {
  id: 'page-1',
  url: 'data:image/png;base64,dGVzdA==',
  base64Data: 'dGVzdA==',
  pageIndex: 0,
  width: 100,
  height: 100,
};
const request: TranslationRequest = { image, targetLanguage: 'id' };
const result: TranslationResult = {
  imageId: image.id,
  pageId: 'page_0',
  sourceLanguage: 'ja',
  targetLanguage: 'id',
  bubbles: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('development pipeline diagnostics', () => {
  it('does not emit pipeline logs in production mode', () => {
    vi.stubEnv('MODE', 'production');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logPipeline('provider', 'request', 12);
    expect(debug).not.toHaveBeenCalled();
  });

  it('reports cache miss and hit without making another provider request', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const provider: TranslationProvider = {
      id: 'example',
      name: 'Example',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn().mockResolvedValue(result),
    };
    const cached = new CachedTranslationProvider(provider, new KomaTranslationCache());

    await cached.translatePage(request);
    await cached.translatePage(request);

    expect(provider.translatePage).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith('[Koma pipeline] cache: miss');
    expect(debug).toHaveBeenCalledWith('[Koma pipeline] cache: hit');
  });

  it('reports cache hits when the visible image is served before entering the prefetch queue', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const cache = new KomaTranslationCache();
    const provider: TranslationProvider = {
      id: 'example',
      name: 'Example',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn(),
    };
    await cache.set(
      generateCacheKey({ image, targetLanguage: 'id', providerId: provider.id }),
      result
    );
    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: () => [image],
      observeMangaImages: () => () => {},
    };
    const render = vi.fn();
    const orchestrator = new TranslationOrchestrator(
      provider,
      adapter,
      { render },
      {
        cache,
        prefetchEnabled: false,
      }
    );

    await orchestrator.translateNext();

    expect(debug).toHaveBeenCalledWith('[Koma pipeline] cache: hit');
    expect(provider.translatePage).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(result);
  });

  it('reports stage timings and a sanitized provider failure without exposing the key', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }] }),
          { status: 200 }
        )
      );
    const provider = new GeminiTranslationProvider({ apiKey: 'secret-test-key', fetchFn });
    await provider.translatePage(request);
    expect(debug.mock.calls.flat().join(' ')).toMatch(/provider: request \([\d.]+ms\)/);
    expect(debug.mock.calls.flat().join(' ')).toMatch(/normalization: duration \([\d.]+ms\)/);
    expect(debug.mock.calls.flat().join(' ')).not.toContain('secret-test-key');

    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: () => [image],
      observeMangaImages: () => () => {},
    };
    const failing: TranslationProvider = {
      id: 'test',
      name: 'test',
      capabilities: () => provider.capabilities(),
      translatePage: vi.fn().mockRejectedValue(new Error('secret-test-key')),
    };
    const renderer: IRenderer = { render: vi.fn() };
    const orchestrator = new TranslationOrchestrator(failing, adapter, renderer);
    const onError = vi.fn();
    await orchestrator.translateNext({ onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][1].message).toBe('Translation failed at provider stage');
    expect(debug.mock.calls.flat().join(' ')).toContain('detection: scan');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('total: translation');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('secret-test-key');
  });

  it('identifies normalization and rendering errors and permits a render retry', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: () => [image],
      observeMangaImages: () => () => {},
    };
    const provider: TranslationProvider = {
      id: 'test',
      name: 'test',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi
        .fn()
        .mockRejectedValueOnce(new InvalidProviderResponseError('raw response', 'test'))
        .mockResolvedValue(result),
    };
    const renderer: IRenderer = {
      render: vi.fn().mockImplementationOnce(() => {
        throw new Error('bad DOM');
      }),
    };
    const orchestrator = new TranslationOrchestrator(provider, adapter, renderer);
    const onError = vi.fn();
    await orchestrator.translateNext({ onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][1].message).toBe('Translation failed at normalization stage');
    expect(onError.mock.calls[0][1]).toBeInstanceOf(InvalidProviderResponseError);
    expect(debug.mock.calls.flat().join(' ')).not.toContain('raw response');
    await orchestrator.retry(image.id, { onError });
    expect(onError.mock.calls[1][1].message).toBe('Translation failed at render stage');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('render: duration');
    expect(orchestrator.getState().get(image.id)?.status).toBe('failed');
    expect(await orchestrator.retry(image.id)).toBe(true);
    expect(orchestrator.getState().get(image.id)?.status).toBe('completed');
    expect(debug.mock.calls.flat().join(' ')).toContain('total: translation');
  });

  it('keeps actionable provider error types and retry metadata without forwarding sensitive messages', async () => {
    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: () => [image],
      observeMangaImages: () => () => {},
    };
    const errors = [
      new ProviderAuthError('secret-key', 'gemini'),
      new ProviderRateLimitError('secret-key', 'gemini', 15),
      new ProviderTimeoutError('secret-key', 'gemini', 5000),
    ];
    const provider: TranslationProvider = {
      id: 'gemini',
      name: 'gemini',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn().mockImplementation(() => Promise.reject(errors.shift())),
    };
    const orchestrator = new TranslationOrchestrator(provider, adapter, { render: vi.fn() });
    const onError = vi.fn();
    await orchestrator.translateNext({ onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await orchestrator.retry(image.id, { onError });
    await orchestrator.retry(image.id, { onError });

    expect(onError.mock.calls[0][1]).toBeInstanceOf(ProviderAuthError);
    expect(onError.mock.calls[1][1]).toBeInstanceOf(ProviderRateLimitError);
    expect(onError.mock.calls[1][1].retryAfterSeconds).toBe(15);
    expect(onError.mock.calls[2][1]).toBeInstanceOf(ProviderTimeoutError);
    expect(onError.mock.calls[2][1].timeoutMs).toBe(5000);
    expect(
      onError.mock.calls
        .flat()
        .map((value) => String(value))
        .join(' ')
    ).not.toContain('secret-key');
  });

  it('logs a failed detection without a successful scan or total translation duration', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: () => {
        throw new Error('reader failed');
      },
      observeMangaImages: () => () => {},
    };
    const provider: TranslationProvider = {
      id: 'test',
      name: 'test',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn(),
    };
    const orchestrator = new TranslationOrchestrator(provider, adapter, { render: vi.fn() });

    expect(await orchestrator.translateNext()).toBe(false);
    expect(debug).toHaveBeenCalledWith('[Koma pipeline] detection: failed');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('detection: scan');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('total: translation');
    expect(provider.translatePage).not.toHaveBeenCalled();
  });

  it('reports a second detection failure without starting a translation timer', async () => {
    vi.stubEnv('MODE', 'development');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const adapter: SiteAdapter = {
      name: 'test',
      matches: () => true,
      detectMangaImages: vi
        .fn()
        .mockReturnValueOnce([image])
        .mockImplementation(() => {
          throw new Error('reader changed');
        }),
      observeMangaImages: () => () => {},
    };
    const provider: TranslationProvider = {
      id: 'test',
      name: 'test',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn(),
    };
    const orchestrator = new TranslationOrchestrator(provider, adapter, { render: vi.fn() });
    const onError = vi.fn();
    await orchestrator.translateNext({ onError });

    expect(orchestrator.getState().get(image.id)?.status).toBe('failed');
    expect(onError.mock.calls[0][1].message).toBe('Translation failed at detection stage');
    expect(
      debug.mock.calls
        .flat()
        .join(' ')
        .match(/detection: scan/g)
    ).toHaveLength(1);
    expect(debug.mock.calls.flat().join(' ')).not.toContain('total: translation');
    expect(provider.translatePage).not.toHaveBeenCalled();
  });
});
