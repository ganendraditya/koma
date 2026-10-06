/**
 * Koma Background Service Worker
 * Handles extension lifecycle, background tasks, and inter-process messaging.
 */

import { KOMA_VERSION } from '@core';
import { EXTENSION_MESSAGE_TYPES, PingResponse } from '@shared';
import { getRuntimeProviderConfig, handleTranslationPort } from './translation';

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

  if (message?.type === EXTENSION_MESSAGE_TYPES.GET_PROVIDER_CONFIG) {
    getRuntimeProviderConfig().then(
      (config) => sendResponse({ success: true, config }),
      () => sendResponse({ success: false, error: 'Could not load provider settings.' })
    );
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener(handleTranslationPort);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.koma_provider_settings) return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined)
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: EXTENSION_MESSAGE_TYPES.PROVIDER_SETTINGS_CHANGED,
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
    }
  });
});
