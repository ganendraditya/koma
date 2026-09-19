import { FontScaleOptions } from './types';

export const DEFAULT_MIN_FONT_SIZE = 8;
export const DEFAULT_MAX_FONT_SIZE = 18;
export const DEFAULT_LINE_HEIGHT = 1.2;

/**
 * Computes an estimated fitted font size for text given target box dimensions.
 * Useful for deterministic calculation and headless/mock environments.
 */
export function estimateFittedFontSize(
  text: string,
  boxWidth: number,
  boxHeight: number,
  options?: FontScaleOptions
): number {
  const minFontSize = options?.minFontSize ?? DEFAULT_MIN_FONT_SIZE;
  const maxFontSize = options?.maxFontSize ?? DEFAULT_MAX_FONT_SIZE;
  const lineHeight = options?.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const step = options?.step ?? 1;

  if (boxWidth <= 0 || boxHeight <= 0 || !text || text.trim().length === 0) {
    return minFontSize;
  }

  const charCount = text.length;

  // Search downwards from maxFontSize to minFontSize
  for (let size = maxFontSize; size >= minFontSize; size -= step) {
    // Average character width for proportional sans-serif fonts is roughly ~0.55 of fontSize
    const avgCharWidth = size * 0.55;
    const charsPerLine = Math.max(1, Math.floor(boxWidth / avgCharWidth));
    const estimatedLines = Math.ceil(charCount / charsPerLine);
    const estimatedHeight = estimatedLines * (size * lineHeight);

    if (estimatedHeight <= boxHeight && avgCharWidth <= boxWidth) {
      return size;
    }
  }

  return minFontSize;
}

/**
 * Dynamically scales down font size on a DOM element until it fits within its container.
 * Uses real DOM scroll dimensions when available, with algorithmic fallback for zero-dimension layouts.
 */
export function fitTextToBubble(
  textElement: HTMLElement,
  container: HTMLElement,
  options?: FontScaleOptions
): number {
  const minFontSize = options?.minFontSize ?? DEFAULT_MIN_FONT_SIZE;
  const maxFontSize = options?.maxFontSize ?? DEFAULT_MAX_FONT_SIZE;
  const step = options?.step ?? 1;

  const text = textElement.textContent || '';
  const clientWidth = container.clientWidth;
  const clientHeight = container.clientHeight;

  // If DOM layout dimensions are available and measurable
  if (clientWidth > 0 && clientHeight > 0) {
    let currentFontSize = maxFontSize;
    textElement.style.fontSize = `${currentFontSize}px`;

    // Iteratively decrease font size while text overflows the container
    while (
      currentFontSize > minFontSize &&
      (textElement.scrollHeight > clientHeight || textElement.scrollWidth > clientWidth)
    ) {
      currentFontSize = Math.max(minFontSize, currentFontSize - step);
      textElement.style.fontSize = `${currentFontSize}px`;
    }

    return currentFontSize;
  }

  // Fallback: estimate based on style width/height or bounding box
  const rectWidth = parseFloat(container.style.width) || container.offsetWidth || 100;
  const rectHeight = parseFloat(container.style.height) || container.offsetHeight || 60;
  const fitted = estimateFittedFontSize(text, rectWidth, rectHeight, options);

  textElement.style.fontSize = `${fitted}px`;
  return fitted;
}
