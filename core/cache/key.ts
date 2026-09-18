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
      const parsed = new URL(image.url);
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

  return image.id.trim();
}

export function generateCacheKey(input: CacheKeyInput): string {
  const imageIdent = normalizeImageIdentity(input.image);
  const targetLang = input.targetLanguage.trim().toLowerCase();
  const providerIdent = (input.providerId || 'any-provider').trim().toLowerCase();
  const modelIdent = (input.modelId || 'default-model').trim().toLowerCase();

  return `koma:cache:v1:${imageIdent}:${targetLang}:${providerIdent}:${modelIdent}`;
}
