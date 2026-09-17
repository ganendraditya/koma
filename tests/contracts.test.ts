import { describe, it, expect } from 'vitest';
import {
  BoundingBox,
  Bubble,
  TranslationResult,
  TranslationRequest,
  TranslationProvider,
  ProviderCapabilities,
  createBoundingBox,
  isValidBoundingBox,
  boxToPixels,
  boxToPercentages,
  validateTranslationResult,
  KomaError,
  ProviderError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  InvalidProviderResponseError,
  UnsupportedCapabilityError,
} from '../core';

describe('KOMA-003: Core Translation Contracts', () => {
  describe('BoundingBox Geometry & Coordinates', () => {
    it('creates and clamps coordinates within normalized [0, 1000] bounds', () => {
      const box = createBoundingBox(-50, 100, 1200, 800);
      expect(box).toEqual({
        ymin: 0,
        xmin: 100,
        ymax: 1000,
        xmax: 800,
      });
      expect(isValidBoundingBox(box)).toBe(true);
    });

    it('ensures min is not greater than max', () => {
      const inverted = createBoundingBox(500, 800, 200, 300);
      expect(inverted.ymin).toBe(200);
      expect(inverted.ymax).toBe(500);
      expect(inverted.xmin).toBe(300);
      expect(inverted.xmax).toBe(800);
    });

    it('detects invalid bounding box objects', () => {
      expect(isValidBoundingBox(null)).toBe(false);
      expect(isValidBoundingBox({})).toBe(false);
      expect(isValidBoundingBox({ ymin: -1, xmin: 0, ymax: 100, xmax: 100 })).toBe(false);
      expect(isValidBoundingBox({ ymin: 0, xmin: 0, ymax: 1001, xmax: 100 })).toBe(false);
      expect(isValidBoundingBox({ ymin: 500, xmin: 0, ymax: 200, xmax: 100 })).toBe(false);
    });

    it('converts normalized coordinates to absolute pixels correctly', () => {
      const box: BoundingBox = { ymin: 100, xmin: 200, ymax: 300, xmax: 600 };
      const pixels = boxToPixels(box, 1000, 2000);

      expect(pixels).toEqual({
        top: 200,
        left: 200,
        width: 400,
        height: 400,
      });
    });

    it('converts normalized coordinates to CSS percentage strings', () => {
      const box: BoundingBox = { ymin: 150, xmin: 250, ymax: 450, xmax: 750 };
      const percentages = boxToPercentages(box);

      expect(percentages).toEqual({
        top: '15.00%',
        left: '25.00%',
        width: '50.00%',
        height: '30.00%',
      });
    });
  });

  describe('TranslationResult Schema Validation', () => {
    const validResult: TranslationResult = {
      pageId: 'page_001',
      imageId: 'img_test_123',
      sourceLanguage: 'ja',
      targetLanguage: 'id',
      durationMs: 420,
      bubbles: [
        {
          id: 'bubble_001',
          box: { ymin: 120, xmin: 550, ymax: 320, xmax: 750 },
          sourceText: '何をしているんだ？',
          translatedText: 'Apa yang sedang kamu lakukan?',
          bubbleType: 'speech',
          speaker: 'Takahashi',
          readingOrder: 1,
          confidence: { ocr: 0.98, translation: 0.95, overall: 0.96 },
          textAlignment: 'center',
        },
        {
          id: 'bubble_002',
          box: { ymin: 400, xmin: 200, ymax: 550, xmax: 400 },
          sourceText: '別に…',
          translatedText: 'Bukan apa-apa...',
          bubbleType: 'speech',
          readingOrder: 2,
        },
      ],
      contextDelta: {
        charactersDiscovered: [{ name: 'Takahashi' }],
        glossaryUpdates: [{ original: '先輩', translation: 'Senpai' }],
        sceneSummary: 'Karakter bertemu di lorong sekolah.',
      },
    };

    it('validates a complete, compliant TranslationResult', () => {
      const outcome = validateTranslationResult(validResult);
      expect(outcome.valid).toBe(true);
      expect(outcome.errors).toHaveLength(0);
    });

    it('flags missing root fields', () => {
      const outcome = validateTranslationResult({ pageId: 'page_001' });
      expect(outcome.valid).toBe(false);
      expect(outcome.errors).toContain('Missing or invalid imageId');
      expect(outcome.errors).toContain('Missing or invalid sourceLanguage');
      expect(outcome.errors).toContain('Missing or invalid targetLanguage');
      expect(outcome.errors).toContain('bubbles must be an array');
    });

    it('flags duplicate bubble IDs within an image', () => {
      const duplicateBubbleResult: TranslationResult = {
        ...validResult,
        bubbles: [
          {
            id: 'bubble_duplicate',
            box: { ymin: 0, xmin: 0, ymax: 100, xmax: 100 },
            translatedText: 'Teks 1',
          },
          {
            id: 'bubble_duplicate',
            box: { ymin: 200, xmin: 200, ymax: 300, xmax: 300 },
            translatedText: 'Teks 2',
          },
        ],
      };

      const outcome = validateTranslationResult(duplicateBubbleResult);
      expect(outcome.valid).toBe(false);
      expect(
        outcome.errors.some((err) => err.includes("Duplicate bubble ID 'bubble_duplicate'"))
      ).toBe(true);
    });

    it('flags bubbles with invalid bounding boxes', () => {
      const invalidBoxResult: TranslationResult = {
        ...validResult,
        bubbles: [
          {
            id: 'bubble_bad_box',
            box: { ymin: -50, xmin: 0, ymax: 1500, xmax: 100 },
            translatedText: 'Teks dengan box rusak',
          },
        ],
      };

      const outcome = validateTranslationResult(invalidBoxResult);
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.some((err) => err.includes('invalid bounding box'))).toBe(true);
    });
  });

  describe('TranslationProvider Interface Conformance', () => {
    it('allows implementing a mock provider adhering to TranslationProvider contract', async () => {
      class MockMultimodalProvider implements TranslationProvider {
        public readonly id = 'mock-multimodal';
        public readonly name = 'Mock Multimodal Provider';

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
          const bubble: Bubble = {
            id: 'bubble_mock_1',
            box: { ymin: 100, xmin: 100, ymax: 200, xmax: 200 },
            sourceText: 'こんにちは',
            translatedText: 'Halo',
            bubbleType: 'speech',
          };

          return {
            pageId: 'page_mock',
            imageId: request.image.id,
            sourceLanguage: request.sourceLanguage ?? 'ja',
            targetLanguage: request.targetLanguage,
            bubbles: [bubble],
            durationMs: 150,
            providerId: this.id,
          };
        }
      }

      const provider = new MockMultimodalProvider();
      expect(provider.id).toBe('mock-multimodal');
      expect(provider.capabilities().vision).toBe(true);
      expect(provider.capabilities().boundingBoxes).toBe(true);

      const request: TranslationRequest = {
        image: {
          id: 'test_img_1',
          url: 'https://example.com/manga/page1.jpg',
          pageIndex: 0,
        },
        targetLanguage: 'id',
        sourceLanguage: 'ja',
        context: {
          recentDialogue: [
            {
              speaker: 'Aki',
              sourceText: 'やあ',
              translatedText: 'Hai',
            },
          ],
        },
      };

      const result = await provider.translatePage(request);
      expect(result.imageId).toBe('test_img_1');
      expect(result.targetLanguage).toBe('id');
      expect(result.bubbles).toHaveLength(1);
      expect(validateTranslationResult(result).valid).toBe(true);
    });
  });

  describe('Standardized Error Hierarchy', () => {
    it('correctly maintains error inheritance and codes', () => {
      const authErr = new ProviderAuthError('Missing API Key', 'gemini');
      expect(authErr).toBeInstanceOf(Error);
      expect(authErr).toBeInstanceOf(KomaError);
      expect(authErr).toBeInstanceOf(ProviderError);
      expect(authErr).toBeInstanceOf(ProviderAuthError);
      expect(authErr.code).toBe('KOMA_AUTH_ERROR');
      expect(authErr.providerId).toBe('gemini');

      const rateLimitErr = new ProviderRateLimitError('Too many requests', 'gemini', 30);
      expect(rateLimitErr.code).toBe('KOMA_RATE_LIMIT_ERROR');
      expect(rateLimitErr.retryAfterSeconds).toBe(30);

      const timeoutErr = new ProviderTimeoutError('Request took too long', 'gemini', 15000);
      expect(timeoutErr.code).toBe('KOMA_TIMEOUT_ERROR');
      expect(timeoutErr.timeoutMs).toBe(15000);

      const invalidRespErr = new InvalidProviderResponseError(
        'JSON parse failed',
        'gemini',
        '{ invalid }',
        ['Syntax error at line 1']
      );
      expect(invalidRespErr.code).toBe('KOMA_INVALID_RESPONSE_ERROR');
      expect(invalidRespErr.validationErrors).toEqual(['Syntax error at line 1']);

      const capErr = new UnsupportedCapabilityError('boundingBoxes', 'deepl');
      expect(capErr.code).toBe('KOMA_UNSUPPORTED_CAPABILITY_ERROR');
      expect(capErr.requiredCapability).toBe('boundingBoxes');
    });
  });
});
