/**
 * Koma Background Service Worker
 * Handles extension lifecycle, background tasks, and inter-process messaging.
 */

console.log('[Koma] Service Worker initialized');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Koma] Extension successfully installed');
});

// Listener for messages from popup or content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'OK', version: '0.1.0' });
  }
  return true;
});
