import {
  InvalidProviderResponseError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from './errors';

export type PipelineStage = 'detection' | 'provider' | 'normalization' | 'render' | 'orchestration';
type PipelineEvent =
  | 'scan'
  | 'request'
  | 'duration'
  | 'translation'
  | 'hit'
  | 'miss'
  | 'bypass'
  | 'in-flight'
  | 'failed';

export function logPipeline(
  stage: PipelineStage | 'total' | 'cache',
  event: PipelineEvent,
  durationMs?: number
): void {
  if (import.meta.env.MODE !== 'development') return;
  if (durationMs === undefined) {
    console.debug(`[Koma pipeline] ${stage}: ${event}`);
  } else {
    console.debug(`[Koma pipeline] ${stage}: ${event} (${durationMs.toFixed(1)}ms)`);
  }
}

export function pipelineFailure(stage: PipelineStage, cause?: unknown): Error {
  logPipeline(stage, 'failed');
  if (stage === 'provider') {
    if (cause instanceof ProviderAuthError) {
      return new ProviderAuthError(
        'Translation failed at provider stage: Check your API key.',
        cause.providerId
      );
    }
    if (cause instanceof ProviderRateLimitError) {
      return new ProviderRateLimitError(
        'Translation failed at provider stage: Rate limit exceeded.',
        cause.providerId,
        cause.retryAfterSeconds
      );
    }
    if (cause instanceof ProviderTimeoutError) {
      return new ProviderTimeoutError(
        'Translation failed at provider stage: Request timed out.',
        cause.providerId,
        cause.timeoutMs
      );
    }
    if (cause instanceof ProviderError) {
      return new ProviderError(
        cause.code === 'KOMA_INVALID_REQUEST_ERROR' ||
          cause.code === 'KOMA_SETTINGS_CHANGED' ||
          cause.code === 'KOMA_UNSUPPORTED_CAPABILITY_ERROR'
          ? cause.message
          : 'Translation failed at provider stage',
        cause.code,
        cause.providerId
      );
    }
  }
  if (stage === 'normalization' && cause instanceof InvalidProviderResponseError) {
    return new InvalidProviderResponseError(
      cause.reason === 'incomplete'
        ? 'The model stopped before completing the translation. Try lower reasoning effort or retry.'
        : cause.reason === 'refusal'
          ? 'The model declined to translate this image.'
          : 'Translation failed at normalization stage',
      cause.providerId,
      undefined,
      undefined,
      cause.reason
    );
  }
  return new Error(`Translation failed at ${stage} stage`);
}
