/**
 * Standard normalized bounding box coordinate convention.
 *
 * Coordinates are represented in integer range [0, 1000]:
 * - (xmin: 0, ymin: 0) is the top-left corner of the image.
 * - (xmax: 1000, ymax: 1000) is the bottom-right corner of the image.
 *
 * This standard is model-agnostic, avoids floating-point precision drift,
 * and seamlessly converts to CSS percentages or rendered pixel dimensions.
 */
export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

/**
 * Pixel dimensions and position derived from a BoundingBox and image size.
 */
export interface PixelRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Percentage values formatted for CSS styles (e.g. '12.5%').
 */
export interface PercentageRect {
  top: string;
  left: string;
  width: string;
  height: string;
}

/**
 * Creates and clamps a normalized BoundingBox to [0, 1000].
 */
export function createBoundingBox(
  ymin: number,
  xmin: number,
  ymax: number,
  xmax: number
): BoundingBox {
  const clamp = (val: number) => Math.max(0, Math.min(1000, Math.round(val)));
  const y1 = clamp(ymin);
  const x1 = clamp(xmin);
  const y2 = clamp(ymax);
  const x2 = clamp(xmax);

  return {
    ymin: Math.min(y1, y2),
    xmin: Math.min(x1, x2),
    ymax: Math.max(y1, y2),
    xmax: Math.max(x1, x2),
  };
}

/**
 * Validates whether a BoundingBox has valid coordinates within [0, 1000].
 */
export function isValidBoundingBox(box: unknown): box is BoundingBox {
  if (!box || typeof box !== 'object') {
    return false;
  }

  const b = box as Partial<BoundingBox>;
  if (
    typeof b.ymin !== 'number' ||
    typeof b.xmin !== 'number' ||
    typeof b.ymax !== 'number' ||
    typeof b.xmax !== 'number'
  ) {
    return false;
  }

  return (
    b.ymin >= 0 &&
    b.ymin <= 1000 &&
    b.xmin >= 0 &&
    b.xmin <= 1000 &&
    b.ymax >= 0 &&
    b.ymax <= 1000 &&
    b.xmax >= 0 &&
    b.xmax <= 1000 &&
    b.ymax >= b.ymin &&
    b.xmax >= b.xmin
  );
}

/**
 * Converts a normalized BoundingBox [0, 1000] to absolute pixel coordinates.
 */
export function boxToPixels(box: BoundingBox, imageWidth: number, imageHeight: number): PixelRect {
  const top = (box.ymin / 1000) * imageHeight;
  const left = (box.xmin / 1000) * imageWidth;
  const width = ((box.xmax - box.xmin) / 1000) * imageWidth;
  const height = ((box.ymax - box.ymin) / 1000) * imageHeight;

  return { top, left, width, height };
}

/**
 * Converts a normalized BoundingBox [0, 1000] to CSS percentage strings.
 */
export function boxToPercentages(box: BoundingBox): PercentageRect {
  return {
    top: `${(box.ymin / 10).toFixed(2)}%`,
    left: `${(box.xmin / 10).toFixed(2)}%`,
    width: `${((box.xmax - box.xmin) / 10).toFixed(2)}%`,
    height: `${((box.ymax - box.ymin) / 10).toFixed(2)}%`,
  };
}
