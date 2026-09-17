/**
 * Base error class for all Koma domain errors.
 */
export class KomaError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'KOMA_GENERAL_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;

    // Restore prototype chain for instanceof checks in ES target
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base error class for issues arising during provider interactions.
 */
export class ProviderError extends KomaError {
  public readonly providerId?: string;

  constructor(
    message: string,
    code = 'KOMA_PROVIDER_ERROR',
    providerId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, code, { ...details, providerId });
    this.providerId = providerId;
  }
}

/**
 * Thrown when provider authentication fails (e.g. invalid or missing API key).
 */
export class ProviderAuthError extends ProviderError {
  constructor(message = 'Invalid or missing API key', providerId?: string) {
    super(message, 'KOMA_AUTH_ERROR', providerId);
  }
}

/**
 * Thrown when an AI provider rate limit is exceeded (e.g. HTTP 429).
 */
export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message = 'API rate limit exceeded',
    providerId?: string,
    retryAfterSeconds?: number
  ) {
    super(message, 'KOMA_RATE_LIMIT_ERROR', providerId, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown when a provider request times out.
 */
export class ProviderTimeoutError extends ProviderError {
  public readonly timeoutMs?: number;

  constructor(message = 'Provider request timed out', providerId?: string, timeoutMs?: number) {
    super(message, 'KOMA_TIMEOUT_ERROR', providerId, { timeoutMs });
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a model response is malformed or cannot be normalized into TranslationResult.
 */
export class InvalidProviderResponseError extends ProviderError {
  public readonly rawResponse?: unknown;
  public readonly validationErrors?: string[];

  constructor(
    message = 'Provider returned invalid or malformed response',
    providerId?: string,
    rawResponse?: unknown,
    validationErrors?: string[]
  ) {
    super(message, 'KOMA_INVALID_RESPONSE_ERROR', providerId, {
      rawResponse,
      validationErrors,
    });
    this.rawResponse = rawResponse;
    this.validationErrors = validationErrors;
  }
}

/**
 * Thrown when a feature is requested that the provider does not support.
 */
export class UnsupportedCapabilityError extends ProviderError {
  public readonly requiredCapability: string;

  constructor(requiredCapability: string, providerId?: string) {
    super(
      `Provider does not support required capability: ${requiredCapability}`,
      'KOMA_UNSUPPORTED_CAPABILITY_ERROR',
      providerId,
      { requiredCapability }
    );
    this.requiredCapability = requiredCapability;
  }
}

/**
 * Thrown when site adapter fails to detect or extract manga images.
 */
export class AdapterError extends KomaError {
  public readonly siteName?: string;

  constructor(message: string, siteName?: string, details?: Record<string, unknown>) {
    super(message, 'KOMA_ADAPTER_ERROR', { ...details, siteName });
    this.siteName = siteName;
  }
}

/**
 * Thrown when client-side canvas pre-processing or image manipulation fails.
 */
export class ImageProcessingError extends KomaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'KOMA_IMAGE_PROCESSING_ERROR', details);
  }
}
