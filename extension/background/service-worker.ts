/**
 * Koma Background Service Worker
 * Handles extension lifecycle, background tasks, and inter-process messaging.
 */

import { KOMA_VERSION } from '@core';
import { EXTENSION_MESSAGE_TYPES, PingResponse } from '@shared';

console.log(`[Koma] Service Worker initialized (v${KOMA_VERSION})`);

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[Koma] Extension installed / updated (reason: ${details.reason})`);
});

// Listener for messages from popup or content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === EXTENSION_MESSAGE_TYPES.PING) {
    const response: PingResponse = {
      status: 'OK',
      version: KOMA_VERSION,
      timestamp: Date.now(),
    };
    sendResponse(response);
    return true;
  }

  return false;
});
