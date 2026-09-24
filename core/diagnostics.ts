export type PipelineStage = 'detection' | 'provider' | 'normalization' | 'render';
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

export function pipelineFailure(stage: PipelineStage): Error {
  logPipeline(stage, 'failed');
  return new Error(`Translation failed at ${stage} stage`);
}
