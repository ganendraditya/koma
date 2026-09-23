/**
 * Koma Popup Logic
 * Handles control surface, diagnostics, and provider settings.
 */

import { getStoredGeminiConfig, saveStoredGeminiConfig } from '@providers/gemini/storage';
import {
  EXTENSION_MESSAGE_TYPES,
  CheckPageStatusResponse,
  DiagnosticReport,
  ResetContextResponse,
} from '@shared/messages';

document.addEventListener('DOMContentLoaded', async () => {
  // Elements - Status
  const statusEl = document.getElementById('status-text') as HTMLElement;
  const siteEl = document.getElementById('site-text') as HTMLElement;
  const imageCountEl = document.getElementById('image-count-text') as HTMLElement;
  const apiIndicatorEl = document.getElementById('api-indicator') as HTMLElement;

  // Elements - Actions
  const translateBtn = document.getElementById('btn-translate') as HTMLButtonElement;
  const diagnosticBtn = document.getElementById('btn-diagnostic') as HTMLButtonElement;

  // Elements - Diagnostics
  const diagBox = document.getElementById('diagnostic-box') as HTMLElement;
  const diagTimeEl = document.getElementById('diagnostic-time') as HTMLElement;
  const diagCsStatus = document.getElementById('diag-cs-status') as HTMLElement;
  const diagSwStatus = document.getElementById('diag-sw-status') as HTMLElement;
  const diagImgCount = document.getElementById('diag-img-count') as HTMLElement;

  // Elements - Settings
  const toggleSettingsBtn = document.getElementById('btn-toggle-settings') as HTMLButtonElement;
  const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
  const settingsChevron = document.getElementById('settings-chevron') as HTMLElement;
  const apiKeyInput = document.getElementById('input-api-key') as HTMLInputElement;
  const toggleKeyVisibilityBtn = document.getElementById(
    'btn-toggle-key-visibility'
  ) as HTMLButtonElement;
  const targetLangSelect = document.getElementById('select-target-lang') as HTMLSelectElement;
  const modelSelect = document.getElementById('select-model') as HTMLSelectElement;
  const saveSettingsBtn = document.getElementById('btn-save-settings') as HTMLButtonElement;
  const resetContextBtn = document.getElementById('btn-reset-context') as HTMLButtonElement;
  const feedbackEl = document.getElementById('settings-feedback') as HTMLElement;

  let activeTabId: number | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function showFeedback(text: string, type: 'success' | 'error', duration = 2500): void {
    if (!feedbackEl) {
      return;
    }
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = undefined;
    }
    feedbackEl.className = `feedback-msg ${type}`;
    feedbackEl.textContent = text;
    if (duration > 0) {
      feedbackTimer = setTimeout(() => {
        feedbackEl.className = 'feedback-msg';
        feedbackEl.textContent = '';
        feedbackTimer = undefined;
      }, duration);
    }
  }

  function updateKeyIndicator(hasKey: boolean) {
    if (!apiIndicatorEl) return;
    if (hasKey) {
      apiIndicatorEl.textContent = 'Key Configured';
      apiIndicatorEl.className = 'pill pill-success';
    } else {
      apiIndicatorEl.textContent = 'Key Required';
      apiIndicatorEl.className = 'pill pill-warning';
    }
  }

  // 1. Initialize Settings
  try {
    const config = await getStoredGeminiConfig();
    if (apiKeyInput) apiKeyInput.value = config.apiKey || '';
    if (targetLangSelect) targetLangSelect.value = config.targetLanguage || 'id';
    if (modelSelect) modelSelect.value = config.modelName || 'gemini-3.5-flash-lite';
    updateKeyIndicator(Boolean(config.apiKey?.trim()));
  } catch (error) {
    console.error('[Koma] Failed to load provider settings:', error);
  }

  // 2. Query Active Tab & Probe Content Script
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        activeTabId = tab.id;

        if (tab.url && siteEl) {
          try {
            const parsed = new URL(tab.url);
            siteEl.textContent = parsed.hostname;
          } catch {
            siteEl.textContent = tab.url.slice(0, 30);
          }
        }

        // Send status check to content script
        chrome.tabs.sendMessage(
          tab.id,
          { type: EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS },
          (response: CheckPageStatusResponse | undefined) => {
            if (chrome.runtime.lastError || !response) {
              if (statusEl) statusEl.textContent = 'Not active on page';
              if (imageCountEl) imageCountEl.textContent = 'N/A';
            } else {
              if (statusEl) statusEl.textContent = 'Ready';
              if (imageCountEl) imageCountEl.textContent = `${response.imageCount} detected`;
            }
          }
        );
      } else {
        if (statusEl) statusEl.textContent = 'No active tab';
      }
    } else {
      if (statusEl) statusEl.textContent = 'Dev Mode (No Chrome)';
    }
  } catch (error) {
    console.error('[Koma] Failed to query active tab:', error);
    if (statusEl) statusEl.textContent = 'Tab query failed';
  }

  // 3. Diagnostics Action
  diagnosticBtn?.addEventListener('click', () => {
    diagBox.classList.add('visible');
    diagTimeEl.textContent = new Date().toLocaleTimeString();
    diagCsStatus.textContent = 'Querying content script...';
    diagCsStatus.style.color = 'var(--text-secondary)';
    diagSwStatus.textContent = 'Querying background worker...';
    diagSwStatus.style.color = 'var(--text-secondary)';
    diagImgCount.textContent = '...';

    if (!activeTabId) {
      diagCsStatus.textContent = 'No active tab accessible';
      diagCsStatus.style.color = 'var(--danger)';
      diagSwStatus.textContent = 'Skipped (no tab)';
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC },
      (report: DiagnosticReport | undefined) => {
        if (chrome.runtime.lastError || !report) {
          const errMsg = chrome.runtime.lastError?.message || 'Content script unreachable';
          diagCsStatus.textContent = `Unreachable (${errMsg})`;
          diagCsStatus.style.color = 'var(--danger)';
          diagSwStatus.textContent = 'Cannot probe via content script';
          diagSwStatus.style.color = 'var(--text-muted)';
          diagImgCount.textContent = '0';
        } else {
          diagCsStatus.textContent = 'Connected & Active';
          diagCsStatus.style.color = 'var(--success)';

          if (report.serviceWorker.reachable) {
            const latency = report.serviceWorker.latencyMs ?? 0;
            diagSwStatus.textContent = `Connected (${latency}ms, v${report.serviceWorker.version || '0.1.0'})`;
            diagSwStatus.style.color = 'var(--success)';
          } else {
            diagSwStatus.textContent = `Unreachable (${report.serviceWorker.error || 'error'})`;
            diagSwStatus.style.color = 'var(--danger)';
          }

          diagImgCount.textContent = `${report.contentScript.detectedImages} images`;
          diagImgCount.style.color = 'var(--text-primary)';
          if (imageCountEl) {
            imageCountEl.textContent = `${report.contentScript.detectedImages} detected`;
          }
        }
      }
    );
  });

  // 4. Translate Button Action
  translateBtn?.addEventListener('click', async () => {
    const config = await getStoredGeminiConfig();
    if (!config.apiKey?.trim()) {
      settingsPanel.classList.add('open');
      settingsChevron.textContent = '▴';
      showFeedback('Please configure your Gemini API Key below.', 'error');
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Translating...';
    }

    if (activeTabId) {
      chrome.tabs.sendMessage(
        activeTabId,
        { type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE },
        () => {
          // Future pipeline orchestrator will report progress
        }
      );
    }
  });

  // 5. Settings Toggle
  toggleSettingsBtn?.addEventListener('click', () => {
    const isOpen = settingsPanel.classList.toggle('open');
    settingsChevron.textContent = isOpen ? '▴' : '▾';
  });

  // 6. Toggle Key Visibility
  toggleKeyVisibilityBtn?.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = 'Show';
    }
  });

  // 7. Save Settings
  saveSettingsBtn?.addEventListener('click', async () => {
    try {
      const apiKey = apiKeyInput.value.trim();
      const targetLanguage = targetLangSelect.value;
      const modelName = modelSelect.value;

      await saveStoredGeminiConfig({
        apiKey,
        targetLanguage,
        modelName,
      });

      updateKeyIndicator(Boolean(apiKey));
      showFeedback('Settings saved successfully!', 'success');
    } catch (error) {
      showFeedback(
        `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    }
  });

  // 8. Reset Context Action
  resetContextBtn?.addEventListener('click', () => {
    if (!activeTabId) {
      showFeedback('No active page to reset context.', 'error');
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      { type: EXTENSION_MESSAGE_TYPES.RESET_CONTEXT },
      (response: ResetContextResponse | undefined) => {
        if (chrome.runtime.lastError || !response?.success) {
          showFeedback('Failed to reset page context.', 'error');
        } else {
          showFeedback('Context memory reset successfully.', 'success');
        }
      }
    );
  });
});
