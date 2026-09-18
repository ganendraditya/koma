import { describe, it, expect, vi } from 'vitest';
import {
  GeminiTranslationProvider,
  buildGeminiSystemPrompt,
  getGeminiResponseSchema,
  normalizeGeminiResponse,
  getStoredGeminiConfig,
  saveStoredGeminiConfig,
  clearStoredGeminiConfig,
  DEFAULT_GEMINI_MODEL,
  SUPPORTED_GEMINI_MODELS,
} from '../providers/gemini';
import { TranslationRequest, ContextPacket, validateTranslationResult } from '../core/contracts';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  InvalidProviderResponseError,
} from '../core/errors';

describe('KOMA-005: Gemini Multimodal Translation Provider', () => {
  describe('Provider Capabilities', () => {
    it('declares correct multimodal vision, OCR, translation, and bounding box capabilities', () => {
      const provider = new GeminiTranslationProvider({ apiKey: 'test-key' });
      const caps = provider.capabilities();

      expect(caps.vision).toBe(true);
      expect(caps.ocr).toBe(true);
      expect(caps.translation).toBe(true);
      expect(caps.boundingBoxes).toBe(true);
      expect(caps.local).toBe(false);
      expect(caps.supportedSourceLanguages).toContain('ja');
      expect(caps.supportedTargetLanguages).toContain('id');
      expect(caps.supportedTargetLanguages).toContain('en');
    });
  });

  describe('Prompt & Schema Generation', () => {
    it('generates prompt for Indonesian target language with context packet', () => {
      const context: ContextPacket = {
        seriesTitle: 'Jujutsu Kaisen',
        preserveHonorifics: true,
        translationStyle: 'natural',
        characters: [{ name: 'Gojo', description: 'Strongest sorcerer' }],
        glossary: [{ original: '領域展開', translation: 'Domain Expansion', isHard: true }],
        recentDialogue: [{ speaker: 'Gojo', translatedText: 'Tidak apa-apa, aku terkuat.' }],
        chapterSummary: 'Pertarungan di Shibuya.',
      };

      const prompt = buildGeminiSystemPrompt('id', context);

      expect(prompt).toContain('Indonesian');
      expect(prompt).toContain('Jujutsu Kaisen');
      expect(prompt).toContain('Gojo');
      expect(prompt).toContain('Domain Expansion');
      expect(prompt).toContain('[MANDATORY]');
      expect(prompt).toContain('Tidak apa-apa, aku terkuat.');
      expect(prompt).toContain('Shibuya');
    });

    it('generates prompt for English target language without context', () => {
      const prompt = buildGeminiSystemPrompt('en');
      expect(prompt).toContain('English');
      expect(prompt).toContain('ymin, xmin, ymax, xmax');
      expect(prompt).not.toContain('CONTEXT & CONTINUITY');
    });

    it('returns a valid JSON schema constraint for Gemini API', () => {
      const schema = getGeminiResponseSchema();
      expect(schema.type).toBe('OBJECT');
      expect(schema.required).toContain('bubbles');
    });
  });

  describe('Response Normalization', () => {
    const rawJson = JSON.stringify({
      bubbles: [
        {
          box_2d: [120, 600, 240, 850],
          source_text: '待て！',
          translated_text: 'Tunggu!',
          bubble_type: 'speech',
          speaker: 'Aki',
          reading_order: 1,
        },
        {
          box_2d: [450, 150, 600, 400],
          source_text: '逃げろ！',
          translated_text: 'Lari!',
          bubble_type: 'speech',
          reading_order: 2,
        },
      ],
      context_delta: {
        characters_discovered: [{ name: 'Aki' }],
        glossary_updates: [],
        scene_summary: 'Karakter saling memperingatkan untuk lari.',
      },
    });

    it('normalizes valid raw JSON into standardized TranslationResult', () => {
      const result = normalizeGeminiResponse({
        rawText: rawJson,
        imageId: 'img_test_01',
        pageId: 'page_01',
        sourceLanguage: 'ja',
        targetLanguage: 'id',
      });

      expect(result.imageId).toBe('img_test_01');
      expect(result.pageId).toBe('page_01');
      expect(result.bubbles).toHaveLength(2);

      const first = result.bubbles[0];
      expect(first.id).toBe('bubble_001');
      expect(first.sourceText).toBe('待て！');
      expect(first.translatedText).toBe('Tunggu!');
      expect(first.box).toEqual({
        ymin: 120,
        xmin: 600,
        ymax: 240,
        xmax: 850,
      });

      expect(result.contextDelta?.charactersDiscovered).toHaveLength(1);
      expect(validateTranslationResult(result).valid).toBe(true);
    });

    it('handles markdown-wrapped JSON code fences', () => {
      const wrapped = `\`\`\`json\n${rawJson}\n\`\`\``;
      const result = normalizeGeminiResponse({
        rawText: wrapped,
        imageId: 'img_wrapped',
        targetLanguage: 'id',
      });

      expect(result.bubbles).toHaveLength(2);
      expect(result.bubbles[0].translatedText).toBe('Tunggu!');
    });

    it('throws InvalidProviderResponseError when JSON is malformed', () => {
      expect(() =>
        normalizeGeminiResponse({
          rawText: '{ invalid json structure ...',
          imageId: 'img_fail',
          targetLanguage: 'id',
        })
      ).toThrow(InvalidProviderResponseError);
    });

    it('throws InvalidProviderResponseError when root bubbles array is missing', () => {
      expect(() =>
        normalizeGeminiResponse({
          rawText: JSON.stringify({ wrongField: [] }),
          imageId: 'img_fail',
          targetLanguage: 'id',
        })
      ).toThrow(InvalidProviderResponseError);
    });
  });

  describe('End-to-End Mock Invocations & Representative Fixtures', () => {
    it('throws ProviderAuthError if API key is not configured', async () => {
      const provider = new GeminiTranslationProvider({ apiKey: '' });
      const request: TranslationRequest = {
        image: { id: 'img_1', url: 'https://example.com/1.jpg', pageIndex: 0 },
        targetLanguage: 'id',
      };

      await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('translates successfully with mock Gemini API response', async () => {
      const mockResponseBody = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    bubbles: [
                      {
                        box_2d: [150, 700, 280, 920],
                        source_text: '何だこれは？！',
                        translated_text: 'Apa-apaan ini?!',
                        bubble_type: 'speech',
                        reading_order: 1,
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponseBody,
      });

      const provider = new GeminiTranslationProvider({
        apiKey: 'valid-api-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const request: TranslationRequest = {
        image: {
          id: 'test_page_1',
          pageIndex: 1,
          base64Data:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          mimeType: 'image/png',
        },
        targetLanguage: 'id',
        sourceLanguage: 'ja',
      };

      const result = await provider.translatePage(request);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.imageId).toBe('test_page_1');
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0].translatedText).toBe('Apa-apaan ini?!');
      expect(result.bubbles[0].sourceText).toBe('何だこれは？！');
      expect(validateTranslationResult(result).valid).toBe(true);
    });

    it('handles HTTP 429 rate limits and throws ProviderRateLimitError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '20' }),
        json: async () => ({
          error: {
            code: 429,
            message: 'Resource has been exhausted',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      });

      const provider = new GeminiTranslationProvider({
        apiKey: 'rate-limited-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const request: TranslationRequest = {
        image: { id: 'img_rl', pageIndex: 0, base64Data: 'dummy' },
        targetLanguage: 'id',
      };

      await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderRateLimitError);
    });

    it('handles HTTP 403 authorization failures with ProviderAuthError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: { code: 403, message: 'API key not valid', status: 'PERMISSION_DENIED' },
        }),
      });

      const provider = new GeminiTranslationProvider({
        apiKey: 'bad-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const request: TranslationRequest = {
        image: { id: 'img_auth', pageIndex: 0, base64Data: 'dummy' },
        targetLanguage: 'id',
      };

      await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('handles request timeout and throws ProviderTimeoutError', async () => {
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const provider = new GeminiTranslationProvider({
        apiKey: 'key',
        defaultTimeoutMs: 50,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const request: TranslationRequest = {
        image: { id: 'img_timeout', pageIndex: 0, base64Data: 'dummy' },
        targetLanguage: 'id',
        options: { timeoutMs: 50 },
      };

      await expect(provider.translatePage(request)).rejects.toBeInstanceOf(ProviderTimeoutError);
    });

    it('verifies 3 representative test fixtures (action panel, dialogue confrontation, long narration)', () => {
      // Fixture 1: Action Panel (sound effect + quick shout)
      const fixture1 = JSON.stringify({
        bubbles: [
          {
            box_2d: [50, 800, 180, 950],
            source_text: '危ない！',
            translated_text: 'Awas!',
            bubble_type: 'speech',
            reading_order: 1,
          },
        ],
      });
      const res1 = normalizeGeminiResponse({
        rawText: fixture1,
        imageId: 'fixture_action',
        targetLanguage: 'id',
      });
      expect(res1.bubbles[0].translatedText).toBe('Awas!');
      expect(validateTranslationResult(res1).valid).toBe(true);

      // Fixture 2: Dialogue Confrontation (multiple speech bubbles with speakers)
      const fixture2 = JSON.stringify({
        bubbles: [
          {
            box_2d: [100, 500, 300, 800],
            source_text: 'お前、何者だ？',
            translated_text: 'Siapa sebenarnya kamu?',
            speaker: 'Protagonist',
            bubble_type: 'speech',
            reading_order: 1,
          },
          {
            box_2d: [400, 200, 600, 450],
            source_text: '教える義理はないな。',
            translated_text: 'Aku tidak punya kewajiban memberitahumu.',
            speaker: 'Antagonist',
            bubble_type: 'speech',
            reading_order: 2,
          },
        ],
      });
      const res2 = normalizeGeminiResponse({
        rawText: fixture2,
        imageId: 'fixture_dialogue',
        targetLanguage: 'id',
      });
      expect(res2.bubbles).toHaveLength(2);
      expect(res2.bubbles[0].speaker).toBe('Protagonist');
      expect(res2.bubbles[1].speaker).toBe('Antagonist');
      expect(validateTranslationResult(res2).valid).toBe(true);

      // Fixture 3: World Building Narration Box
      const fixture3 = JSON.stringify({
        bubbles: [
          {
            box_2d: [20, 20, 250, 400],
            source_text: 'それは、遥か昔の出来事であった。',
            translated_text: 'Itu adalah peristiwa yang terjadi di masa yang sangat lampau.',
            bubble_type: 'narration',
            reading_order: 1,
          },
        ],
      });
      const res3 = normalizeGeminiResponse({
        rawText: fixture3,
        imageId: 'fixture_narration',
        targetLanguage: 'id',
      });
      expect(res3.bubbles[0].bubbleType).toBe('narration');
      expect(validateTranslationResult(res3).valid).toBe(true);
    });
  });

  describe('Model Configuration & Defaults', () => {
    it('sets default model to gemini-3.5-flash-lite and exports supported models', () => {
      expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
      expect(SUPPORTED_GEMINI_MODELS).toContain('gemini-3.5-flash-lite');
      expect(SUPPORTED_GEMINI_MODELS).toContain('gemini-3.5-flash');
      expect(SUPPORTED_GEMINI_MODELS).toContain('gemini-3.8-flash');
    });

    it('does not hardcode modelId in normalizeGeminiResponse when not provided', () => {
      const res = normalizeGeminiResponse({
        rawText: JSON.stringify({ bubbles: [] }),
        imageId: 'img_default',
        targetLanguage: 'id',
      });
      expect(res.modelId).toBeUndefined();
    });

    it('preserves caller-supplied modelId in normalizeGeminiResponse', () => {
      const res = normalizeGeminiResponse({
        rawText: JSON.stringify({ bubbles: [] }),
        imageId: 'img_custom',
        targetLanguage: 'id',
        modelId: 'my-fine-tuned-model',
      });
      expect(res.modelId).toBe('my-fine-tuned-model');
    });

    it('allows dynamic model override when instantiating provider', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ bubbles: [] }) }],
              },
            },
          ],
        }),
      });

      const customProvider = new GeminiTranslationProvider({
        apiKey: 'test-key',
        modelName: 'gemini-3.7-flash',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const res = await customProvider.translatePage({
        image: { id: 'img_dynamic', pageIndex: 0, base64Data: 'dummy' },
        targetLanguage: 'id',
      });

      expect(res.modelId).toBe('gemini-3.7-flash');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/models/gemini-3.7-flash:generateContent'),
        expect.anything()
      );
    });

    it('honors per-request modelName override in TranslationOptions', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ bubbles: [] }) }],
              },
            },
          ],
        }),
      });

      const provider = new GeminiTranslationProvider({
        apiKey: 'test-key',
        modelName: 'gemini-3.5-flash-lite',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const res = await provider.translatePage({
        image: { id: 'img_override', pageIndex: 0, base64Data: 'dummy' },
        targetLanguage: 'id',
        options: {
          modelName: 'gemini-3.8-pro',
        },
      });

      expect(res.modelId).toBe('gemini-3.8-pro');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/models/gemini-3.8-pro:generateContent'),
        expect.anything()
      );
    });
  });

  describe('BYOK Credential Storage', () => {
    it('returns default config with gemini-3.5-flash-lite when store is empty', async () => {
      await clearStoredGeminiConfig();
      const config = await getStoredGeminiConfig();
      expect(config.modelName).toBe('gemini-3.5-flash-lite');
      expect(config.targetLanguage).toBe('id');
    });

    it('saves, retrieves, and clears Gemini configuration locally', async () => {
      await saveStoredGeminiConfig({
        apiKey: 'AIzaSyFakeKeyForTesting12345',
        modelName: 'custom-user-model-v1',
        targetLanguage: 'id',
      });

      const config = await getStoredGeminiConfig();
      expect(config.apiKey).toBe('AIzaSyFakeKeyForTesting12345');
      expect(config.modelName).toBe('custom-user-model-v1');
      expect(config.targetLanguage).toBe('id');

      await clearStoredGeminiConfig();
      const cleared = await getStoredGeminiConfig();
      expect(cleared.apiKey).toBe('');
      expect(cleared.modelName).toBe('gemini-3.5-flash-lite');
    });
  });
});
