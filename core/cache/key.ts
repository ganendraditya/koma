import { CacheKeyInput } from './types';

const TRANSIENT_QUERY_PARAMS = new Set([
  'token',
  't',
  'timestamp',
  'expires',
  'auth',
  'sig',
  'signature',
  '_',
  'v',
]);

function normalizeImageIdentity(image: CacheKeyInput['image'], documentUrl?: string): string {
  if (image.url && !image.url.startsWith('blob:') && !image.url.startsWith('data:')) {
    try {
      const base =
        documentUrl ||
        (typeof document !== 'undefined' && (document.baseURI || document.URL)) ||
        (typeof location !== 'undefined' && location.href) ||
        'http://localhost';
      const parsed = new URL(image.url, base);
      const cleanParams = new URLSearchParams();

      for (const [key, value] of parsed.searchParams.entries()) {
        if (!TRANSIENT_QUERY_PARAMS.has(key.toLowerCase())) {
          cleanParams.append(key, value);
        }
      }

      cleanParams.sort();
      const queryString = cleanParams.toString();
      return `${parsed.origin}${parsed.pathname}${queryString ? `?${queryString}` : ''}`;
    } catch {
      return image.url.trim();
    }
  }

  const id = image.id?.trim() || 'unknown-image';
  return image.pageIndex !== undefined ? `${id}:p${image.pageIndex}` : id;
}

function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeContextFingerprint(
  context?: CacheKeyInput['context'],
  customPrompt?: string
): string {
  if (!context && !customPrompt?.trim()) {
    return 'none';
  }

  const normalized: Record<string, unknown> = {};

  if (customPrompt?.trim()) {
    normalized.customPrompt = customPrompt.trim();
  }

  if (context) {
    if (context.seriesTitle?.trim()) {
      normalized.seriesTitle = context.seriesTitle.trim();
    }
    if (context.translationStyle) {
      normalized.translationStyle = context.translationStyle;
    }
    if (context.preserveHonorifics !== undefined) {
      normalized.preserveHonorifics = context.preserveHonorifics;
    }
    if (context.chapterSummary?.trim()) {
      normalized.chapterSummary = context.chapterSummary.trim();
    }
    if (context.glossary && context.glossary.length > 0) {
      normalized.glossary = [...context.glossary]
        .map((g) => ({
          original: g.original.trim(),
          translation: g.translation.trim(),
          isHard: Boolean(g.isHard),
        }))
        .sort((a, b) => a.original.localeCompare(b.original));
    }
    if (context.characters && context.characters.length > 0) {
      normalized.characters = [...context.characters]
        .map((c) => ({
          name: c.name.trim(),
          description: c.description?.trim(),
          aliases: c.aliases ? [...c.aliases].sort() : undefined,
          pronouns: c.pronouns?.trim(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (context.recentDialogue && context.recentDialogue.length > 0) {
      normalized.recentDialogue = context.recentDialogue.map((d) => ({
        speaker: d.speaker?.trim(),
        sourceText: d.sourceText?.trim(),
        translatedText: d.translatedText.trim(),
        pageIndex: d.pageIndex,
      }));
    }
  }

  if (Object.keys(normalized).length === 0) {
    return 'none';
  }

  return fnv1aHex(JSON.stringify(normalized));
}

export function generateCacheKey(input: CacheKeyInput): string {
  const imageIdent = normalizeImageIdentity(input.image, input.documentUrl);
  const sourceLang = (input.sourceLanguage || 'auto').trim().toLowerCase();
  const targetLang = input.targetLanguage.trim().toLowerCase();
  const providerIdent = (input.providerId || 'any-provider').trim().toLowerCase();
  const modelIdent = (input.modelId || 'default-model').trim().toLowerCase();
  const ctxFingerprint = computeContextFingerprint(input.context, input.customPrompt);

  return `koma:cache:v1:${imageIdent}:${sourceLang}:${targetLang}:${providerIdent}:${modelIdent}:ctx_${ctxFingerprint}`;
}
