import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationOrchestrator } from '../core/orchestrator/orchestrator';
import { CachedTranslationProvider } from '../core/cache/cached-provider';
import { KomaTranslationCache } from '../core/cache/cache';
import { GeminiTranslationProvider } from '../providers/gemini/provider';
import type { SiteAdapter } from '../adapters';
import type { TranslationProvider, TranslationResult, TranslationRequest } from '../core/contracts';
import type { IRenderer } from '../core/orchestrator/types';
import { InvalidProviderResponseError } from '../core/errors';
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
    expect(debug.mock.calls.flat().join(' ')).toContain('total: translation');
    expect(debug.mock.calls.flat().join(' ')).not.toContain('secret-test-key');
  });

  it('identifies normalization and rendering errors and permits a render retry', async () => {
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
    await orchestrator.retry(image.id, { onError });
    expect(onError.mock.calls[1][1].message).toBe('Translation failed at render stage');
    expect(orchestrator.getState().get(image.id)?.status).toBe('failed');
    expect(await orchestrator.retry(image.id)).toBe(true);
    expect(orchestrator.getState().get(image.id)?.status).toBe('completed');
  });
});
