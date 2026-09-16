/**
 * Koma Content Script
 * Injected into supported manga reader web pages to detect images and render DOM overlays.
 */

console.log('[Koma] Content script loaded on:', window.location.href);

// Listen for messages from popup or background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_PAGE_STATUS') {
    sendResponse({
      active: true,
      url: window.location.href,
      imageCount: document.querySelectorAll('img').length,
    });
  }
  return true;
});
