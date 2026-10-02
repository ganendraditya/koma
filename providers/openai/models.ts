import { ProviderError } from '@core/errors';

export type ReasoningEffort =
  'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function supportedReasoningEfforts(
  model: string
): Exclude<ReasoningEffort, 'auto'>[] | undefined {
  if (/-pro(?:-|$)|-chat-latest$/.test(model)) return undefined;
  if (/^(?:o1|o3|o4-mini)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['low', 'medium', 'high'];
  if (/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return ['minimal', 'low', 'medium', 'high'];
  if (/^gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['none', 'low', 'medium', 'high'];
  if (/^gpt-5\.(?:2|4(?:-(?:mini|nano))?|5)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return ['none', 'low', 'medium', 'high', 'xhigh'];
  if (/^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (/^(?:gpt-6-astra|gpt-6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gpt-6-(?:sol|luna)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gpt-4(?:\.|o|-)/.test(model)) return [];
  return undefined;
}

export function resolveReasoningEffort(
  model: string,
  effort: ReasoningEffort,
  compatible: boolean
): Exclude<ReasoningEffort, 'auto'> | undefined {
  const supported = compatible ? undefined : supportedReasoningEfforts(model);
  if (effort === 'auto') return supported?.includes('low') ? 'low' : undefined;
  if (supported && !supported.includes(effort)) {
    throw new ProviderError(
      `This model does not support ${effort === 'none' ? 'turning reasoning off' : `${effort} reasoning`}. Choose Auto or a supported effort.`,
      'KOMA_INVALID_REQUEST_ERROR',
      'openai'
    );
  }
  return effort;
}
