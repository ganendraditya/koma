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
import { TranslationOrchestrator } from '@core/orchestrator';
import { SiteAdapter } from '../../adapters';
import { TranslationProvider, TranslationResult } from '@core/contracts';

console.log('[Koma] Content script loaded on:', window.location.href);

// Dummy implementations for unmerged dependencies
const dummyAdapter: SiteAdapter = {
  name: 'DummyAdapter',
  matches: () => true,
  detectMangaImages: () => {
    // Return all images on the page for demo purposes
    return Array.from(document.querySelectorAll('img')).map((img, i) => ({
      id: `dummy-img-${i}`,
      url: img.src,
      pageIndex: i,
      width: img.naturalWidth || 800,
      height: img.naturalHeight || 1200
    }));
  }
};

const dummyProvider: TranslationProvider = {
  id: 'dummy-provider',
  name: 'Dummy Provider',
  capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
  translatePage: async (req) => {
    await new Promise(r => setTimeout(r, 1000));
    return {
      pageId: 'page-1',
      imageId: req.image.id,
      sourceLanguage: 'ja',
      targetLanguage: req.targetLanguage,
      bubbles: []
    };
  }
};

const dummyRenderer = {
  render: (result: TranslationResult) => {
    console.log(`[Koma Renderer] Rendered overlay for ${result.imageId}`);
  }
};

const orchestrator = new TranslationOrchestrator(dummyProvider, dummyAdapter, dummyRenderer);

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

  if (message.type === EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE) {
    orchestrator.translateNext({
      onProgress: (state) => {
        chrome.runtime.sendMessage({
          type: EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS,
          imageId: state.imageId,
          status: state.status,
          error: state.error?.message
        });
      }
    }).catch(console.error);
    
    sendResponse({ success: true });
    return false;
  }

  return false;
});
