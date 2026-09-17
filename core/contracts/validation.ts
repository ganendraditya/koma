import { TranslationResult } from './provider';
import { isValidBoundingBox } from './geometry';

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that an object strictly adheres to the normalized TranslationResult contract.
 * Ensures bubble IDs are unique, coordinates are bounded, and required fields are present.
 */
export function validateTranslationResult(data: unknown): ValidationOutcome {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Translation result must be a non-null object'] };
  }

  const result = data as Partial<TranslationResult>;

  if (!result.pageId || typeof result.pageId !== 'string') {
    errors.push('Missing or invalid pageId');
  }

  if (!result.imageId || typeof result.imageId !== 'string') {
    errors.push('Missing or invalid imageId');
  }

  if (!result.sourceLanguage || typeof result.sourceLanguage !== 'string') {
    errors.push('Missing or invalid sourceLanguage');
  }

  if (!result.targetLanguage || typeof result.targetLanguage !== 'string') {
    errors.push('Missing or invalid targetLanguage');
  }

  if (!Array.isArray(result.bubbles)) {
    errors.push('bubbles must be an array');
    return { valid: false, errors };
  }

  const seenBubbleIds = new Set<string>();

  result.bubbles.forEach((bubble, idx) => {
    if (!bubble || typeof bubble !== 'object') {
      errors.push(`Bubble at index ${idx} is not an object`);
      return;
    }

    if (!bubble.id || typeof bubble.id !== 'string') {
      errors.push(`Bubble at index ${idx} has missing or non-string id`);
    } else {
      if (seenBubbleIds.has(bubble.id)) {
        errors.push(`Duplicate bubble ID '${bubble.id}' detected at index ${idx}`);
      }
      seenBubbleIds.add(bubble.id);
    }

    if (typeof bubble.translatedText !== 'string') {
      errors.push(`Bubble '${bubble.id ?? idx}' must have a string translatedText`);
    }

    if (bubble.sourceText !== undefined && typeof bubble.sourceText !== 'string') {
      errors.push(`Bubble '${bubble.id ?? idx}' has non-string sourceText`);
    }

    if (!isValidBoundingBox(bubble.box)) {
      errors.push(
        `Bubble '${bubble.id ?? idx}' has invalid bounding box: ${JSON.stringify(bubble.box)}`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
