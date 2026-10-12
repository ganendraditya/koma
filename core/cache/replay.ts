import type { ContextPacket, ReadingIdentity, TranslationResult } from '../contracts';
import { validateTranslationResult } from '../contracts';

export const REPLAY_PREFIX = 'koma_cache:v2:';
export const REPLAY_FORMAT_VERSION = 2;
export const TRANSLATION_PROMPT_VERSION = 1;

export interface ReplayIdentity {
  reading: ReadingIdentity;
  pageIndex: number;
  sourceIdentity: string;
  contentHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  modelId: string;
  configuration: string;
  promptVersion: number;
  contextRevision: string;
}

export interface ReplayRecord {
  schemaVersion: 2;
  identity: ReplayIdentity;
  result: TranslationResult;
  requestContextHash: string;
  acceptedAt: number;
  lastAccessedAt: number;
  invalidated?: boolean;
}

export interface ReplayLookup {
  record: ReplayRecord | null;
  generation: string;
  warning?: string;
}

export interface ReplayCache {
  lookup(identity: ReplayIdentity): Promise<ReplayLookup>;
  accept(record: ReplayRecord, generation: string): Promise<{ warning?: string }>;
  invalidate(reading: ReadingIdentity, targetLanguage: string, fromPage?: number): Promise<void>;
}

export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function replayDescriptor(identity: ReplayIdentity): string {
  const { reading } = identity;
  return JSON.stringify([
    REPLAY_FORMAT_VERSION,
    reading.site,
    reading.seriesId ?? null,
    reading.chapterId,
    identity.pageIndex,
    identity.sourceIdentity,
    identity.contentHash,
    identity.sourceLanguage,
    identity.targetLanguage,
    identity.providerId,
    identity.modelId,
    identity.configuration,
    identity.promptVersion,
    identity.contextRevision,
  ]);
}

export async function replayKey(identity: ReplayIdentity): Promise<string> {
  return REPLAY_PREFIX + (await sha256(replayDescriptor(identity)));
}

export function isReplayIdentity(value: unknown): value is ReplayIdentity {
  if (!value || typeof value !== 'object') return false;
  const x = value as ReplayIdentity;
  const reading = x.reading;
  return Boolean(
    reading &&
    typeof reading === 'object' &&
    typeof reading.site === 'string' &&
    reading.site.length > 0 &&
    reading.site.length <= 100 &&
    typeof reading.chapterId === 'string' &&
    reading.chapterId.length > 0 &&
    reading.chapterId.length <= 200 &&
    (reading.seriesId === undefined ||
      (typeof reading.seriesId === 'string' && reading.seriesId.length <= 200)) &&
    Number.isSafeInteger(x.pageIndex) &&
    x.pageIndex >= 0 &&
    typeof x.sourceIdentity === 'string' &&
    x.sourceIdentity.length > 0 &&
    x.sourceIdentity.length <= 1000 &&
    typeof x.contentHash === 'string' &&
    /^[a-f\d]{64}$/.test(x.contentHash) &&
    typeof x.contextRevision === 'string' &&
    /^[a-f\d]{64}$/.test(x.contextRevision) &&
    [x.sourceLanguage, x.targetLanguage, x.providerId, x.modelId, x.configuration].every(
      (v) => typeof v === 'string' && v.length <= 2000
    ) &&
    x.promptVersion === TRANSLATION_PROMPT_VERSION
  );
}

export function isReplayRecord(value: unknown): value is ReplayRecord {
  if (!value || typeof value !== 'object') return false;
  const x = value as ReplayRecord;
  return (
    x.schemaVersion === 2 &&
    isReplayIdentity(x.identity) &&
    (x.invalidated === undefined || typeof x.invalidated === 'boolean') &&
    typeof x.requestContextHash === 'string' &&
    /^[a-f\d]{64}$/.test(x.requestContextHash) &&
    Number.isFinite(x.acceptedAt) &&
    x.acceptedAt >= 0 &&
    Number.isFinite(x.lastAccessedAt) &&
    x.lastAccessedAt >= 0 &&
    validateTranslationResult(x.result).valid &&
    x.result.targetLanguage === x.identity.targetLanguage &&
    x.result.bubbles.every(
      (b) =>
        (b.speaker === undefined || b.speaker === null || typeof b.speaker === 'string') &&
        (b.bubbleType === undefined ||
          ['speech', 'narration', 'thought', 'sfx', 'other'].includes(b.bubbleType)) &&
        (b.textAlignment === undefined || ['center', 'left', 'right'].includes(b.textAlignment)) &&
        (b.readingOrder === undefined ||
          (Number.isSafeInteger(b.readingOrder) && b.readingOrder > 0))
    ) &&
    (x.result.contextDelta === undefined ||
      (x.result.contextDelta !== null &&
        typeof x.result.contextDelta === 'object' &&
        (x.result.contextDelta.glossaryUpdates === undefined ||
          (Array.isArray(x.result.contextDelta.glossaryUpdates) &&
            x.result.contextDelta.glossaryUpdates.every(
              (g) => g && typeof g.original === 'string' && typeof g.translation === 'string'
            )))))
  );
}

export function normalizedIdentity(identity: ReplayIdentity): ReplayIdentity {
  return {
    reading: {
      site: identity.reading.site,
      chapterId: identity.reading.chapterId,
      seriesId: identity.reading.seriesId,
    },
    pageIndex: identity.pageIndex,
    sourceIdentity: identity.sourceIdentity,
    contentHash: identity.contentHash,
    sourceLanguage: identity.sourceLanguage,
    targetLanguage: identity.targetLanguage,
    providerId: identity.providerId,
    modelId: identity.modelId,
    configuration: identity.configuration,
    promptVersion: identity.promptVersion,
    contextRevision: identity.contextRevision,
  };
}

export function normalizedResult(result: TranslationResult): TranslationResult {
  return {
    pageId: result.pageId,
    imageId: result.imageId,
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    bubbles: result.bubbles.map((b) => ({
      id: b.id,
      box: { ymin: b.box.ymin, xmin: b.box.xmin, ymax: b.box.ymax, xmax: b.box.xmax },
      sourceText: b.sourceText,
      translatedText: b.translatedText,
      bubbleType: b.bubbleType,
      speaker: b.speaker,
      readingOrder: b.readingOrder,
      textAlignment: b.textAlignment,
      confidence:
        b.confidence && typeof b.confidence === 'object'
          ? {
              ocr: typeof b.confidence.ocr === 'number' ? b.confidence.ocr : undefined,
              translation:
                typeof b.confidence.translation === 'number' ? b.confidence.translation : undefined,
              overall: typeof b.confidence.overall === 'number' ? b.confidence.overall : undefined,
            }
          : undefined,
    })),
    contextDelta: result.contextDelta
      ? {
          glossaryUpdates: result.contextDelta.glossaryUpdates?.map((g) => ({
            original: g.original,
            translation: g.translation,
          })),
        }
      : undefined,
  };
}

export function replayPreferences(context: ContextPacket, userRevision: string): string {
  return JSON.stringify([
    userRevision,
    context.seriesTitle ?? null,
    context.translationStyle ?? null,
    context.preserveHonorifics ?? null,
    (context.glossary ?? [])
      .filter((g) => g.isHard)
      .map((g) => [g.original, g.translation])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  ]);
}
