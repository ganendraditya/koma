import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationOrchestrator, type OrchestratorOptions } from '../core/orchestrator';
import { CachedTranslationProvider, KomaTranslationCache } from '../core/cache';
import { ContextAwareProvider, ContextManager } from '../core/context';
import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderRateLimitError,
} from '../core/errors';
import type { TranslationProvider, TranslationResult } from '../core/contracts';

function setup(options: OrchestratorOptions = {}) {
  const images = Array.from({ length: 12 }, (_, pageIndex) => ({
    id: `image-${pageIndex}`,
    pageIndex,
    url: `https://images.example/${pageIndex}.png`,
  }));
  let visible = 0;
  const result = (imageId: string): TranslationResult => ({
    imageId,
    pageId: imageId,
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    bubbles: [
      { id: 'b1', box: { ymin: 100, xmin: 100, ymax: 200, xmax: 200 }, translatedText: imageId },
    ],
  });
  const translate = vi.fn(async (request) => result(request.image.id));
  const provider: TranslationProvider = {
    id: 'test',
    name: 'Test',
    capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
    translatePage: translate,
  };
  const cache = new KomaTranslationCache();
  const context = new ContextManager();
  const renderer = { render: vi.fn(), removeAllOverlays: vi.fn() };
  const orchestrator = new TranslationOrchestrator(
    new ContextAwareProvider(new CachedTranslationProvider(provider, cache), context),
    {
      name: 'Test',
      matches: () => true,
      detectMangaImages: () => images,
      observeMangaImages: () => () => {},
    },
    renderer,
    {
      targetLanguage: 'en',
      positionResolver: (image) => ({
        top: (image.pageIndex - visible) * 1000,
        bottom: (image.pageIndex - visible) * 1000 + 900,
      }),
      viewportProvider: () => ({ top: 0, bottom: 800, height: 800 }),
      ...options,
    }
  );
  return {
    orchestrator,
    translate,
    cache,
    context,
    renderer,
    result,
    move: (page: number) => {
      visible = page;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('Controlled reading session', () => {
  it('retries failed upcoming pages on reader action without retranslating completed pages', async () => {
    const { orchestrator, translate, result } = setup();
    translate.mockImplementation(async (request) => {
      if (request.image.id !== 'image-0') throw new Error('Network failed');
      return result(request.image.id);
    });
    await orchestrator.translateNext();
    await vi.waitFor(() => expect(orchestrator.getSessionState().status).toBe('failed'));
    expect(orchestrator.getState().get('image-0')?.status).toBe('completed');
    expect(orchestrator.getState().get('image-1')?.status).toBe('failed');
    expect(orchestrator.getState().get('image-2')?.status).toBe('failed');
    await orchestrator.translateVisible();
    await orchestrator.prefetchUpcoming();
    expect(translate).toHaveBeenCalledTimes(3);
    translate.mockImplementation(async (request) => result(request.image.id));
    expect(await orchestrator.translateNext()).toBe(true);
    await vi.waitFor(() => expect(orchestrator.getSessionState().status).toBe('completed'));
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-1',
      'image-2',
      'image-1',
      'image-2',
    ]);
    expect(orchestrator.getSessionState().error).toBeUndefined();
    orchestrator.dispose();
  });

  it('keeps reader-triggered upcoming retries queued through cooldown and viewport refresh', async () => {
    vi.useFakeTimers();
    const { orchestrator, translate } = setup();
    translate
      .mockResolvedValueOnce({
        imageId: 'image-0',
        pageId: 'page_0',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        bubbles: [],
      })
      .mockRejectedValueOnce(new ProviderRateLimitError('Limited', 'test', 5));
    await orchestrator.translateNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(await orchestrator.translateNext()).toBe(true);
    await orchestrator.translateVisible();
    await vi.advanceTimersByTimeAsync(4999);
    expect(translate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-1',
      'image-1',
      'image-2',
    ]);
    expect(orchestrator.getSessionState().status).toBe('completed');
    orchestrator.dispose();
  });

  it('does not retry failures outside the current reading window', async () => {
    const { orchestrator, translate, move } = setup();
    translate.mockRejectedValueOnce(new Error('Network failed'));
    await orchestrator.translateNext();
    await vi.waitFor(() => expect(orchestrator.getSessionState().status).toBe('failed'));
    move(8);
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-10')?.status).toBe('completed')
    );
    expect(orchestrator.getState().get('image-0')?.status).toBe('failed');
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-1',
      'image-2',
      'image-8',
      'image-9',
      'image-10',
    ]);
    orchestrator.dispose();
  });

  it.each([
    ['authentication', new ProviderAuthError('Check your key', 'test')],
    ['invalid output', new InvalidProviderResponseError('Invalid output', 'test')],
  ])(
    'retains %s failure while eligible pages complete and only retries on reader action',
    async (_name, failure) => {
      const { orchestrator, translate } = setup();
      translate.mockRejectedValueOnce(failure);
      await orchestrator.translateNext();
      await vi.waitFor(() =>
        expect(orchestrator.getState().get('image-2')?.status).toBe('completed')
      );
      expect(orchestrator.getSessionState().error).toBeTruthy();
      await orchestrator.translateVisible();
      expect(translate).toHaveBeenCalledTimes(3);
      await orchestrator.translateNext();
      await vi.waitFor(() =>
        expect(orchestrator.getState().get('image-0')?.status).toBe('completed')
      );
      expect(translate).toHaveBeenCalledTimes(4);
      expect(orchestrator.getSessionState().error).toBeUndefined();
      orchestrator.dispose();
    }
  );

  it.each([
    [undefined, 30000],
    [0, 1000],
    [120000, 60000],
  ])(
    'bounds fallback cooldown %s to %s ms with no paid retry loop',
    async (configured, expected) => {
      vi.useFakeTimers();
      const { orchestrator, translate } = setup({ rateLimitCooldownMs: configured });
      translate.mockRejectedValue(new ProviderRateLimitError('Limited', 'test'));
      await orchestrator.translateNext();
      await vi.advanceTimersByTimeAsync(0);
      expect(translate).toHaveBeenCalledTimes(1);
      expect(orchestrator.getSessionState().cooldownUntil).toBe(Date.now() + expected);
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(translate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(expected * 4);
      expect(translate).toHaveBeenCalledTimes(3);
      expect(orchestrator.getQueueSize()).toBe(0);
      orchestrator.dispose();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('stops at the viewport window even after all eligible translations complete', async () => {
    const { orchestrator, translate, move } = setup();
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-2')?.status).toBe('completed')
    );
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-1',
      'image-2',
    ]);
    await orchestrator.translateNext();
    expect(translate).toHaveBeenCalledTimes(3);
    move(3);
    await orchestrator.translateVisible();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-5')?.status).toBe('completed')
    );
    expect(translate).toHaveBeenCalledTimes(6);
    orchestrator.dispose();
  });

  it('rejects late paused results before cache, dialogue, or overlay commits and can resume', async () => {
    const { orchestrator, translate, result, cache, context, renderer } = setup();
    let finish!: (value: TranslationResult) => void;
    translate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await orchestrator.translateNext();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    orchestrator.setTranslationEnabled(false);
    expect(orchestrator.getQueueSize()).toBe(0);
    finish(result('image-0'));
    await vi.waitFor(() => expect(orchestrator.getState().get('image-0')?.status).toBe('idle'));
    expect(await cache.size()).toBe(0);
    expect(context.getDialogueCount()).toBe(0);
    expect(renderer.render).not.toHaveBeenCalled();
    orchestrator.setTranslationEnabled(true);
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-2')?.status).toBe('completed')
    );
    expect(context.getDialogueCount()).toBe(3);
    orchestrator.dispose();
  });

  it('hides and restores accepted results without inference or dialogue duplication', async () => {
    const { orchestrator, translate, context, renderer } = setup();
    await orchestrator.translateNext();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-2')?.status).toBe('completed')
    );
    for (let repeat = 0; repeat < 3; repeat++) {
      orchestrator.setOverlaysVisible(false);
      orchestrator.setOverlaysVisible(true);
      orchestrator.setOverlaysVisible(true);
    }
    expect(translate).toHaveBeenCalledTimes(3);
    expect(context.getDialogueCount()).toBe(3);
    expect(renderer.render).toHaveBeenCalledTimes(12);
    expect(renderer.removeAllOverlays).toHaveBeenCalledTimes(3);
    orchestrator.dispose();
  });

  it('removes obsolete queued pages on a distant viewport jump', async () => {
    const { orchestrator, translate, result, move } = setup();
    let finish!: (value: TranslationResult) => void;
    translate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await orchestrator.translateNext();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    move(8);
    await orchestrator.translateVisible();
    expect(orchestrator.getQueuedImageIds()).toEqual(['image-8', 'image-9', 'image-10']);
    finish(result('image-0'));
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-10')?.status).toBe('completed')
    );
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-8',
      'image-9',
      'image-10',
    ]);
    orchestrator.dispose();
  });

  it('holds work while hidden and recalculates the window on foreground', async () => {
    const { orchestrator, translate, move } = setup();
    orchestrator.setPageVisible(false);
    await orchestrator.translateNext();
    expect(translate).not.toHaveBeenCalled();
    move(6);
    orchestrator.setPageVisible(true);
    await orchestrator.translateVisible();
    await vi.waitFor(() =>
      expect(orchestrator.getState().get('image-8')?.status).toBe('completed')
    );
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-6',
      'image-7',
      'image-8',
    ]);
    orchestrator.dispose();
  });

  it('respects Retry-After without automatically retrying the failed paid request', async () => {
    vi.useFakeTimers();
    const { orchestrator, translate } = setup();
    translate.mockRejectedValueOnce(new ProviderRateLimitError('Limited', 'test', 5));
    await orchestrator.translateNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(orchestrator.getState().get('image-0')?.error).toMatchObject({ retryAfterSeconds: 5 });
    expect(translate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(translate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(translate.mock.calls.map(([request]) => request.image.id)).toEqual([
      'image-0',
      'image-1',
      'image-2',
    ]);
    await orchestrator.translateVisible();
    await vi.advanceTimersByTimeAsync(60000);
    expect(translate).toHaveBeenCalledTimes(3);
    await orchestrator.retry('image-0');
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(4);
    orchestrator.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
