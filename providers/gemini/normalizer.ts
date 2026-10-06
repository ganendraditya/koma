import { normalizeTranslationOutput, type NormalizeParams } from '../common/normalizer';

export function normalizeGeminiResponse(
  params: Omit<NormalizeParams, 'providerId'> & { providerId?: string }
) {
  return normalizeTranslationOutput({
    ...params,
    providerId: params.providerId || 'gemini-multimodal',
  });
}
