import {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  ProviderCapabilities,
} from '@core/contracts';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderError,
  InvalidProviderResponseError,
} from '@core/errors';
import { GeminiRequestPayload, GeminiResponsePayload, DEFAULT_GEMINI_MODEL } from './types';
import { buildGeminiSystemPrompt, getGeminiResponseSchema } from './prompt';
import { normalizeGeminiResponse } from './normalizer';

export interface GeminiProviderOptions {
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  defaultTimeoutMs?: number;
  fetchFn?: typeof fetch; // Injectable fetch for unit testing
}

export class GeminiTranslationProvider implements TranslationProvider {
  public readonly id = 'gemini-multimodal';
  public readonly name = 'Google Gemini Multimodal';
  public readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey?.trim();
    this.modelName = options.modelName || DEFAULT_GEMINI_MODEL;
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  capabilities(): ProviderCapabilities {
    return {
      vision: true,
      ocr: true,
      translation: true,
      boundingBoxes: true,
      local: false,
      supportedSourceLanguages: ['ja', 'ko', 'zh'],
      supportedTargetLanguages: ['id', 'en'],
    };
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    if (!this.apiKey) {
      throw new ProviderAuthError(
        'Gemini API key is missing. Please configure your API key in Koma settings.',
        this.id
      );
    }

    const { base64Data, mimeType } = await this.extractImageData(request);
    const startTime = Date.now();

    const systemPrompt = buildGeminiSystemPrompt(request.targetLanguage, request.context);

    const payload: GeminiRequestPayload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `Detect all speech/narration bubbles, perform OCR, and translate to ${request.targetLanguage}. Return valid JSON.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: request.options?.temperature ?? 0.2,
        responseMimeType: 'application/json',
        responseSchema: getGeminiResponseSchema(),
      },
    };

    const timeoutMs = request.options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const endpoint = `${this.baseUrl}/models/${encodeURIComponent(this.modelName)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await this.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderTimeoutError(
          `Gemini request timed out after ${timeoutMs}ms`,
          this.id,
          timeoutMs
        );
      }

      throw new ProviderError(
        `Network error during Gemini request: ${err instanceof Error ? err.message : String(err)}`,
        'KOMA_NETWORK_ERROR',
        this.id
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    let data: GeminiResponsePayload;
    try {
      data = (await response.json()) as GeminiResponsePayload;
    } catch (err) {
      throw new InvalidProviderResponseError(
        `Failed to parse Gemini response body as JSON: ${err instanceof Error ? err.message : String(err)}`,
        this.id
      );
    }

    const candidate = data.candidates?.[0];
    const candidateText = candidate?.content?.parts?.[0]?.text;

    if (!candidateText) {
      const finishReason = candidate?.finishReason || 'UNKNOWN';
      throw new InvalidProviderResponseError(
        `Gemini returned empty text candidate (finishReason: ${finishReason})`,
        this.id,
        data
      );
    }

    const durationMs = Date.now() - startTime;

    return normalizeGeminiResponse({
      rawText: candidateText,
      imageId: request.image.id,
      pageId: `page_${request.image.pageIndex}`,
      sourceLanguage: request.sourceLanguage || 'ja',
      targetLanguage: request.targetLanguage,
      durationMs,
      modelId: this.modelName,
      providerId: this.id,
    });
  }

  private async extractImageData(
    request: TranslationRequest
  ): Promise<{ base64Data: string; mimeType: string }> {
    const img = request.image;

    if (img.base64Data) {
      const parts = img.base64Data.split(',');
      const data = parts.length > 1 ? parts[1] : parts[0];
      const mime =
        img.mimeType || (img.base64Data.match(/^data:(image\/[a-zA-Z+]+);/)?.[1] ?? 'image/jpeg');
      return { base64Data: data, mimeType: mime };
    }

    if (img.url && !img.url.startsWith('blob:')) {
      try {
        const res = await this.fetch(img.url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching image URL`);
        }
        const buffer = await res.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        const mimeType = img.mimeType || res.headers.get('content-type') || 'image/jpeg';
        return { base64Data, mimeType };
      } catch (err) {
        throw new ProviderError(
          `Failed to load image from URL: ${err instanceof Error ? err.message : String(err)}`,
          'KOMA_IMAGE_LOAD_ERROR',
          this.id
        );
      }
    }

    throw new ProviderError(
      'MangaImage contains neither base64Data nor a reachable URL',
      'KOMA_INVALID_IMAGE_ERROR',
      this.id
    );
  }

  private async handleHttpError(response: Response): Promise<never> {
    let errorJson: GeminiResponsePayload | undefined;
    try {
      errorJson = (await response.json()) as GeminiResponsePayload;
    } catch {
      // Body not JSON
    }

    const status = response.status;
    const errorObj = errorJson?.error;
    const msg = errorObj?.message || response.statusText || `HTTP ${status}`;

    if (status === 400 || status === 401 || status === 403) {
      if (
        /API key not valid|key expired|unauthorized/i.test(msg) ||
        status === 401 ||
        status === 403
      ) {
        throw new ProviderAuthError(
          'Gemini API authentication failed. Please check your API key.',
          this.id
        );
      }
      throw new ProviderError(
        `Gemini API request rejected: ${msg}`,
        'KOMA_INVALID_REQUEST_ERROR',
        this.id,
        { status, message: msg }
      );
    }

    if (status === 429) {
      const retryHeader = response.headers.get('retry-after');
      const retrySec = retryHeader ? parseInt(retryHeader, 10) : 15;
      throw new ProviderRateLimitError(
        'Gemini API rate limit exceeded (15 RPM on Free Tier). Please wait before trying again.',
        this.id,
        retrySec
      );
    }

    throw new ProviderError(
      `Gemini service error: ${msg} (HTTP ${status})`,
      'KOMA_PROVIDER_SERVICE_ERROR',
      this.id,
      { status }
    );
  }
}
