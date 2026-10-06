import type { ProviderCapabilities, TranslationRequest, TranslationResult } from '@core/contracts';
import type { ReadingSessionState } from '@core/orchestrator/types';

/**
 * Standard message types and payloads for Chrome extension inter-process communication.
 */

export const EXTENSION_MESSAGE_TYPES = {
  PING: 'PING',
  CHECK_PAGE_STATUS: 'CHECK_PAGE_STATUS',
  RUN_DIAGNOSTIC: 'RUN_DIAGNOSTIC',
  TRANSLATE_ACTIVE_PAGE: 'TRANSLATE_ACTIVE_PAGE',
  TRANSLATION_PROGRESS: 'TRANSLATION_PROGRESS',
  READING_SESSION_CHANGED: 'READING_SESSION_CHANGED',
  PAUSE_TRANSLATION: 'PAUSE_TRANSLATION',
  SET_OVERLAY_VISIBILITY: 'SET_OVERLAY_VISIBILITY',
  RESET_CONTEXT: 'RESET_CONTEXT',
  RENDER_TRANSLATION_OVERLAY: 'RENDER_TRANSLATION_OVERLAY',
  CLEAR_ALL_OVERLAYS: 'CLEAR_ALL_OVERLAYS',
  GET_PROVIDER_CONFIG: 'GET_PROVIDER_CONFIG',
  PROVIDER_SETTINGS_CHANGED: 'PROVIDER_SETTINGS_CHANGED',
  TRANSLATE_IMAGE: 'TRANSLATE_IMAGE',
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
  session?: ReadingSessionState;
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

export interface TranslateActivePageRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE;
  retryImageId?: string;
}

export interface TranslateActivePageResponse {
  success: boolean;
  error?: string;
  started?: boolean;
  session?: ReadingSessionState;
}

export interface ReadingSessionResponse {
  success: boolean;
  session?: ReadingSessionState;
  error?: string;
}

export interface PauseTranslationRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.PAUSE_TRANSLATION;
}

export interface SetOverlayVisibilityRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.SET_OVERLAY_VISIBILITY;
  visible: boolean;
}

export interface ReadingSessionChangedEvent {
  type: typeof EXTENSION_MESSAGE_TYPES.READING_SESSION_CHANGED;
  session: ReadingSessionState;
}

export interface TranslationProgressEvent {
  type: typeof EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS;
  imageId: string;
  status: 'idle' | 'translating' | 'completed' | 'failed';
  error?: string;
}

export interface RenderTranslationOverlayRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.RENDER_TRANSLATION_OVERLAY;
  result: TranslationResult;
  targetSelector: string;
}

export interface ClearAllOverlaysRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.CLEAR_ALL_OVERLAYS;
}

export interface ProviderRuntimeConfig {
  revision: number;
  id: string;
  name: string;
  modelName: string;
  cacheIdentity: string;
  targetLanguage: string;
  configured: boolean;
  capabilities: ProviderCapabilities;
}

export interface SerializedProviderError {
  code: string;
  message: string;
  providerId?: string;
  timeoutMs?: number;
  retryAfterSeconds?: number;
  reason?: 'incomplete' | 'refusal';
}

export type ProviderTranslationResponse =
  { success: true; result: TranslationResult } | { success: false; error: SerializedProviderError };

export interface ProviderTranslationRequest {
  type: typeof EXTENSION_MESSAGE_TYPES.TRANSLATE_IMAGE;
  revision: number;
  request: TranslationRequest;
}

export type ExtensionRequest =
  | PingRequest
  | CheckPageStatusRequest
  | RunDiagnosticRequest
  | ResetContextRequest
  | TranslateActivePageRequest
  | PauseTranslationRequest
  | SetOverlayVisibilityRequest
  | RenderTranslationOverlayRequest
  | ClearAllOverlaysRequest;
