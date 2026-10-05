import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAITranslationProvider } from '../providers/openai/provider';
import { normalizeTranslationOutput } from '../providers/common/normalizer';
import { resolveReasoningEffort } from '../providers/openai/models';
import { validateTranslationResult, type TranslationRequest } from '../core/contracts';
import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '../core/errors';

const output = JSON.stringify({
  bubbles: [{ box_2d: [120, 600, 240, 850], source_text: '待て！', translated_text: 'Wait!' }],
});
const request: TranslationRequest = {
  image: { id: 'image-1', pageIndex: 0, base64Data: 'data:image/png;base64,aGVsbG8=' },
  targetLanguage: 'en',
  context: { recentDialogue: [{ translatedText: 'Come back.' }], glossary: [] },
};

function responseBody(text = output) {
  return {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [{ text: 'Not translation JSON.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ],
  };
}

function mockProvider(
  options: Partial<ConstructorParameters<typeof OpenAITranslationProvider>[0]> = {}
) {
  const fetchFn = vi.fn().mockResolvedValue(Response.json(responseBody()));
  const provider = new OpenAITranslationProvider({ apiKey: 'test-key', fetchFn, ...options });
  return { provider, fetchFn };
}

afterEach(() => vi.useRealTimers());

describe('OpenAI BYOK translation', () => {
  it('sends image and narrative context using Responses and normalizes only final output', async () => {
    const { provider, fetchFn } = mockProvider({ modelName: 'gpt-5-mini' });
    const result = await provider.translatePage(request);
    const [url, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(payload.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: request.image.base64Data,
      detail: 'high',
    });
    expect(payload.instructions).toContain('Come back.');
    expect(payload.reasoning).toEqual({ effort: 'low' });
    expect(payload).not.toHaveProperty('temperature');
    expect(payload.store).toBe(false);
    expect(payload.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(result.bubbles[0]).toMatchObject({ sourceText: '待て！', translatedText: 'Wait!' });
    expect(validateTranslationResult(result).valid).toBe(true);
  });

  it('supports compatible versioned paths, optional authentication, and provider-default reasoning', async () => {
    const { provider, fetchFn } = mockProvider({
      provider: 'openai-compatible',
      apiKey: '',
      baseUrl: 'http://localhost:1234/v1/',
      modelName: 'custom/vision-model',
      responseFormat: 'prompt',
    });
    fetchFn.mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: `\u003cthink\u003eInternal notes\u003c/think\u003e\n\`\`\`json\n${output}\n\`\`\``,
              reasoning_content: '{"wrong":true}',
            },
          },
        ],
      })
    );
    const result = await provider.translatePage(request);
    const [url, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(payload).not.toHaveProperty('reasoning_effort');
    expect(payload).not.toHaveProperty('response_format');
    expect(payload.messages[1].content[1].image_url.url).toBe(request.image.base64Data);
    expect(result.providerId).toBe('openai-compatible');
    expect(result.bubbles[0].translatedText).toBe('Wait!');
  });

  it('uses compatible reasoning_effort and JSON-object mode when explicitly selected', async () => {
    const { provider, fetchFn } = mockProvider({
      provider: 'openai-compatible',
      baseUrl: 'https://router.example/api/v1',
      modelName: 'vision-reasoner',
      reasoningEffort: 'high',
      responseFormat: 'json-object',
    });
    fetchFn.mockResolvedValue(
      Response.json({ choices: [{ message: { content: output }, finish_reason: 'stop' }] })
    );
    await provider.translatePage(request);
    const payload = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(payload.reasoning_effort).toBe('high');
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload).not.toHaveProperty('temperature');
  });

  it('collects split SSE events while ignoring reasoning and commentary', async () => {
    const { provider, fetchFn } = mockProvider();
    const events = [
      { type: 'response.reasoning_summary_text.delta', delta: 'secret reasoning' },
      { type: 'response.output_text.delta', delta: 'commentary' },
      { type: 'response.completed', response: responseBody() },
    ]
      .map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
      .join('');
    const bytes = new TextEncoder().encode(events);
    fetchFn.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 31));
            controller.enqueue(bytes.slice(31, 87));
            controller.enqueue(bytes.slice(87));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    );
    expect((await provider.translatePage(request)).bubbles[0].translatedText).toBe('Wait!');
  });

  it('assembles compatible content deltas and requires a completed stream', async () => {
    const { provider, fetchFn } = mockProvider({
      provider: 'openai-compatible',
      modelName: 'vision-model',
    });
    const events =
      [
        { choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: null }] },
        { choices: [{ delta: { content: output.slice(0, 20) }, finish_reason: null }] },
        { choices: [{ delta: { content: output.slice(20) }, finish_reason: 'stop' }] },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('') + 'data: [DONE]\n\n';
    fetchFn.mockResolvedValue(
      new Response(events, { headers: { 'content-type': 'text/event-stream' } })
    );
    expect((await provider.translatePage(request)).bubbles[0].translatedText).toBe('Wait!');
    fetchFn.mockResolvedValue(
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await expect(provider.translatePage(request)).rejects.toBeInstanceOf(
      InvalidProviderResponseError
    );
  });

  it.each([
    {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: responseBody().output,
    },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
    },
    { status: 'completed', output: [{ type: 'reasoning' }] },
  ])('rejects incomplete, refused, or reasoning-only results', async (body) => {
    const { provider, fetchFn } = mockProvider();
    fetchFn.mockResolvedValue(Response.json(body));
    await expect(provider.translatePage(request)).rejects.toBeInstanceOf(
      InvalidProviderResponseError
    );
  });

  it('rejects compatible truncated output even when the content parses as JSON', async () => {
    const { provider, fetchFn } = mockProvider({
      provider: 'openai-compatible',
      modelName: 'vision-model',
    });
    fetchFn.mockResolvedValue(
      Response.json({ choices: [{ finish_reason: 'length', message: { content: output } }] })
    );
    await expect(provider.translatePage(request)).rejects.toThrow(/token limit/i);
  });

  it('maps auth and rate-limit failures without exposing echoed credentials', async () => {
    const { provider, fetchFn } = mockProvider();
    fetchFn.mockResolvedValue(Response.json({ error: { message: 'test-key' } }, { status: 401 }));
    await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderAuthError);
    await expect(provider.translatePage(request)).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('test-key')
    );
    fetchFn.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '7' } }));
    await expect(provider.translatePage(request)).rejects.toMatchObject({
      constructor: ProviderRateLimitError,
      retryAfterSeconds: 7,
    });
  });

  it('keeps the request deadline active while the response body is stalled', async () => {
    vi.useFakeTimers();
    const { provider, fetchFn } = mockProvider({ defaultTimeoutMs: 100 });
    fetchFn.mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError'))
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    );
    const pending = expect(provider.translatePage(request)).rejects.toBeInstanceOf(
      ProviderTimeoutError
    );
    await vi.advanceTimersByTimeAsync(101);
    await pending;
  });
});

describe('Reasoning model capabilities', () => {
  it('uses low for recognized OpenAI reasoners and provider defaults for custom or unknown models', () => {
    expect(resolveReasoningEffort('gpt-5-mini', 'auto', false)).toBe('low');
    expect(resolveReasoningEffort('o4-mini-2025-04-16', 'auto', false)).toBe('low');
    expect(resolveReasoningEffort('unknown-model', 'auto', false)).toBeUndefined();
    expect(resolveReasoningEffort('gpt-5.5-custom', 'auto', false)).toBeUndefined();
    expect(resolveReasoningEffort('gpt-5-mini', 'auto', true)).toBeUndefined();
    expect(resolveReasoningEffort('gpt-4.1-mini', 'auto', false)).toBeUndefined();
  });

  it('rejects turning reasoning off where none is unsupported', () => {
    expect(() => resolveReasoningEffort('o4-mini', 'none', false)).toThrow(/does not support/i);
    expect(() => resolveReasoningEffort('gpt-5-mini', 'none', false)).toThrow(/does not support/i);
    expect(resolveReasoningEffort('gpt-5.1', 'none', false)).toBe('none');
    expect(() => resolveReasoningEffort('gpt-6.1-sol', 'none', false)).toThrow(/does not support/i);
    expect(resolveReasoningEffort('gpt-6-sol', 'none', false)).toBe('none');
    expect(resolveReasoningEffort('gpt-5.6-terra', 'max', false)).toBe('max');
  });
});

describe('Translation output boundary', () => {
  it.each(['', ' \n\t '])('keeps empty translations alongside other bubbles', (emptyText) => {
    const result = normalizeTranslationOutput({
      rawText: JSON.stringify({
        bubbles: [
          { box_2d: [100, 100, 200, 200], source_text: '...', translated_text: emptyText },
          { box_2d: [120, 600, 240, 850], source_text: '待て！', translated_text: 'Wait!' },
        ],
      }),
      imageId: 'img',
      targetLanguage: 'en',
      providerId: 'openai',
    });

    expect(result.bubbles).toHaveLength(2);
    expect(result.bubbles[0]).toMatchObject({
      sourceText: '...',
      translatedText: '',
      box: { ymin: 100, xmin: 100, ymax: 200, xmax: 200 },
    });
    expect(result.bubbles[1].translatedText).toBe('Wait!');
    expect(validateTranslationResult(result).valid).toBe(true);
  });

  it.each([
    { bubbles: [null] },
    { bubbles: [{ box_2d: [1, 2], translated_text: 'Wait' }] },
    { bubbles: [{ box_2d: [1, 2, 3, 4] }] },
    { bubbles: [{ box_2d: [1, 2, 3, 4], translated_text: null }] },
    { bubbles: [{ box_2d: [1, 2, 3, 4], translated_text: 123 }] },
    { bubbles: [], context_delta: { glossary_updates: 'bad' } },
  ])('rejects invalid model output with a typed error', (data) => {
    expect(() =>
      normalizeTranslationOutput({
        rawText: JSON.stringify(data),
        imageId: 'img',
        targetLanguage: 'en',
        providerId: 'openai',
      })
    ).toThrow(InvalidProviderResponseError);
  });
});
