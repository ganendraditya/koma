import type { MangaImage } from '../contracts';

export interface ViewportRect {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  height?: number;
}

export interface ImagePosition {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  height?: number;
}

export interface ViewportDistanceResult {
  /** Distance in pixels to the viewport edge. 0 if currently overlapping viewport. */
  distance: number;
  /** True if the image is at least partially visible in the viewport. */
  isVisible: boolean;
  /** Number of vertical pixels intersecting the viewport. */
  overlapHeight: number;
  /** Distance from image vertical center to viewport vertical center. */
  distanceToCenter: number;
}

/**
 * Calculates distance, visibility, and overlap of an image relative to a viewport.
 */
export function calculateViewportDistance(
  imagePos: ImagePosition,
  viewport: ViewportRect
): ViewportDistanceResult {
  const viewportHeight = Math.max(0, viewport.bottom - viewport.top);
  const viewportCenter = viewport.top + viewportHeight / 2;
  const imageHeight = Math.max(0, imagePos.bottom - imagePos.top);
  const imageCenter = imagePos.top + imageHeight / 2;
  const distanceToCenter = Math.abs(imageCenter - viewportCenter);

  // Check if image intersects the vertical span of the viewport
  const isIntersecting = imagePos.bottom > viewport.top && imagePos.top < viewport.bottom;

  if (isIntersecting) {
    const overlapTop = Math.max(imagePos.top, viewport.top);
    const overlapBottom = Math.min(imagePos.bottom, viewport.bottom);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);

    return {
      distance: 0,
      isVisible: true,
      overlapHeight,
      distanceToCenter,
    };
  }

  // Image is below viewport (reader hasn't scrolled down to it yet)
  if (imagePos.top >= viewport.bottom) {
    return {
      distance: imagePos.top - viewport.bottom,
      isVisible: false,
      overlapHeight: 0,
      distanceToCenter,
    };
  }

  // Image is above viewport (reader scrolled past it)
  return {
    distance: viewport.top - imagePos.bottom,
    isVisible: false,
    overlapHeight: 0,
    distanceToCenter,
  };
}

/**
 * Finds the image closest to or most prominently inside the viewport.
 */
export function findNearestImageToViewport(
  images: MangaImage[],
  resolvePosition: (img: MangaImage) => ImagePosition | null,
  viewport: ViewportRect
): MangaImage | null {
  if (!images || images.length === 0) {
    return null;
  }

  let bestImage: MangaImage | null = null;
  let bestResult: ViewportDistanceResult | null = null;

  for (const img of images) {
    const pos = resolvePosition(img);
    if (!pos) continue;

    const result = calculateViewportDistance(pos, viewport);

    if (!bestResult) {
      bestImage = img;
      bestResult = result;
      continue;
    }

    // Rule 1: A visible image beats any non-visible image
    if (result.isVisible && !bestResult.isVisible) {
      bestImage = img;
      bestResult = result;
      continue;
    }
    if (!result.isVisible && bestResult.isVisible) {
      continue;
    }

    // Rule 2: Both are visible -> prefer larger visible overlap, or closer to viewport center
    if (result.isVisible && bestResult.isVisible) {
      if (result.overlapHeight > bestResult.overlapHeight * 1.1) {
        bestImage = img;
        bestResult = result;
      } else if (bestResult.overlapHeight > result.overlapHeight * 1.1) {
        // Keep current best
      } else if (result.distanceToCenter < bestResult.distanceToCenter) {
        bestImage = img;
        bestResult = result;
      }
      continue;
    }

    // Rule 3: Neither is visible -> prefer smaller distance to viewport
    if (result.distance < bestResult.distance) {
      bestImage = img;
      bestResult = result;
    }
  }

  // Fallback to first image in list if no positions could be resolved
  return bestImage ?? images[0];
}

/**
 * Default element locator and bounding box resolver using DOM inspection.
 */
export function defaultResolveImagePosition(
  image: MangaImage,
  adapter?: { getImageElement?: (img: MangaImage) => Element | null }
): ImagePosition | null {
  let el: Element | null = null;
  if (adapter?.getImageElement) {
    el = adapter.getImageElement(image);
  }

  if (!el && typeof document !== 'undefined') {
    el =
      document.querySelector(`img[data-koma-image-id="${image.id}"]`) ||
      (image.url ? document.querySelector(`img[src="${image.url}"]`) : null) ||
      (typeof image.metadata?.selector === 'string'
        ? document.querySelector(image.metadata.selector)
        : null);
  }

  if (el && typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
    };
  }

  return null;
}

/**
 * Returns default viewport coordinates based on window dimensions.
 */
export function getDefaultViewport(): ViewportRect {
  if (typeof window === 'undefined') {
    return { top: 0, bottom: 800, height: 800 };
  }
  const height = window.innerHeight || 800;
  return {
    top: 0,
    bottom: height,
    left: 0,
    right: window.innerWidth || 1200,
    height,
  };
}
