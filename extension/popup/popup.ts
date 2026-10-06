import {
  getProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from '../settings/storage';
import { normalizeBaseUrl, type ProviderConfig, type ProviderId } from '@providers/config';
import { supportedReasoningEfforts } from '@providers/openai/models';
import { SUPPORTED_GEMINI_MODELS } from '@providers/gemini/types';
import {
  EXTENSION_MESSAGE_TYPES,
  CheckPageStatusResponse,
  DiagnosticReport,
  ResetContextResponse,
  ReadingSessionResponse,
} from '@shared/messages';
import type { ReadingSessionState } from '@core/orchestrator/types';

export async function initializePopup(root: Document = globalThis.document): Promise<void> {
  const document = root;
  const statusEl = document.getElementById('status-text') as HTMLElement;
  const siteEl = document.getElementById('site-text') as HTMLElement;
  const imageCountEl = document.getElementById('image-count-text') as HTMLElement;
  const apiIndicatorEl = document.getElementById('api-indicator') as HTMLElement;

  const translateBtn = document.getElementById('btn-translate') as HTMLButtonElement;
  const diagnosticBtn = document.getElementById('btn-diagnostic') as HTMLButtonElement;
  const pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;
  const overlaysBtn = document.getElementById('btn-overlays') as HTMLButtonElement;
  const sessionEl = document.getElementById('session-status') as HTMLElement;

  const diagBox = document.getElementById('diagnostic-box') as HTMLElement;
  const diagTimeEl = document.getElementById('diagnostic-time') as HTMLElement;
  const diagCsStatus = document.getElementById('diag-cs-status') as HTMLElement;
  const diagSwStatus = document.getElementById('diag-sw-status') as HTMLElement;
  const diagImgCount = document.getElementById('diag-img-count') as HTMLElement;

  const toggleSettingsBtn = document.getElementById('btn-toggle-settings') as HTMLButtonElement;
  const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
  const settingsChevron = document.getElementById('settings-chevron') as HTMLElement;
  const apiKeyInput = document.getElementById('input-api-key') as HTMLInputElement;
  const providerSelect = document.getElementById('select-provider') as HTMLSelectElement;
  const keyLabel = document.getElementById('api-key-label') as HTMLLabelElement;
  const baseUrlInput = document.getElementById('input-base-url') as HTMLInputElement;
  const customEndpointFields = document.getElementById('custom-endpoint-fields') as HTMLElement;
  const apiFormatSelect = document.getElementById('select-api-format') as HTMLSelectElement;
  const responseFormatSelect = document.getElementById(
    'select-response-format'
  ) as HTMLSelectElement;
  const reasoningSelect = document.getElementById('select-reasoning') as HTMLSelectElement;
  const reasoningFields = document.getElementById('reasoning-fields') as HTMLElement;
  const reasoningHelp = document.getElementById('reasoning-help') as HTMLElement;
  const rememberKeyInput = document.getElementById('remember-key') as HTMLInputElement;
  const modelSuggestions = document.getElementById('model-suggestions') as HTMLDataListElement;
  const destinationEl = document.getElementById('provider-destination') as HTMLElement;
  const toggleKeyVisibilityBtn = document.getElementById(
    'btn-toggle-key-visibility'
  ) as HTMLButtonElement;
  const targetLangSelect = document.getElementById('select-target-lang') as HTMLSelectElement;
  const modelInput = document.getElementById('input-model') as HTMLInputElement;
  const saveSettingsBtn = document.getElementById('btn-save-settings') as HTMLButtonElement;
  const resetContextBtn = document.getElementById('btn-reset-context') as HTMLButtonElement;
  const feedbackEl = document.getElementById('settings-feedback') as HTMLElement;

  let activeTabId: number | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let settings: ProviderSettings | undefined;
  let selectedProvider: ProviderId = 'gemini';
  const editedProviders = new Set<ProviderId>();
  let supported = false;
  let session: ReadingSessionState | undefined;

  function applySession(state?: ReadingSessionState): void {
    session = state;
    translateBtn.disabled = !supported;
    translateBtn.textContent =
      state?.status === 'paused' ? 'Resume' : state?.error ? 'Retry Visible Page' : 'Translate';
    if (pauseBtn)
      pauseBtn.disabled =
        !supported || !state || state.status === 'idle' || state.status === 'paused';
    if (overlaysBtn) {
      overlaysBtn.disabled = !supported || !state?.acceptedCount;
      overlaysBtn.textContent =
        state?.overlaysVisible === false ? 'Show Overlays' : 'Hide Overlays';
      overlaysBtn.setAttribute('aria-pressed', String(state?.overlaysVisible === false));
    }
    if (!sessionEl) return;
    sessionEl.textContent = !supported
      ? 'Open a supported MangaDex chapter to translate.'
      : !state || state.status === 'idle'
        ? 'Translate the visible page and up to two upcoming pages.'
        : state.status === 'paused'
          ? 'Paused. Resume to continue; accepted translations are kept.'
          : state.cooldownUntil
            ? `Rate limited. Requests wait until ${new Date(state.cooldownUntil).toLocaleTimeString()}. Retry the failed page when ready.`
            : state.error
              ? `${state.error} Use Retry Visible Page to try again.`
              : state.status === 'active'
                ? `Translating. ${state.acceptedCount} pages ready.`
                : `${state.acceptedCount} pages ready. Scroll to continue.`;
  }

  function sessionCommand(message: object): void {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(
      activeTabId,
      message,
      (response: ReadingSessionResponse | undefined) => {
        if (chrome.runtime.lastError || !response?.success) {
          if (sessionEl)
            sessionEl.textContent =
              response?.error || 'Could not reach the reader. Reload the chapter and try again.';
        } else applySession(response.session);
      }
    );
  }

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

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab?.id !== undefined && sender.tab.id !== activeTabId) return;
    if (message.type === EXTENSION_MESSAGE_TYPES.READING_SESSION_CHANGED)
      applySession(message.session);
    if (message.type === EXTENSION_MESSAGE_TYPES.TRANSLATION_PROGRESS) {
      if (statusEl) {
        statusEl.textContent = `Image ${message.imageId}: ${message.status}`;
        if (message.error) {
          statusEl.textContent += ` (Error: ${message.error})`;
          statusEl.style.color = 'var(--danger)';
        } else if (message.status === 'completed') {
          statusEl.style.color = 'var(--success)';
        } else {
          statusEl.style.color = 'var(--text-primary)';
        }
      }
    }
  });

  function updateKeyIndicator(hasKey: boolean, keyOptional = false) {
    if (!apiIndicatorEl) return;
    if (hasKey || keyOptional) {
      apiIndicatorEl.textContent = hasKey ? 'Key Configured' : 'No key supplied';
      apiIndicatorEl.className = 'pill pill-success';
    } else {
      apiIndicatorEl.textContent = 'Key Required';
      apiIndicatorEl.className = 'pill pill-warning';
    }
  }

  function openSettings(): void {
    settingsPanel.classList.add('open');
    settingsChevron.textContent = '▴';
    toggleSettingsBtn.setAttribute('aria-expanded', 'true');
  }

  function readProfile(): ProviderConfig {
    return {
      ...settings!.profiles[selectedProvider],
      apiKey: apiKeyInput.value.trim(),
      modelName: modelInput.value.trim(),
      baseUrl:
        selectedProvider === 'openai-compatible'
          ? baseUrlInput.value.trim()
          : settings!.profiles[selectedProvider].baseUrl,
      apiFormat: apiFormatSelect.value as ProviderConfig['apiFormat'],
      responseFormat: responseFormatSelect.value as ProviderConfig['responseFormat'],
      reasoningEffort: reasoningSelect.value as ProviderConfig['reasoningEffort'],
      rememberKey: rememberKeyInput.checked,
    };
  }

  function updateReasoningOptions(): void {
    const supported =
      selectedProvider === 'openai'
        ? supportedReasoningEfforts(modelInput.value.trim())
        : undefined;
    for (const option of reasoningSelect.options) {
      option.disabled =
        option.value !== 'auto' &&
        Boolean(
          supported &&
          !supported.includes(option.value as Exclude<ProviderConfig['reasoningEffort'], 'auto'>)
        );
    }
    if (reasoningSelect.selectedOptions[0]?.disabled) reasoningSelect.value = 'auto';
    reasoningHelp.textContent =
      selectedProvider === 'openai-compatible'
        ? 'Auto sends no reasoning control. Explicit efforts require endpoint support. Reasoning text is never rendered.'
        : supported?.length
          ? 'Auto uses Low for this model. Higher effort can take longer and use more tokens.'
          : 'Auto uses the model’s own settings. Choose a vision-capable model; reasoning controls vary by model.';
  }

  function showProfile(): void {
    const profile = settings!.profiles[selectedProvider];
    providerSelect.value = selectedProvider;
    apiKeyInput.value = profile.apiKey;
    apiKeyInput.type = 'password';
    toggleKeyVisibilityBtn.textContent = 'Show';
    keyLabel.textContent =
      selectedProvider === 'gemini'
        ? 'Gemini API key'
        : selectedProvider === 'openai'
          ? 'OpenAI API key'
          : 'API key (optional for local servers)';
    apiKeyInput.placeholder = 'Your provider API key';
    modelInput.value = profile.modelName;
    modelInput.placeholder = selectedProvider === 'openai-compatible' ? 'Your vision model ID' : '';
    baseUrlInput.value = profile.baseUrl;
    apiFormatSelect.value = profile.apiFormat;
    responseFormatSelect.value = profile.responseFormat;
    reasoningSelect.value = profile.reasoningEffort;
    rememberKeyInput.checked = profile.rememberKey;
    customEndpointFields.hidden = selectedProvider !== 'openai-compatible';
    reasoningFields.hidden = selectedProvider === 'gemini';
    modelSuggestions.replaceChildren();
    const models =
      selectedProvider === 'gemini'
        ? SUPPORTED_GEMINI_MODELS
        : selectedProvider === 'openai'
          ? ['gpt-4.1-mini', 'gpt-5-mini', 'o4-mini']
          : [];
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      modelSuggestions.append(option);
    }
    destinationEl.textContent =
      selectedProvider === 'gemini'
        ? 'Manga images and recent dialogue are sent directly to Google Gemini.'
        : selectedProvider === 'openai'
          ? 'Manga images and recent dialogue are sent directly to OpenAI.'
          : 'Manga images and recent dialogue are sent directly to the endpoint you configure.';
    updateReasoningOptions();
  }

  try {
    settings = await getProviderSettings();
    selectedProvider = settings.provider;
    targetLangSelect.value = settings.targetLanguage;
    showProfile();
    updateKeyIndicator(
      Boolean(settings.profiles[selectedProvider].apiKey),
      selectedProvider === 'openai-compatible'
    );
  } catch (error) {
    showFeedback(
      `Could not load settings: ${error instanceof Error ? error.message : 'Storage unavailable'}`,
      'error',
      0
    );
    saveSettingsBtn.disabled = true;
  }

  providerSelect.addEventListener('change', () => {
    if (!settings) return;
    const profile = readProfile();
    const previousProfile = settings.profiles[selectedProvider];
    if (
      Object.entries(profile).some(
        ([key, value]) => value !== previousProfile[key as keyof ProviderConfig]
      )
    ) {
      editedProviders.add(selectedProvider);
    }
    settings.profiles[selectedProvider] = profile;
    selectedProvider = providerSelect.value as ProviderId;
    showProfile();
  });
  modelInput.addEventListener('input', updateReasoningOptions);

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

        chrome.tabs.sendMessage(
          tab.id,
          { type: EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS },
          (response: CheckPageStatusResponse | undefined) => {
            if (chrome.runtime.lastError || !response) {
              if (statusEl) statusEl.textContent = 'Not active on page';
              if (imageCountEl) imageCountEl.textContent = 'N/A';
              applySession();
            } else {
              if (statusEl) statusEl.textContent = 'Ready';
              if (imageCountEl) imageCountEl.textContent = `${response.imageCount} detected`;
              supported = response.isSupportedSite === true;
              applySession(response.session);
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

  translateBtn?.addEventListener('click', async () => {
    try {
      const saved = await getProviderSettings();
      const config = saved.profiles[saved.provider];
      if (
        !config.modelName ||
        !config.baseUrl ||
        (!config.apiKey && saved.provider !== 'openai-compatible')
      ) {
        openSettings();
        showFeedback(
          'Configure your selected provider and save settings before translating.',
          'error',
          0
        );
        return;
      }
    } catch {
      showFeedback('Could not load provider settings. Retry saving them.', 'error', 0);
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Translating...';
      statusEl.style.color = 'var(--text-primary)';
    }

    if (activeTabId) {
      chrome.tabs.sendMessage(
        activeTabId,
        { type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE },
        (
          response:
            | {
                success?: boolean;
                error?: string;
                started?: boolean;
                session?: ReadingSessionState;
              }
            | undefined
        ) => {
          if (chrome.runtime.lastError || !response?.success) {
            const err =
              chrome.runtime.lastError?.message || response?.error || 'Translation failed to start';
            if (statusEl) {
              statusEl.textContent = `Error: ${err}`;
              statusEl.style.color = 'var(--danger)';
            }
          } else {
            applySession(response.session);
            if (!response.started && response.session?.status !== 'paused') {
              if (statusEl) {
                statusEl.textContent = 'No images pending translation';
                statusEl.style.color = 'var(--text-secondary)';
              }
            }
          }
        }
      );
    }
  });

  pauseBtn?.addEventListener('click', () =>
    sessionCommand({ type: EXTENSION_MESSAGE_TYPES.PAUSE_TRANSLATION })
  );
  overlaysBtn?.addEventListener('click', () =>
    sessionCommand({
      type: EXTENSION_MESSAGE_TYPES.SET_OVERLAY_VISIBILITY,
      visible: session?.overlaysVisible === false,
    })
  );

  toggleSettingsBtn?.addEventListener('click', () => {
    const isOpen = settingsPanel.classList.toggle('open');
    settingsChevron.textContent = isOpen ? '▴' : '▾';
    toggleSettingsBtn.setAttribute('aria-expanded', String(isOpen));
  });

  toggleKeyVisibilityBtn?.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = 'Show';
    }
  });

  saveSettingsBtn?.addEventListener('click', async () => {
    if (!settings) return;
    saveSettingsBtn.disabled = true;
    showFeedback('Saving provider settings...', 'success', 0);
    try {
      const profile = readProfile();
      const drafts = [...editedProviders]
        .filter((id) => id !== profile.provider)
        .map((id) => settings!.profiles[id]);
      const customProfile = [profile, ...drafts].find(
        (draft) => draft.provider === 'openai-compatible'
      );
      if (customProfile) {
        const url = new URL(normalizeBaseUrl(customProfile.baseUrl));
        // Request inside the click handler, before awaiting storage, to preserve the user gesture.
        const granted = await chrome.permissions.request({
          origins: [`${url.protocol}//${url.hostname}/*`],
        });
        if (!granted)
          throw new Error('Endpoint access was not granted. Save again to allow access.');
      }
      settings = await saveProviderSettings(profile, targetLangSelect.value, drafts);
      editedProviders.clear();
      showProfile();
      updateKeyIndicator(Boolean(profile.apiKey), selectedProvider === 'openai-compatible');
      showFeedback('Provider settings saved.', 'success');
      applySession();
    } catch (error) {
      showFeedback(
        `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      saveSettingsBtn.disabled = false;
    }
  });

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
}

document.addEventListener('DOMContentLoaded', () => {
  void initializePopup();
});
