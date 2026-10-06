import {
  createBoundingBox,
  validateTranslationResult,
  type Bubble,
  type BubbleType,
  type ContextDelta,
  type TranslationResult,
} from '@core/contracts';
import { InvalidProviderResponseError } from '@core/errors';

export interface NormalizeParams {
  rawText: string;
  imageId: string;
  pageId?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  durationMs?: number;
  modelId?: string;
  providerId: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function text(value: unknown, optional?: false): string;
function text(value: unknown, optional: true): string | undefined;
function text(value: unknown, optional = false): string | undefined {
  if (optional && (value === undefined || value === null)) return undefined;
  if (typeof value !== 'string') throw new Error('Expected text');
  return value.trim();
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}

const bubbleTypes = new Set<BubbleType>(['speech', 'narration', 'thought', 'sfx', 'other']);

export function normalizeTranslationOutput(params: NormalizeParams): TranslationResult {
  try {
    // Some local thinking models put a complete think block ahead of their final answer.
    const cleaned = params.rawText
      .trim()
      .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = object(JSON.parse(cleaned));
    if (!Array.isArray(parsed.bubbles)) throw new Error('Missing bubbles');
    const bubbles: Bubble[] = parsed.bubbles.map((value, index) => {
      const raw = object(value);
      const box = raw.box_2d;
      if (
        !Array.isArray(box) ||
        box.length !== 4 ||
        !box.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        throw new Error('Invalid bounding box');
      }
      const translatedText = text(raw.translated_text);
      if (
        raw.reading_order !== undefined &&
        (!Number.isInteger(raw.reading_order) || (raw.reading_order as number) < 0)
      ) {
        throw new Error('Invalid reading order');
      }
      return {
        id: `bubble_${String(index + 1).padStart(3, '0')}`,
        box: createBoundingBox(box[0], box[1], box[2], box[3]),
        sourceText: text(raw.source_text, true),
        translatedText,
        bubbleType: bubbleTypes.has(raw.bubble_type as BubbleType)
          ? (raw.bubble_type as BubbleType)
          : 'speech',
        speaker: text(raw.speaker, true) || null,
        readingOrder: (raw.reading_order as number | undefined) ?? index + 1,
        textAlignment: 'center',
      };
    });
    let contextDelta: ContextDelta | undefined;
    if (parsed.context_delta !== undefined && parsed.context_delta !== null) {
      const delta = object(parsed.context_delta);
      contextDelta = {
        charactersDiscovered: list(delta.characters_discovered).map((value) => {
          const character = object(value);
          const name = text(character.name);
          if (!name) throw new Error('Empty character name');
          return { name, description: text(character.description, true) };
        }),
        glossaryUpdates: list(delta.glossary_updates).map((value) => {
          const entry = object(value);
          const original = text(entry.original);
          const translation = text(entry.translation);
          if (!original || !translation) throw new Error('Empty glossary text');
          return { original, translation };
        }),
        sceneSummary: text(delta.scene_summary, true) || undefined,
      };
    }
    const result: TranslationResult = {
      pageId: params.pageId || `page_${params.imageId}`,
      imageId: params.imageId,
      sourceLanguage: params.sourceLanguage || 'ja',
      targetLanguage: params.targetLanguage,
      bubbles,
      contextDelta,
      durationMs: params.durationMs,
      providerId: params.providerId,
      modelId: params.modelId,
    };
    if (!validateTranslationResult(result).valid) throw new Error('Contract validation failed');
    return result;
  } catch {
    throw new InvalidProviderResponseError(
      'Translation output has invalid JSON, text, or bounding boxes.',
      params.providerId
    );
  }
}
