/**
 * Koma Content Script
 * Injected into supported manga reader web pages to detect images and render DOM overlays.
 */

import {
  EXTENSION_MESSAGE_TYPES,
  type DiagnosticReport,
  type PingResponse,
  type CheckPageStatusResponse,
  type ResetContextResponse,
} from '@shared';
import { ContextManager, type IContextManager } from '@core/context';

if (typeof window !== 'undefined') {
  console.log('[Koma] Content script loaded on:', window.location?.href);
}

// Session context owner for active tab / content script session
export const sessionContextManager: IContextManager = new ContextManager();

export function handleContentScriptMessage(
  message: unknown,
  _sender?: chrome.runtime.MessageSender,
  sendResponse?: (response: unknown) => void,
  contextManager: IContextManager = sessionContextManager
): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const req = message as { type?: string };

  if (req.type === EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS) {
    const response: CheckPageStatusResponse = {
      active: true,
      url: typeof window !== 'undefined' ? window.location?.href || '' : '',
      imageCount: typeof document !== 'undefined' ? document.querySelectorAll('img').length : 0,
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
            detectedImages:
              typeof document !== 'undefined' ? document.querySelectorAll('img').length : 0,
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
    const response: ResetContextResponse = { success: true, timestamp: Date.now() };
    sendResponse?.(response);
    return false;
  }

  return false;
}

// Listen for messages from popup or background service worker
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return handleContentScriptMessage(message, sender, sendResponse, sessionContextManager);
  });
}
