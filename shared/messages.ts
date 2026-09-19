/**
 * Standard message types and payloads for Chrome extension inter-process communication.
 */

export const EXTENSION_MESSAGE_TYPES = {
  PING: 'PING',
  CHECK_PAGE_STATUS: 'CHECK_PAGE_STATUS',
  RUN_DIAGNOSTIC: 'RUN_DIAGNOSTIC',
  TRANSLATE_ACTIVE_PAGE: 'TRANSLATE_ACTIVE_PAGE',
  TRANSLATION_PROGRESS: 'TRANSLATION_PROGRESS',
} as const;

export type ExtensionMessageType =
  (typeof EXTENSION_MESSAGE_TYPES)[keyof typeof EXTENSION_MESSAGE_TYPES];

export interface PingRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.PING;
}

export interface PingResponse {
  status: 'OK';
  version: string;
  timestamp: number;
}

export interface CheckPageStatusRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS;
}

export interface CheckPageStatusResponse {
  active: boolean;
  url: string;
  imageCount: number;
  isSupportedSite?: boolean;
}

export interface RunDiagnosticRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC;
}

export interface DiagnosticReport {
  success: boolean;
  timestamp: number;
  url: string;
  contentScript: {
    active: boolean;
    detectedImages: number;
    readyState: DocumentReadyState;
  };
  serviceWorker: {
    reachable: boolean;
    status?: string;
    version?: string;
    latencyMs?: number;
    error?: string;
  };
}

export interface TranslateActivePageRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE;
}

export interface TranslationProgressEvent {
  type: typeof EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS;
  imageId: string;
  status: 'idle' | 'translating' | 'completed' | 'failed';
  error?: string;
}

export type ExtensionRequest = PingRequest | CheckPageStatusRequest | RunDiagnosticRequest | TranslateActivePageRequest;
