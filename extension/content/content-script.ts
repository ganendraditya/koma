/**
 * Koma Content Script
 * Injected into supported manga reader web pages to detect images and render DOM overlays.
 */

import {
  EXTENSION_MESSAGE_TYPES,
  type DiagnosticReport,
  type PingResponse,
  type CheckPageStatusResponse,
} from '@shared';
import { DOMOverlayRenderer } from '@core/renderer';
import { resolveTargetImage } from './target-image';

console.log('[Koma] Content script loaded on:', window.location.href);

const overlayRenderer = new DOMOverlayRenderer();

// Listen for messages from popup or background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
    const response: CheckPageStatusResponse = {
      active: true,
      url: window.location.href,
      imageCount: document.querySelectorAll('img').length,
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
            detectedImages: document.querySelectorAll('img').length,
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

  if (message.type === EXTENSION_MESSAGE_TYPES.RENDER_TRANSLATION_OVERLAY) {
    try {
      const targetImage = resolveTargetImage(message.targetSelector);
      const renderResult = overlayRenderer.render(message.result, targetImage);
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
