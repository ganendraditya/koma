import type { ProviderCapabilities, TranslationRequest, TranslationResult } from '@core/contracts';
import type { ReadingSessionState } from '@core/orchestrator/types';
import type { DialogueEntry, GlossaryEntry, ReadingIdentity } from '@core/contracts';
import type { ReplayIdentity, ReplayRecord } from '@core/cache/replay';

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
  CONTEXT_COMMAND: 'CONTEXT_COMMAND',
  RENDER_TRANSLATION_OVERLAY: 'RENDER_TRANSLATION_OVERLAY',
  CLEAR_ALL_OVERLAYS: 'CLEAR_ALL_OVERLAYS',
  GET_PROVIDER_CONFIG: 'GET_PROVIDER_CONFIG',
  CACHE_COMMAND: 'CACHE_COMMAND',
  CACHE_CLEARED: 'CACHE_CLEARED',
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
  targetLanguage?: string;
}

export interface ResetContextResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}

export interface ContextScopeView {
  site: string;
  chapterId: string;
  seriesId?: string;
  targetLanguage: string;
}

/** Read-only snapshot of the reading context that feeds the next provider request. */
export interface ContextView {
  supported: boolean;
  scope?: ContextScopeView;
  seriesTitle?: string;
  dialogue: DialogueEntry[];
  dialogueCount: number;
  dialogueLimit: number;
  glossary: GlossaryEntry[];
  glossaryLimit: number;
}

export type ContextCommandOutcome =
  'added' | 'updated' | 'unchanged' | 'pinned' | 'unpinned' | 'removed';

export type ContextCommandOperation =
  | { operation: 'view' }
  | { operation: 'save'; original: string; translation: string; pinned: boolean }
  | { operation: 'setPinned'; original: string; pinned: boolean }
  | { operation: 'remove'; original: string };

export type ContextCommandRequest = {
  type: typeof EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND;
  targetLanguage?: string;
} & ContextCommandOperation;

export interface ContextCommandResponse {
  success: boolean;
  error?: string;
  outcome?: ContextCommandOutcome;
  view?: ContextView;
}

export const CONTEXT_TERM_MAX_LENGTH = 500;

/** Runtime guard for the discriminated context request: unknown shapes, including unknown
 * operations, are rejected instead of falling into an unintended branch. */
export function isContextCommandRequest(value: unknown): value is ContextCommandRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  if (request.type !== EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND) return false;
  if (request.targetLanguage !== undefined && typeof request.targetLanguage !== 'string')
    return false;
  const bounded = (field: unknown): field is string =>
    typeof field === 'string' && field.length > 0 && field.length <= CONTEXT_TERM_MAX_LENGTH;
  switch (request.operation) {
    case 'view':
      return true;
    case 'save':
      return (
        bounded(request.original) &&
        bounded(request.translation) &&
        typeof request.pinned === 'boolean'
      );
    case 'setPinned':
      return bounded(request.original) && typeof request.pinned === 'boolean';
    case 'remove':
      return bounded(request.original);
    default:
      return false;
  }
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
  retranslateImageId?: string;
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

export type CacheCommandRequest = {
  type: typeof EXTENSION_MESSAGE_TYPES.CACHE_COMMAND;
} & (
  | { operation: 'lookup'; identity: ReplayIdentity; revision: number }
  | { operation: 'accept'; record: ReplayRecord; generation: string; revision: number }
  | { operation: 'invalidate'; reading: ReadingIdentity; targetLanguage: string; fromPage?: number }
  | { operation: 'size' | 'clear' }
);

export type ExtensionRequest =
  | PingRequest
  | CheckPageStatusRequest
  | RunDiagnosticRequest
  | ResetContextRequest
  | ContextCommandRequest
  | TranslateActivePageRequest
  | PauseTranslationRequest
  | SetOverlayVisibilityRequest
  | CacheCommandRequest
  | RenderTranslationOverlayRequest
  | ClearAllOverlaysRequest;
