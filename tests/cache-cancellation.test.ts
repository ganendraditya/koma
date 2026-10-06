import { describe, expect, it, vi } from 'vitest';
import { CachedTranslationProvider, KomaTranslationCache } from '../core/cache';
import type { TranslationRequest, TranslationResult } from '../core/contracts';

function setup() {
  const result: TranslationResult = {
    imageId: 'original',
    pageId: 'page_0',
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    bubbles: [],
  };
  const pending: Array<{
    signal: AbortSignal;
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const translate = vi.fn(
    (_request: TranslationRequest, signal: AbortSignal) =>
      new Promise<TranslationResult>((resolve, reject) => {
        pending.push({ signal, resolve, reject });
      })
  );
  const cache = new KomaTranslationCache();
  const provider = new CachedTranslationProvider(
    {
      id: 'test',
      name: 'Test',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: translate,
    },
    cache
  );
  const request = (id: string, pageIndex = 0): TranslationRequest => ({
    image: { id, pageIndex, url: 'https://images.example/shared.png' },
    targetLanguage: 'en',
  });
  return { provider, translate, pending, cache, request, result };
}

describe('Shared cache requests and cancellation', () => {
  it.each([
    ['different signals', true, true],
    ['signal then no signal', true, false],
    ['no signal then signal', false, true],
  ] as const)('coalesces %s before and after cache lookup', async (_label, first, second) => {
    const { provider, translate, pending, request, result } = setup();
    const a = provider.translatePage(
      request('caller-a', 1),
      first ? new AbortController().signal : undefined
    );
    const b = provider.translatePage(
      request('caller-b', 2),
      second ? new AbortController().signal : undefined
    );
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    const c = provider.translatePage(request('caller-c', 3), new AbortController().signal);
    pending[0].resolve(result);
    const results = await Promise.all([a, b, c]);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(results.map(({ imageId, pageId }) => ({ imageId, pageId }))).toEqual([
      { imageId: 'caller-a', pageId: 'page_1' },
      { imageId: 'caller-b', pageId: 'page_2' },
      { imageId: 'caller-c', pageId: 'page_3' },
    ]);
  });

  it.each(['first', 'second'] as const)(
    'cancels the %s caller promptly while keeping the other caller alive',
    async (which) => {
      const { provider, pending, translate, cache, request, result } = setup();
      const first = new AbortController();
      const second = new AbortController();
      const a = provider.translatePage(request('caller-a'), first.signal);
      await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
      const b = provider.translatePage(request('caller-b', 2), second.signal);
      const cancelled = which === 'first' ? a : b;
      const survivor = which === 'first' ? b : a;
      const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      (which === 'first' ? first : second).abort();
      await rejection;
      expect(pending[0].signal.aborted).toBe(false);
      pending[0].resolve(result);
      expect((await survivor).imageId).toBe(which === 'first' ? 'caller-b' : 'caller-a');
      expect(translate).toHaveBeenCalledTimes(1);
      expect(await cache.size()).toBe(1);
    }
  );

  it('keeps an unsignalled caller alive when the signalled caller aborts', async () => {
    const { provider, pending, translate, request, result } = setup();
    const controller = new AbortController();
    const a = provider.translatePage(request('caller-a'), controller.signal);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    const b = provider.translatePage(request('caller-b'));
    const rejection = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(pending[0].signal.aborted).toBe(false);
    pending[0].resolve(result);
    expect((await b).imageId).toBe('caller-b');
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('aborts transport after all callers cancel and rejects late results during a fresh retry', async () => {
    const { provider, pending, translate, cache, request, result } = setup();
    const controllers = [new AbortController(), new AbortController()];
    const a = provider.translatePage(request('caller-a'), controllers[0].signal);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    const b = provider.translatePage(request('caller-b'), controllers[1].signal);
    const rejections = [a, b].map((task) =>
      expect(task).rejects.toMatchObject({ name: 'AbortError' })
    );
    controllers[0].abort();
    expect(pending[0].signal.aborted).toBe(false);
    controllers[1].abort();
    await Promise.all(rejections);
    expect(pending[0].signal.aborted).toBe(true);
    const fresh = provider.translatePage(request('fresh'), new AbortController().signal);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    pending[0].resolve(result);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cache.size()).toBe(0);
    const joined = provider.translatePage(request('joined'));
    pending[1].resolve(result);
    expect((await fresh).imageId).toBe('fresh');
    expect((await joined).imageId).toBe('joined');
    expect(translate).toHaveBeenCalledTimes(2);
    expect(await cache.size()).toBe(1);
  });

  it('cleans up a failed shared request so the next caller can retry', async () => {
    const { provider, pending, translate, request, result } = setup();
    const a = provider.translatePage(request('caller-a'), new AbortController().signal);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    const b = provider.translatePage(request('caller-b'), new AbortController().signal);
    const failure = new Error('Network failed');
    const rejections = [a, b].map((task) => expect(task).rejects.toBe(failure));
    pending[0].reject(failure);
    await Promise.all(rejections);
    const retry = provider.translatePage(request('retry'));
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    pending[1].resolve(result);
    expect((await retry).imageId).toBe('retry');
  });
});
