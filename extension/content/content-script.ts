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
  type ReadingSessionResponse,
  type SetOverlayVisibilityRequest,
} from '@shared';
import { ContextManager, ContextAwareProvider, type IContextManager } from '@core/context';
import { CachedTranslationProvider, KomaTranslationCache } from '@core/cache';
import { TranslationOrchestrator, type ITranslationOrchestrator } from '@core/orchestrator';
import { DOMOverlayRenderer } from '@core/renderer';
import { ExtensionTranslationProvider } from './provider';
import { resolveTargetImage } from './target-image';
import { ReaderStatusView } from './reader-status';

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
let currentChapterId: string | null = null;
let currentTargetLanguage = '';
let commandRevision = 0;
let stopWatching: (() => void) | undefined;
const readerStatus = new ReaderStatusView((action) => {
  handleContentScriptMessage({
    type:
      action === 'pause'
        ? EXTENSION_MESSAGE_TYPES.PAUSE_TRANSLATION
        : EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE,
  });
});

function notifySession(): void {
  if (!activeOrchestrator) return;
  readerStatus.update(activeOrchestrator.getSessionState());
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage(
    {
      type: EXTENSION_MESSAGE_TYPES.READING_SESSION_CHANGED,
      session: activeOrchestrator.getSessionState(),
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function disposeSession(): void {
  commandRevision++;
  stopWatching?.();
  stopWatching = undefined;
  activeOrchestrator?.dispose();
  activeProvider?.cancel();
  activeOrchestrator = null;
  activeProvider = null;
  readerStatus.remove();
}

function watchReader(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    timer = undefined;
    if (!activeOrchestrator) return;
    if (adapter.getChapterId() !== currentChapterId) {
      disposeSession();
      currentContextManager?.reset();
      currentRenderer?.removeAllOverlays();
      return;
    }
    activeOrchestrator.setPageVisible(!document.hidden);
    if (activeOrchestrator.isTranslationEnabled() && !document.hidden) {
      void activeOrchestrator.translateVisible?.();
    }
  };
  const schedule = () => {
    if (adapter.getChapterId() !== currentChapterId) {
      refresh();
      return;
    }
    if (!timer) timer = setTimeout(refresh, 50);
  };
  const visibility = () => {
    activeOrchestrator?.setPageVisible(!document.hidden);
    schedule();
  };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const navigate = (event: Event) => {
    const destination = (event as Event & { destination?: { url: string } }).destination;
    if (destination && adapter.getChapterId(destination.url) !== currentChapterId) {
      disposeSession();
      currentContextManager?.reset();
      currentRenderer?.removeAllOverlays();
    }
  };
  const stopAdapter = adapter.observeMangaImages(schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', refresh);
  document.addEventListener('visibilitychange', visibility);
  navigation?.addEventListener('navigate', navigate);
  stopWatching = () => {
    clearTimeout(timer);
    stopAdapter();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('popstate', refresh);
    document.removeEventListener('visibilitychange', visibility);
    navigation?.removeEventListener('navigate', navigate);
  };
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeSession);

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
    currentCache !== cache ||
    currentChapterId !== adapter.getChapterId()
  ) {
    if (
      (currentChapterId && currentChapterId !== adapter.getChapterId()) ||
      (currentTargetLanguage && currentTargetLanguage !== config.targetLanguage)
    )
      contextManager.reset();
    currentConfigSignature = configSignature;
    currentContextManager = contextManager;
    currentRenderer = renderer;
    currentCache = cache;
    currentChapterId = adapter.getChapterId();
    currentTargetLanguage = config.targetLanguage;

    disposeSession();

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
        removeAllOverlays: () => renderer.removeAllOverlays(),
        hasOverlay: (imageId) => renderer.hasOverlay(imageId),
      },
      {
        targetLanguage: config.targetLanguage,
        concurrencyLimit: 1,
        lookAheadCount: 2,
        prefetchEnabled: true,
      }
    );
    activeOrchestrator.setPageVisible(!document.hidden);
    watchReader();
  }

  return activeOrchestrator;
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
    disposeSession();
    return false;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
    const pageUrl = typeof window !== 'undefined' ? window.location?.href || '' : '';
    const response: CheckPageStatusResponse = {
      active: true,
      url: pageUrl,
      imageCount: adapter.detectMangaImages().length,
      isSupportedSite: adapter.matches(pageUrl),
      session: activeOrchestrator?.getSessionState(),
    };
    sendResponse?.(response);
    return true;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.PAUSE_TRANSLATION) {
    commandRevision++;
    activeOrchestrator?.setTranslationEnabled(false);
    if (!activeOrchestrator) readerStatus.remove();
    notifySession();
    sendResponse?.({
      success: true,
      session: activeOrchestrator?.getSessionState(),
    } satisfies ReadingSessionResponse);
    return false;
  }

  if (req.type === EXTENSION_MESSAGE_TYPES.SET_OVERLAY_VISIBILITY) {
    const { visible } = req as SetOverlayVisibilityRequest;
    if (typeof visible !== 'boolean') {
      sendResponse?.({ success: false, error: 'Overlay visibility must be true or false.' });
      return false;
    }
    try {
      if (activeOrchestrator) activeOrchestrator.setOverlaysVisible(visible);
      else if (!visible) renderer.removeAllOverlays();
      notifySession();
      sendResponse?.({
        success: true,
        session: activeOrchestrator?.getSessionState(),
      } satisfies ReadingSessionResponse);
    } catch {
      sendResponse?.({
        success: false,
        error: 'Could not restore overlays. Return to the translated page and try again.',
      });
    }
    return false;
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
    disposeSession();
    contextManager.reset();
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
    let revision = commandRevision;
    const chapterId = adapter.getChapterId();
    if (!activeOrchestrator) readerStatus.preparing();

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
        if (revision !== commandRevision || chapterId !== adapter.getChapterId()) {
          sendResponse?.({
            success: true,
            started: false,
            session: activeOrchestrator?.getSessionState(),
          } satisfies TranslateActivePageResponse);
          return;
        }
        if (!config.configured) {
          readerStatus.showError(`Configure ${config.name} before translating.`);
          sendResponse?.({
            success: false,
            error: `Configure ${config.name} in Provider Settings before translating.`,
          } satisfies TranslateActivePageResponse);
          return;
        }

        const orchestrator = getOrCreateOrchestrator(config, contextManager, renderer);
        revision = commandRevision;
        orchestrator.setTranslationEnabled(true);

        const notifyProgress = (event: TranslationProgressEvent) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage(event, () => {
              void chrome.runtime.lastError;
            });
          }
        };

        const eventHandler = {
          onSessionChange: notifySession,
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
        if (orchestrator === activeOrchestrator) notifySession();

        sendResponse?.({
          success: true,
          started,
          session: orchestrator.getSessionState(),
        } satisfies TranslateActivePageResponse);
      } catch (err) {
        if (revision === commandRevision && chapterId === adapter.getChapterId()) {
          readerStatus.showError(
            err instanceof Error ? err.message : 'Could not start translation.'
          );
        }
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
      if (activeOrchestrator) activeOrchestrator.setOverlaysVisible(false);
      else renderer.removeAllOverlays();
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
