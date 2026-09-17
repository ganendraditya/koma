/**
 * Secure BYOK (Bring Your Own Key) credential manager for Chrome Extension storage.
 */

import { DEFAULT_GEMINI_MODEL } from './types';

const STORAGE_KEY = 'koma_gemini_config';

export interface StoredGeminiConfig {
  apiKey: string;
  modelName: string;
  targetLanguage: string;
  rememberKey: boolean;
}

const DEFAULT_CONFIG: StoredGeminiConfig = {
  apiKey: '',
  modelName: DEFAULT_GEMINI_MODEL,
  targetLanguage: 'id',
  rememberKey: true,
};

// In-memory fallback for testing or environments where chrome.storage is unavailable
let inMemoryStore: StoredGeminiConfig = { ...DEFAULT_CONFIG };

/**
 * Retrieves the stored Gemini provider configuration.
 */
export async function getStoredGeminiConfig(): Promise<StoredGeminiConfig> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const stored = res?.[STORAGE_KEY] as Partial<StoredGeminiConfig> | undefined;
        resolve({
          ...DEFAULT_CONFIG,
          ...stored,
        });
      });
    });
  }

  return Promise.resolve({ ...inMemoryStore });
}

/**
 * Persists the user-configured Gemini API key and settings.
 */
export async function saveStoredGeminiConfig(
  config: Partial<StoredGeminiConfig>
): Promise<StoredGeminiConfig> {
  const current = await getStoredGeminiConfig();
  const updated: StoredGeminiConfig = {
    ...current,
    ...config,
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(updated);
        }
      });
    });
  }

  inMemoryStore = { ...updated };
  return Promise.resolve(updated);
}

/**
 * Clears the stored Gemini API key and credentials from storage.
 */
export async function clearStoredGeminiConfig(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEY], () => {
        resolve();
      });
    });
  }

  inMemoryStore = { ...DEFAULT_CONFIG };
  return Promise.resolve();
}
