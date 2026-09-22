import { KomaError } from '@core/errors';

export function resolveTargetImage(
  targetSelector: string,
  root: ParentNode = document
): HTMLImageElement {
  let target: Element | null;

  try {
    target = root.querySelector(targetSelector);
  } catch (error) {
    throw new KomaError('The target image selector is invalid', 'KOMA_RENDERER_INVALID_SELECTOR', {
      targetSelector,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!(target instanceof HTMLImageElement)) {
    throw new KomaError(
      `Target image element could not be found for selector: "${targetSelector}"`,
      'KOMA_RENDERER_IMAGE_NOT_FOUND',
      { targetSelector }
    );
  }

  return target;
}
