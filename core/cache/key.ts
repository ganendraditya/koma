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

function normalizeImageIdentity(image: CacheKeyInput['image']): string {
  if (image.url && !image.url.startsWith('blob:') && !image.url.startsWith('data:')) {
    try {
      const base =
        typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost';
      const parsed = new URL(image.url, base);
      const cleanParams = new URLSearchParams();

      for (const [key, value] of parsed.searchParams.entries()) {
        if (!TRANSIENT_QUERY_PARAMS.has(key.toLowerCase())) {
          cleanParams.append(key, value);
        }
      }

      cleanParams.sort();
      const queryString = cleanParams.toString();
      const isRelative = image.url.startsWith('/') || !image.url.includes('://');
      const origin = isRelative ? '' : parsed.origin;
      return `${origin}${parsed.pathname}${queryString ? `?${queryString}` : ''}`;
    } catch {
      return image.url.trim();
    }
  }

  const id = image.id?.trim() || 'unknown-image';
  return image.pageIndex !== undefined ? `${id}:p${image.pageIndex}` : id;
}

export function generateCacheKey(input: CacheKeyInput): string {
  const imageIdent = normalizeImageIdentity(input.image);
  const sourceLang = (input.sourceLanguage || 'auto').trim().toLowerCase();
  const targetLang = input.targetLanguage.trim().toLowerCase();
  const providerIdent = (input.providerId || 'any-provider').trim().toLowerCase();
  const modelIdent = (input.modelId || 'default-model').trim().toLowerCase();

  return `koma:cache:v1:${imageIdent}:${sourceLang}:${targetLang}:${providerIdent}:${modelIdent}`;
}
