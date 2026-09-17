import {
  TranslationResult,
  Bubble,
  BubbleType,
  ContextDelta,
  createBoundingBox,
  validateTranslationResult,
} from '@core/contracts';
import { InvalidProviderResponseError } from '@core/errors';
import { GeminiStructuredOutput, GeminiRawBubble } from './types';

interface NormalizeParams {
  rawText: string;
  imageId: string;
  pageId?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  durationMs?: number;
  modelId?: string;
  providerId?: string;
}

const ALLOWED_BUBBLE_TYPES: Set<BubbleType> = new Set([
  'speech',
  'narration',
  'thought',
  'sfx',
  'other',
]);

/**
 * Normalizes raw Gemini JSON output into Koma's standardized TranslationResult.
 * Ensures coordinate clamping, unique bubble IDs, and schema validation.
 */
export function normalizeGeminiResponse(params: NormalizeParams): TranslationResult {
  const {
    rawText,
    imageId,
    pageId = `page_${imageId}`,
    sourceLanguage = 'ja',
    targetLanguage,
    durationMs,
    modelId,
    providerId = 'gemini-multimodal',
  } = params;

  let parsed: GeminiStructuredOutput;
  try {
    // Strip potential markdown code block wrappers (e.g. ```json ... ```)
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    parsed = JSON.parse(cleaned) as GeminiStructuredOutput;
  } catch (err) {
    throw new InvalidProviderResponseError(
      `Failed to parse Gemini output as JSON: ${err instanceof Error ? err.message : String(err)}`,
      providerId,
      rawText
    );
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.bubbles)) {
    throw new InvalidProviderResponseError(
      "Gemini response missing root 'bubbles' array",
      providerId,
      parsed
    );
  }

  const normalizedBubbles: Bubble[] = parsed.bubbles.map(
    (rawBubble: GeminiRawBubble, idx: number): Bubble => {
      const boxArray = Array.isArray(rawBubble.box_2d) ? rawBubble.box_2d : [0, 0, 100, 100];
      const ymin = Number(boxArray[0]) || 0;
      const xmin = Number(boxArray[1]) || 0;
      const ymax = Number(boxArray[2]) || ymin + 50;
      const xmax = Number(boxArray[3]) || xmin + 50;

      const box = createBoundingBox(ymin, xmin, ymax, xmax);

      let bubbleType: BubbleType = 'speech';
      if (rawBubble.bubble_type && ALLOWED_BUBBLE_TYPES.has(rawBubble.bubble_type)) {
        bubbleType = rawBubble.bubble_type;
      }

      return {
        id: `bubble_${String(idx + 1).padStart(3, '0')}`,
        box,
        sourceText: rawBubble.source_text?.trim(),
        translatedText: rawBubble.translated_text?.trim() || '',
        bubbleType,
        speaker: rawBubble.speaker?.trim() || null,
        readingOrder: rawBubble.reading_order ?? idx + 1,
        textAlignment: 'center',
      };
    }
  );

  let contextDelta: ContextDelta | undefined;
  if (parsed.context_delta && typeof parsed.context_delta === 'object') {
    contextDelta = {
      charactersDiscovered: parsed.context_delta.characters_discovered?.map((c) => ({
        name: c.name,
        description: c.description,
      })),
      glossaryUpdates: parsed.context_delta.glossary_updates?.map((g) => ({
        original: g.original,
        translation: g.translation,
      })),
      sceneSummary: parsed.context_delta.scene_summary || undefined,
    };
  }

  const result: TranslationResult = {
    pageId,
    imageId,
    sourceLanguage,
    targetLanguage,
    bubbles: normalizedBubbles,
    contextDelta,
    durationMs,
    providerId,
    modelId,
  };

  const validation = validateTranslationResult(result);
  if (!validation.valid) {
    throw new InvalidProviderResponseError(
      `Normalized result failed contract validation: ${validation.errors.join('; ')}`,
      providerId,
      result,
      validation.errors
    );
  }

  return result;
}
