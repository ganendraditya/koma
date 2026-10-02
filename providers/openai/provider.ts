import type {
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '@core/contracts';
import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '@core/errors';
import { logPipeline } from '@core/diagnostics';
import { normalizeBaseUrl, type ApiFormat, type ResponseFormat } from '../config';
import { loadImageData } from '../common/image';
import { buildTranslationPrompt, getTranslationResponseSchema } from '../common/prompt';
import { normalizeTranslationOutput } from '../common/normalizer';
import { resolveReasoningEffort, type ReasoningEffort } from './models';

export interface OpenAIProviderOptions {
  provider?: 'openai' | 'openai-compatible';
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  apiFormat?: ApiFormat;
  responseFormat?: ResponseFormat;
  reasoningEffort?: ReasoningEffort;
  defaultTimeoutMs?: number;
  maxOutputTokens?: number;
  fetchFn?: typeof fetch;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function* streamEvents(response: Response): AsyncGenerator<unknown> {
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 4 * 1024 * 1024) throw new Error('Stream event too large');
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data === '[DONE]' ? '[DONE]' : JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class OpenAITranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly name: string;
  readonly modelName: string;
  private readonly compatible: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiFormat: ApiFormat;
  private readonly responseFormat: ResponseFormat;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetch: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    this.compatible = options.provider === 'openai-compatible';
    this.id = this.compatible ? 'openai-compatible' : 'openai';
    this.name = this.compatible ? 'OpenAI-compatible' : 'OpenAI';
    this.apiKey = options.apiKey.trim();
    this.modelName = options.modelName?.trim() || 'gpt-4.1-mini';
    this.baseUrl = normalizeBaseUrl(options.baseUrl || 'https://api.openai.com/v1');
    this.apiFormat = options.apiFormat || (this.compatible ? 'chat-completions' : 'responses');
    this.responseFormat = options.responseFormat || (this.compatible ? 'prompt' : 'json-schema');
    this.reasoningEffort = options.reasoningEffort || 'auto';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120000;
    this.maxOutputTokens = options.maxOutputTokens ?? 16384;
    this.fetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  capabilities(): ProviderCapabilities {
    return {
      vision: true,
      ocr: true,
      translation: true,
      boundingBoxes: true,
      local: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.baseUrl).hostname),
      supportedSourceLanguages: ['ja', 'ko', 'zh'],
      supportedTargetLanguages: ['id', 'en'],
    };
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    if (!this.compatible && !this.apiKey)
      throw new ProviderAuthError('Configure your OpenAI API key in Provider Settings.', this.id);
    const model = request.options?.modelName || this.modelName;
    if (!this.compatible && /^(?:o1-mini|o1-preview|o3-mini)(?:-|$)/.test(model)) {
      throw new ProviderError(
        'Select a vision-capable model. This model does not accept manga images.',
        'KOMA_UNSUPPORTED_CAPABILITY_ERROR',
        this.id
      );
    }
    const effort = resolveReasoningEffort(model, this.reasoningEffort, this.compatible);
    const timeoutMs = request.options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    try {
      const image = await loadImageData(request.image, this.id, this.fetch, controller.signal);
      const imageUrl = `data:${image.mimeType};base64,${image.base64Data}`;
      const instructions =
        buildTranslationPrompt(request.targetLanguage, request.context) +
        (request.options?.customPrompt
          ? `\n\nTranslation preferences:\n${request.options.customPrompt}`
          : '');
      const schemaFormat = {
        type: 'json_schema',
        name: 'manga_translation',
        strict: true,
        schema: getTranslationResponseSchema(),
      };
      const payload: JsonObject = { model, stream: true };
      if (this.apiFormat === 'responses') {
        Object.assign(payload, {
          store: false,
          instructions,
          max_output_tokens: this.maxOutputTokens,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Translate the current manga image. Return the translation JSON.',
                },
                { type: 'input_image', image_url: imageUrl, detail: 'high' },
              ],
            },
          ],
        });
        if (effort) payload.reasoning = { effort };
        if (this.responseFormat !== 'prompt')
          payload.text = {
            format: this.responseFormat === 'json-schema' ? schemaFormat : { type: 'json_object' },
          };
      } else {
        Object.assign(payload, {
          messages: [
            { role: 'system', content: instructions },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Translate the current manga image. Return the translation JSON.',
                },
                { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              ],
            },
          ],
        });
        // Compatible servers differ on token-limit fields; keep their configured default.
        if (!this.compatible) payload.max_completion_tokens = this.maxOutputTokens;
        if (effort) payload.reasoning_effort = effort;
        if (this.responseFormat !== 'prompt')
          payload.response_format =
            this.responseFormat === 'json-schema'
              ? {
                  type: 'json_schema',
                  json_schema: {
                    name: schemaFormat.name,
                    strict: true,
                    schema: schemaFormat.schema,
                  },
                }
              : { type: 'json_object' };
      }
      if (
        !effort &&
        !this.compatible &&
        /^gpt-4(?:\.|o|-)/.test(model) &&
        request.options?.temperature !== undefined
      ) {
        payload.temperature = request.options.temperature;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      const response = await this.fetch(
        `${this.baseUrl}/${this.apiFormat === 'responses' ? 'responses' : 'chat/completions'}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: 'error',
        }
      );
      if (!response.ok) this.httpError(response);
      let rawText: string;
      try {
        rawText = response.headers.get('content-type')?.includes('text/event-stream')
          ? await this.readStream(response)
          : this.finalText(await response.json());
      } catch (error) {
        if (controller.signal.aborted || error instanceof ProviderError) throw error;
        throw new InvalidProviderResponseError(
          'The endpoint returned invalid or interrupted output.',
          this.id
        );
      }
      const normalizationStart = performance.now();
      try {
        return normalizeTranslationOutput({
          rawText,
          imageId: request.image.id,
          pageId: `page_${request.image.pageIndex}`,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          durationMs: performance.now() - start,
          providerId: this.id,
          modelId: model,
        });
      } finally {
        logPipeline('normalization', 'duration', performance.now() - normalizationStart);
      }
    } catch (error) {
      if (controller.signal.aborted)
        throw new ProviderTimeoutError(
          'Translation timed out. Try a lower reasoning effort or retry.',
          this.id,
          timeoutMs
        );
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'Could not reach the API endpoint. Check its URL and availability.',
        'KOMA_NETWORK_ERROR',
        this.id
      );
    } finally {
      clearTimeout(timeout);
      logPipeline('provider', 'request', performance.now() - start);
    }
  }

  private httpError(response: Response): never {
    if ([401, 403].includes(response.status))
      throw new ProviderAuthError(
        'API authentication failed. Check your key and model access.',
        this.id
      );
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = retry ? Number(retry) : NaN;
      const retryAfter = Number.isFinite(seconds)
        ? Math.max(0, seconds)
        : retry
          ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
          : undefined;
      throw new ProviderRateLimitError(
        'API rate limit exceeded. Wait before retrying.',
        this.id,
        Number.isFinite(retryAfter) ? retryAfter : undefined
      );
    }
    const message =
      response.status === 400
        ? 'API request rejected. Check the model, vision support, response format, and reasoning effort.'
        : response.status === 404
          ? 'API endpoint or model not found. Check the base URL, API format, and model ID.'
          : `API service error (HTTP ${response.status}). Try again later.`;
    throw new ProviderError(
      message,
      response.status < 500 ? 'KOMA_INVALID_REQUEST_ERROR' : 'KOMA_PROVIDER_SERVICE_ERROR',
      this.id,
      { status: response.status }
    );
  }

  private finalText(value: unknown): string {
    const body = asObject(value);
    if (this.apiFormat === 'responses') {
      if (body.status !== 'completed') {
        throw new InvalidProviderResponseError(
          'Translation did not complete. The model may have reached its output token limit.',
          this.id,
          undefined,
          undefined,
          'incomplete'
        );
      }
      let text = '';
      for (const entry of asArray(body.output)) {
        const item = asObject(entry);
        if (item.type !== 'message' || (item.phase && item.phase !== 'final_answer')) continue;
        for (const content of asArray(item.content)) {
          const part = asObject(content);
          if (part.type === 'refusal')
            throw new InvalidProviderResponseError(
              'The model declined to translate this image.',
              this.id,
              undefined,
              undefined,
              'refusal'
            );
          if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
        }
      }
      if (!text.trim())
        throw new InvalidProviderResponseError('The model returned no final translation.', this.id);
      return text;
    }
    const choice = asObject(asArray(body.choices)[0]);
    this.checkFinishReason(choice.finish_reason);
    const message = asObject(choice.message);
    if (message.refusal)
      throw new InvalidProviderResponseError(
        'The model declined to translate this image.',
        this.id,
        undefined,
        undefined,
        'refusal'
      );
    const content =
      typeof message.content === 'string'
        ? message.content
        : asArray(message.content)
            .map((part) => asObject(part))
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('');
    if (!content.trim())
      throw new InvalidProviderResponseError('The model returned no final translation.', this.id);
    return content;
  }

  private checkFinishReason(reason: unknown): void {
    if (reason === 'length')
      throw new InvalidProviderResponseError(
        'The model reached its output token limit before completing the translation.',
        this.id,
        undefined,
        undefined,
        'incomplete'
      );
    if (reason && reason !== 'stop')
      throw new InvalidProviderResponseError(
        'The model did not finish the translation normally.',
        this.id,
        undefined,
        undefined,
        'incomplete'
      );
  }

  private async readStream(response: Response): Promise<string> {
    let content = '';
    let finished = false;
    for await (const value of streamEvents(response)) {
      if (value === '[DONE]') {
        if (this.apiFormat === 'chat-completions' && finished && content.trim()) return content;
        break;
      }
      const event = asObject(value);
      if (
        event.error ||
        event.type === 'error' ||
        event.type === 'response.failed' ||
        event.type === 'response.incomplete'
      ) {
        throw new InvalidProviderResponseError(
          'The endpoint stopped before completing the translation. Check the output token limit.',
          this.id,
          undefined,
          undefined,
          'incomplete'
        );
      }
      if (this.apiFormat === 'responses') {
        if (event.type === 'response.completed') return this.finalText(event.response);
      } else {
        const choice = asObject(asArray(event.choices)[0]);
        const delta = asObject(choice.delta);
        if (delta.refusal)
          throw new InvalidProviderResponseError(
            'The model declined to translate this image.',
            this.id,
            undefined,
            undefined,
            'refusal'
          );
        if (typeof delta.content === 'string') content += delta.content;
        this.checkFinishReason(choice.finish_reason);
        finished ||= choice.finish_reason === 'stop';
      }
    }
    if (this.apiFormat === 'chat-completions' && finished && content.trim()) return content;
    throw new InvalidProviderResponseError(
      'The translation stream ended before a final answer was completed.',
      this.id,
      undefined,
      undefined,
      'incomplete'
    );
  }
}
