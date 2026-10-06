import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiTranslationProvider } from '../providers/gemini/provider';
import { OpenAITranslationProvider } from '../providers/openai/provider';

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['Gemini', GeminiTranslationProvider],
  ['OpenAI', OpenAITranslationProvider],
] as const)('%s rate-limit metadata', (_name, Provider) => {
  it.each([
    ['20', 20],
    ['Tue, 06 Oct 2026 12:00:45 GMT', 45],
    ['Tue, 06 Oct 2026 11:59:00 GMT', 0],
    ['invalid', undefined],
    ['-1', undefined],
    [null, undefined],
  ])('preserves Retry-After %s through the normalized provider error', async (header, expected) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 6, 12));
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 429,
        headers: header ? { 'Retry-After': header } : {},
      })
    );
    const provider = new Provider({ apiKey: 'placeholder-key', fetchFn });
    await expect(
      provider.translatePage({
        image: { id: 'page', pageIndex: 0, base64Data: 'aGVsbG8=' },
        targetLanguage: 'en',
      })
    ).rejects.toMatchObject({
      code: 'KOMA_RATE_LIMIT_ERROR',
      retryAfterSeconds: expected,
    });
  });
});
