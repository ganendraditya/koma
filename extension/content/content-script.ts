/**
 * Koma Content Script
 * Injected into supported manga reader web pages to detect images and render DOM overlays.
 */

import { MangaDexAdapter } from '@adapters';
import {
  EXTENSION_MESSAGE_TYPES,
  type DiagnosticReport,
  type PingResponse,
  type CheckPageStatusResponse,
  type ResetContextResponse,
  type RenderTranslationOverlayRequest,
  type TranslateActivePageRequest,
  type TranslateActivePageResponse,
  type TranslationProgressEvent,
  type ProviderRuntimeConfig,
} from '@shared';
import { ContextManager, ContextAwareProvider, type IContextManager } from '@core/context';
import { CachedTranslationProvider, KomaTranslationCache } from '@core/cache';
import { TranslationOrchestrator, type ITranslationOrchestrator } from '@core/orchestrator';
import { DOMOverlayRenderer } from '@core/renderer';
import { ExtensionTranslationProvider } from './provider';
import { resolveTargetImage } from './target-image';

if (typeof window !== 'undefined') {
  console.log('[Koma] Content script loaded on:', window.location?.href);
}

// Session context owner for active tab / content script session
export const sessionContextManager: IContextManager = new ContextManager();
export const overlayRenderer: DOMOverlayRenderer = new DOMOverlayRenderer();
export const translationCache = new KomaTranslationCache();
const adapter = new MangaDexAdapter();

let activeOrchestrator: ITranslationOrchestrator | null = null;
let currentConfigSignature = '';
let activeProvider: ExtensionTranslationProvider | null = null;
let currentContextManager: IContextManager | null = null;
let currentRenderer: DOMOverlayRenderer | null = null;
let currentCache: KomaTranslationCache | null = null;

export function getOrCreateOrchestrator(
  config: ProviderRuntimeConfig,
  contextManager: IContextManager = sessionContextManager,
  renderer: DOMOverlayRenderer = overlayRenderer,
  cache = translationCache
): ITranslationOrchestrator {
  const configSignature = JSON.stringify([
    config.revision,
    config.id,
    config.modelName,
    config.targetLanguage,
    config.cacheIdentity,
  ]);
  if (
    !activeOrchestrator ||
    currentConfigSignature !== configSignature ||
    currentContextManager !== contextManager ||
    currentRenderer !== renderer ||
    currentCache !== cache
  ) {
    currentConfigSignature = configSignature;
    currentContextManager = contextManager;
    currentRenderer = renderer;
    currentCache = cache;

    if (activeOrchestrator) {
      activeProvider?.cancel();
      activeOrchestrator.reset();
    }

    const baseProvider = new ExtensionTranslationProvider(config);
    activeProvider = baseProvider;

    const cachedProvider = new CachedTranslationProvider(baseProvider, cache);
    const contextAwareProvider = new ContextAwareProvider(cachedProvider, contextManager);

    activeOrchestrator = new TranslationOrchestrator(
      contextAwareProvider,
      adapter,
      {
        render: (result) => {
          renderer.render(result);
        },
      },
      {
        targetLanguage: config.targetLanguage,
        concurrencyLimit: 1,
        lookAheadCount: 2,
        prefetchEnabled: true,
      }
    );
  }

  return activeOrchestrator;
}

if (import.meta.env.MODE === 'development') {
  const observe = () =>
    adapter.observeMangaImages((images) => {
      console.debug('[Koma] Detected manga images:', images.length);
    });
  let stopObserving = observe();
  window.addEventListener('pagehide', () => stopObserving());
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) stopObserving = observe();
  });
}

export function handleContentScriptMessage(
  message: unknown,
  _sender?: chrome.runtime.MessageSender,
  sendResponse?: (response: unknown) => void,
  contextManager: IContextManager = sessionContextManager,
  renderer: DOMOverlayRenderer = overlayRenderer
): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const req = message as { type?: string };

  if (req.type === EXTENSION_MESSAGE_TYPES.PROVIDER_SETTINGS_CHANGED) {
    activeProvider?.cancel();
    activeOrchestrator?.reset();
    activeOrchestrator = null;
    return false;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
    const pageUrl = typeof window !== 'undefined' ? window.location?.href || '' : '';
    const response: CheckPageStatusResponse = {
      active: true,
      url: pageUrl,
      imageCount: adapter.detectMangaImages().length,
      isSupportedSite: adapter.matches(pageUrl),
    };
    sendResponse?.(response);
    return true;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC) {
    const startTime = Date.now();

    // Ping background service worker to test content-to-worker communication
    chrome.runtime.sendMessage(
      { type: EXTENSION_MESSAGE_TYPES.PING },
      (swResponse: PingResponse | undefined) => {
        const pingDuration = Date.now() - startTime;
        let serviceWorkerStatus: DiagnosticReport['serviceWorker'];

        if (chrome.runtime.lastError) {
          serviceWorkerStatus = {
            reachable: false,
            error: chrome.runtime.lastError.message,
          };
        } else if (swResponse && swResponse.status === 'OK') {
          serviceWorkerStatus = {
            reachable: true,
            status: swResponse.status,
            version: swResponse.version,
            latencyMs: pingDuration,
          };
        } else {
          serviceWorkerStatus = {
            reachable: false,
            error: 'Unknown response from background service worker',
          };
        }

        const report: DiagnosticReport = {
          success: true,
          timestamp: Date.now(),
          url: typeof window !== 'undefined' ? window.location?.href || '' : '',
          contentScript: {
            active: true,
            detectedImages: adapter.detectMangaImages().length,
            readyState: typeof document !== 'undefined' ? document.readyState : 'complete',
          },
          serviceWorker: serviceWorkerStatus,
        };

        sendResponse?.(report);
      }
    );

    // Keep message channel open for async response
    return true;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.RESET_CONTEXT) {
    contextManager.reset();
    activeOrchestrator?.reset();
    const response: ResetContextResponse = { success: true, timestamp: Date.now() };
    sendResponse?.(response);
    return false;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE) {
    const pageUrl = typeof window !== 'undefined' ? window.location?.href || '' : '';
    if (!adapter.matches(pageUrl)) {
      sendResponse?.({
        success: false,
        error: 'Current page is not a supported reader chapter',
      } satisfies TranslateActivePageResponse);
      return false;
    }

    const translateReq = req as TranslateActivePageRequest;

    (async () => {
      try {
        const config = await new Promise<ProviderRuntimeConfig>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: EXTENSION_MESSAGE_TYPES.GET_PROVIDER_CONFIG },
            (response) => {
              if (chrome.runtime.lastError || !response?.success) {
                reject(new Error(response?.error || 'Could not load provider settings.'));
              } else resolve(response.config);
            }
          );
        });
        if (!config.configured) {
          sendResponse?.({
            success: false,
            error: `Configure ${config.name} in Provider Settings before translating.`,
          } satisfies TranslateActivePageResponse);
          return;
        }

        const orchestrator = getOrCreateOrchestrator(config, contextManager, renderer);

        const notifyProgress = (event: TranslationProgressEvent) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage(event, () => {
              void chrome.runtime.lastError;
            });
          }
        };

        const eventHandler = {
          onProgress: (state: {
            imageId: string;
            status: 'idle' | 'translating' | 'completed' | 'failed';
            error?: Error;
          }) => {
            notifyProgress({
              type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
              imageId: state.imageId,
              status: state.status,
              error: state.error?.message,
            });
          },
          onError: (imageId: string, error: Error) => {
            notifyProgress({
              type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
              imageId,
              status: 'failed',
              error: error.message,
            });
          },
          onComplete: (imageId: string) => {
            notifyProgress({
              type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
              imageId,
              status: 'completed',
            });
          },
        };

        let started = false;
        if (translateReq.retryImageId) {
          started = await orchestrator.retry(translateReq.retryImageId, eventHandler);
        } else {
          started = await orchestrator.translateNext(eventHandler);
        }

        sendResponse?.({
          success: true,
          started,
        } satisfies TranslateActivePageResponse);
      } catch (err) {
        sendResponse?.({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies TranslateActivePageResponse);
      }
    })();

    return true;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.RENDER_TRANSLATION_OVERLAY) {
    try {
      const renderReq = message as RenderTranslationOverlayRequest;
      const targetImage = resolveTargetImage(renderReq.targetSelector);
      const renderResult = renderer.render(renderReq.result, targetImage);
      sendResponse?.({
        success: true,
        imageId: renderResult.imageId,
        bubbleCount: renderResult.bubbleCount,
      });
    } catch (err) {
      sendResponse?.({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.CLEAR_ALL_OVERLAYS) {
    try {
      renderer.removeAllOverlays();
      sendResponse?.({ success: true });
    } catch (err) {
      sendResponse?.({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
}

// Listen for messages from popup or background service worker
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return handleContentScriptMessage(
      message,
      sender,
      sendResponse,
      sessionContextManager,
      overlayRenderer
    );
  });
}
