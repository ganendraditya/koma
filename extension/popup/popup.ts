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
  type ContextCommandOperation,
  type ContextCommandOutcome,
  type ContextCommandResponse,
  type ContextView,
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
  const clearCacheBtn = document.getElementById('btn-clear-cache') as HTMLButtonElement;
  const retranslateBtn = document.getElementById('btn-retranslate') as HTMLButtonElement;
  const cacheFeedback = document.getElementById('cache-feedback') as HTMLElement;
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

  const toggleContextBtn = document.getElementById('btn-toggle-context') as HTMLButtonElement;
  const contextPanel = document.getElementById('context-panel') as HTMLElement;
  const contextChevron = document.getElementById('context-chevron') as HTMLElement;
  const contextStatus = document.getElementById('context-status') as HTMLElement;
  const contextScope = document.getElementById('context-scope') as HTMLElement;
  const contextSeries = document.getElementById('context-series') as HTMLElement;
  const contextChapter = document.getElementById('context-chapter') as HTMLElement;
  const contextLanguage = document.getElementById('context-language') as HTMLElement;
  const contextDialogueCount = document.getElementById('context-dialogue-count') as HTMLElement;
  const contextDialogueSection = document.getElementById('context-dialogue-section') as HTMLElement;
  const contextDialogueList = document.getElementById('context-dialogue-list') as HTMLElement;
  const contextGlossarySection = document.getElementById('context-glossary-section') as HTMLElement;
  const contextGlossaryList = document.getElementById('context-glossary-list') as HTMLElement;
  const contextForm = document.getElementById('context-term-form') as HTMLFormElement;
  const contextOriginal = document.getElementById('context-original') as HTMLInputElement;
  const contextTranslation = document.getElementById('context-translation') as HTMLInputElement;
  const contextPin = document.getElementById('context-pin') as HTMLInputElement;
  const saveTermBtn = document.getElementById('btn-save-term') as HTMLButtonElement;
  const cancelTermBtn = document.getElementById('btn-cancel-term') as HTMLButtonElement;
  const contextEditNote = document.getElementById('context-edit-note') as HTMLElement;
  const contextFeedback = document.getElementById('context-feedback') as HTMLElement;

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
    if (retranslateBtn) retranslateBtn.disabled = !supported;
    translateBtn.textContent =
      state?.status === 'paused' ? 'Resume' : state?.error ? 'Retry Pages' : 'Translate';
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
            ? `Rate limited. Requests wait until ${new Date(state.cooldownUntil).toLocaleTimeString()}. Retry failed pages when ready.`
            : state.error
              ? `${state.error} Use Retry Pages to retry failures in the current reading window.`
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

  retranslateBtn?.addEventListener('click', () => {
    if (
      !window.confirm(
        'Send a new provider request for the visible page? This may incur provider cost. Other visible translations will be kept.'
      )
    )
      return;
    sessionCommand({
      type: EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE,
      retranslateImageId: 'visible',
    });
  });

  clearCacheBtn?.addEventListener('click', () => {
    if (
      !window.confirm(
        'Clear all Koma translation cache? Glossary, reading context, provider settings, and visible overlays will be kept. Active work will pause.'
      )
    )
      return;
    clearCacheBtn.disabled = true;
    cacheFeedback.textContent = 'Clearing translation cache...';
    chrome.runtime.sendMessage(
      { type: EXTENSION_MESSAGE_TYPES.CACHE_COMMAND, operation: 'clear' },
      (response) => {
        clearCacheBtn.disabled = false;
        cacheFeedback.textContent =
          chrome.runtime.lastError || !response?.success
            ? 'Could not clear translation cache. Work is paused; try again.'
            : 'Translation cache cleared. Visible translations are kept. Resume or retranslate explicitly to continue.';
      }
    );
  });

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
          // A newly accepted page changes the dialogue the next request will carry.
          if (contextPanel?.classList.contains('open')) loadContext();
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
              loadContext();
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

  const LANGUAGE_LABELS: Record<string, string> = {
    id: 'Indonesian (Bahasa Indonesia)',
    en: 'English',
  };

  const OUTCOME_COPY: Record<ContextCommandOutcome, string> = {
    added: 'Term added.',
    updated: 'Updated existing term.',
    unchanged: 'No changes to save.',
    pinned: 'Term pinned.',
    unpinned: 'Term unpinned.',
    removed: 'Term removed.',
  };

  let contextFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  // Responses from superseded commands must not render over the newest view.
  let contextRequestToken = 0;
  // An explicit edit keeps the term key fixed; renaming goes through Remove and Add.
  let editingKey: string | undefined;
  let contextWithinChapter = false;

  function refreshInputState(): void {
    const locked = !contextWithinChapter || editingKey !== undefined;
    contextOriginal.disabled = locked;
    contextTranslation.disabled = !contextWithinChapter;
    contextPin.disabled = !contextWithinChapter;
    cancelTermBtn.hidden = editingKey === undefined;
    contextEditNote.hidden = editingKey === undefined;
    updateSaveState();
  }

  function showContextFeedback(text: string, type: 'success' | 'error', duration = 6000): void {
    if (!contextFeedback) return;
    if (contextFeedbackTimer) clearTimeout(contextFeedbackTimer);
    contextFeedback.className = `feedback-msg ${type}`;
    contextFeedback.textContent = text;
    if (duration > 0) {
      contextFeedbackTimer = setTimeout(() => {
        contextFeedback.className = 'feedback-msg';
        contextFeedback.textContent = '';
      }, duration);
    }
  }

  function setContextNote(text: string): void {
    if (!contextStatus) return;
    contextStatus.hidden = !text;
    contextStatus.textContent = text;
  }

  function contextCommand(
    operation: ContextCommandOperation,
    onDone: (response: ContextCommandResponse) => void
  ): void {
    if (!activeTabId) return;
    const token = ++contextRequestToken;
    chrome.tabs.sendMessage(
      activeTabId,
      {
        type: EXTENSION_MESSAGE_TYPES.CONTEXT_COMMAND,
        targetLanguage: settings?.targetLanguage || targetLangSelect.value,
        ...operation,
      },
      (response: ContextCommandResponse | undefined) => {
        // A newer command already rendered; only a failed action still owes the user feedback.
        if (token !== contextRequestToken) {
          if (response && !response.success)
            showContextFeedback(
              response.error ?? 'Could not update the glossary. Try again.',
              'error'
            );
          return;
        }
        if (chrome.runtime.lastError || !response) {
          onDone({
            success: false,
            error: 'Could not reach the reader. Reload the chapter and try again.',
          });
          return;
        }
        onDone(response);
      }
    );
  }

  function renderContext(view: ContextView | undefined): void {
    if (!view) return;
    const inChapter = view.supported && Boolean(view.scope);
    contextScope.hidden = !inChapter;
    contextWithinChapter = inChapter;
    if (!inChapter) {
      // Leaving a supported chapter invalidates any in-progress edit.
      contextForm.reset();
      editingKey = undefined;
    }
    refreshInputState();

    if (!view.supported) {
      setContextNote('Open a supported MangaDex chapter to see its reading context.');
      contextDialogueSection.hidden = true;
      contextGlossarySection.hidden = true;
      updateSaveState();
      return;
    }

    contextSeries.textContent = view.seriesTitle || view.scope?.seriesId || 'Not identified';
    contextChapter.textContent = view.scope?.chapterId ?? '-';
    contextLanguage.textContent =
      LANGUAGE_LABELS[view.scope?.targetLanguage ?? ''] ?? view.scope?.targetLanguage ?? '-';
    contextDialogueCount.textContent = `${view.dialogueCount} of ${view.dialogueLimit} kept`;

    contextDialogueSection.hidden = view.dialogue.length === 0;
    contextDialogueList.replaceChildren(
      ...view.dialogue.map((entry) => {
        const row = document.createElement('li');
        row.className = 'context-row';
        const text = document.createElement('p');
        text.className = 'context-text';
        if (entry.sourceText) {
          const source = document.createElement('span');
          source.className = 'context-term';
          source.textContent = entry.sourceText;
          const arrow = document.createElement('span');
          arrow.className = 'context-arrow';
          arrow.textContent = '→';
          text.append(source, arrow);
        }
        const translated = document.createElement('span');
        translated.textContent = entry.translatedText;
        text.append(translated);
        row.append(text);

        const details = [
          entry.speaker,
          typeof entry.pageIndex === 'number' ? `Page ${entry.pageIndex + 1}` : '',
        ].filter(Boolean);
        if (details.length) {
          const detail = document.createElement('p');
          detail.className = 'context-detail';
          detail.textContent = details.join(' · ');
          row.append(detail);
        }
        return row;
      })
    );

    contextGlossarySection.hidden = view.glossary.length === 0;
    contextGlossaryList.replaceChildren(
      ...view.glossary.map((entry) => {
        const row = document.createElement('li');
        row.className = 'context-row';

        const text = document.createElement('p');
        text.className = 'context-text';
        const original = document.createElement('span');
        original.className = 'context-term';
        original.textContent = entry.original;
        const arrow = document.createElement('span');
        arrow.className = 'context-arrow';
        arrow.textContent = '→';
        const translation = document.createElement('span');
        translation.textContent = entry.translation;
        text.append(original, arrow, translation);
        if (entry.isHard) {
          const badge = document.createElement('span');
          badge.className = 'context-badge';
          badge.textContent = 'Pinned';
          text.append(badge);
        }
        row.append(text);

        const actions = document.createElement('div');
        actions.className = 'context-actions';
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'btn-small';
        pin.textContent = entry.isHard ? 'Unpin' : 'Pin';
        pin.setAttribute('aria-label', `${entry.isHard ? 'Unpin' : 'Pin'} ${entry.original}`);
        pin.addEventListener('click', () =>
          contextCommand(
            { operation: 'setPinned', original: entry.original, pinned: !entry.isHard },
            applyContextResponse
          )
        );
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn-small';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit ${entry.original}`);
        edit.addEventListener('click', () => {
          editingKey = entry.original;
          contextOriginal.value = entry.original;
          contextTranslation.value = entry.translation;
          contextPin.checked = Boolean(entry.isHard);
          refreshInputState();
          contextTranslation.focus();
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-small';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${entry.original}`);
        remove.addEventListener('click', () => {
          if (
            !window.confirm(
              'Remove this term from the glossary? The next request uses the updated context.'
            )
          )
            return;
          contextCommand({ operation: 'remove', original: entry.original }, applyContextResponse);
        });
        actions.append(pin, edit, remove);
        row.append(actions);
        return row;
      })
    );

    if (!view.dialogue.length) {
      setContextNote('No dialogue kept yet. Translate a page and it appears here.');
    } else if (!view.glossary.length) {
      setContextNote('No glossary terms yet. Add one below to keep a translation consistent.');
    } else {
      setContextNote('');
    }
    updateSaveState();
  }

  function applyContextResponse(response: ContextCommandResponse): void {
    renderContext(response.view);
    if (!response.success) {
      showContextFeedback(response.error ?? 'Could not update the glossary. Try again.', 'error');
      return;
    }
    const outcome = response.outcome;
    if (!outcome) return;
    const text = OUTCOME_COPY[outcome];
    showContextFeedback(
      outcome === 'unchanged'
        ? text
        : `${text} Applies to the next request. Retranslate Visible Page updates this page now.`,
      'success'
    );
  }

  function updateSaveState(): void {
    if (!saveTermBtn) return;
    saveTermBtn.disabled =
      !contextWithinChapter || !contextOriginal.value.trim() || !contextTranslation.value.trim();
  }

  function loadContext(): void {
    if (!activeTabId) return;
    setContextNote('Checking reader session...');
    contextCommand({ operation: 'view' }, (response) => {
      if (!response.success) {
        setContextNote(
          response.error ?? 'Could not load the reading context. Reload the chapter and try again.'
        );
        return;
      }
      renderContext(response.view);
    });
  }

  toggleContextBtn?.addEventListener('click', () => {
    const isOpen = contextPanel.classList.toggle('open');
    contextChevron.textContent = isOpen ? '▴' : '▾';
    toggleContextBtn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) loadContext();
  });

  contextOriginal?.addEventListener('input', updateSaveState);
  contextTranslation?.addEventListener('input', updateSaveState);

  contextForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveTermBtn.disabled = true;
    const term = { original: contextOriginal.value, translation: contextTranslation.value };
    contextCommand({ operation: 'save', ...term, pinned: contextPin.checked }, (response) => {
      if (response.success) {
        contextForm.reset();
        editingKey = undefined;
        refreshInputState();
      }
      applyContextResponse(response);
    });
  });

  cancelTermBtn?.addEventListener('click', () => {
    contextForm.reset();
    editingKey = undefined;
    refreshInputState();
    contextOriginal.focus();
  });

  contextForm?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || editingKey === undefined) return;
    contextForm.reset();
    editingKey = undefined;
    refreshInputState();
  });

  resetContextBtn?.addEventListener('click', () => {
    if (!activeTabId) {
      showFeedback('No active page to reset context.', 'error');
      return;
    }

    chrome.tabs.sendMessage(
      activeTabId,
      {
        type: EXTENSION_MESSAGE_TYPES.RESET_CONTEXT,
        targetLanguage: settings?.targetLanguage || targetLangSelect.value,
      },
      (response: ResetContextResponse | undefined) => {
        if (chrome.runtime.lastError || !response?.success) {
          showFeedback(response?.error || 'Failed to reset page context.', 'error');
        } else {
          showFeedback('Context cleared for this reading scope.', 'success');
        }
      }
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  void initializePopup();
});
