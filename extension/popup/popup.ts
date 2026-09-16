/**
 * Koma Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status-text');
  const siteEl = document.getElementById('site-text');
  const translateBtn = document.getElementById('btn-translate') as HTMLButtonElement;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && siteEl) {
      const url = new URL(tab.url);
      siteEl.textContent = url.hostname;
    }
  } catch (error) {
    console.error('Failed to get active tab:', error);
  }

  translateBtn?.addEventListener('click', () => {
    if (statusEl) {
      statusEl.textContent = 'Translating...';
    }
  });
});
