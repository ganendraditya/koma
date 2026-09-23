import type { TranslationResult } from '@core/contracts';

/**
 * Standard message types and payloads for Chrome extension inter-process communication.
 */

export const EXTENSION_MESSAGE_TYPES = {
  PING: 'PING',
  CHECK_PAGE_STATUS: 'CHECK_PAGE_STATUS',
  RUN_DIAGNOSTIC: 'RUN_DIAGNOSTIC',
  TRANSLATE_ACTIVE_PAGE: 'TRANSLATE_ACTIVE_PAGE',
  RESET_CONTEXT: 'RESET_CONTEXT',
  RENDER_TRANSLATION_OVERLAY: 'RENDER_TRANSLATION_OVERLAY',
  CLEAR_ALL_OVERLAYS: 'CLEAR_ALL_OVERLAYS',
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

export interface ResetContextRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.RESET_CONTEXT;
}

export interface ResetContextResponse {
  success: boolean;
  timestamp: number;
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

export interface RenderTranslationOverlayRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.RENDER_TRANSLATION_OVERLAY;
  result: TranslationResult;
  targetSelector: string;
}

export interface ClearAllOverlaysRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.CLEAR_ALL_OVERLAYS;
}

export type ExtensionRequest =
  | PingRequest
  | CheckPageStatusRequest
  | RunDiagnosticRequest
  | ResetContextRequest
  | RenderTranslationOverlayRequest
  | ClearAllOverlaysRequest;
