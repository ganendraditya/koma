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
  type RenderTranslationOverlayRequest,
} from '@shared';
import { TranslationOrchestrator } from '@core/orchestrator';
import { TranslationProvider, TranslationResult } from '@core/contracts';
import { DOMOverlayRenderer } from '@core/renderer';
import { resolveTargetImage } from './target-image';

console.log('[Koma] Content script loaded on:', window.location.href);

const overlayRenderer = new DOMOverlayRenderer();
const adapter = new MangaDexAdapter();

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

// TODO: Replace dummy implementations with actual system components (e.g., real TranslationProvider, Renderer) before production release.
const dummyProvider: TranslationProvider = {
  id: 'dummy-provider',
  name: 'Dummy Provider',
  capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
  translatePage: async (req) => {
    await new Promise((r) => setTimeout(r, 1000));
    return {
      pageId: 'page-1',
      imageId: req.image.id,
      sourceLanguage: 'ja',
      targetLanguage: req.targetLanguage,
      bubbles: [],
    };
  },
};

const dummyRenderer = {
  render: (result: TranslationResult) => {
    console.log(`[Koma Renderer] Rendered overlay for ${result.imageId}`);
  },
};

const orchestrator = new TranslationOrchestrator(dummyProvider, adapter, dummyRenderer);

// Listen for messages from popup or background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
    const response: CheckPageStatusResponse = {
      active: true,
      url: window.location.href,
      imageCount: adapter.detectMangaImages().length,
      isSupportedSite: adapter.matches(window.location.href),
    };
    sendResponse(response);
    return true;
  }

  if (message.type === EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC) {
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
          url: window.location.href,
          contentScript: {
            active: true,
            detectedImages: adapter.detectMangaImages().length,
            readyState: document.readyState,
          },
          serviceWorker: serviceWorkerStatus,
        };

        sendResponse(report);
      }
    );

    // Keep message channel open for async response
    return true;
  }

  if (message.type === EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE) {
    orchestrator
      .translateNext({
        onProgress: (state) => {
          chrome.runtime.sendMessage(
            {
              type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
              imageId: state.imageId,
              status: state.status,
              error: state.error?.message,
            },
            () => {
              // Ignore error if popup is closed and no listener exists
              void chrome.runtime.lastError;
            }
          );
        },
      })
      .catch(console.error);

    sendResponse({ success: true });
    return false;
  }
  if (message.type === EXTENSION_MESSAGE_TYPES.RENDER_TRANSLATION_OVERLAY) {
    try {
      const renderReq = message as RenderTranslationOverlayRequest;
      const targetImage = resolveTargetImage(renderReq.targetSelector);
      const renderResult = overlayRenderer.render(renderReq.result, targetImage);
      sendResponse({
        success: true,
        imageId: renderResult.imageId,
        bubbleCount: renderResult.bubbleCount,
      });
    } catch (err) {
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (message.type === EXTENSION_MESSAGE_TYPES.CLEAR_ALL_OVERLAYS) {
    try {
      overlayRenderer.removeAllOverlays();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
});
