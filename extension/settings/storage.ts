import {
  defaultProviderConfig,
  normalizeBaseUrl,
  type ProviderConfig,
  type ProviderId,
} from '@providers/config';
import { resolveReasoningEffort } from '@providers/openai/models';

const SETTINGS_KEY = 'koma_provider_settings';
const SESSION_KEY = 'koma_provider_session_keys';
const LEGACY_KEY = 'koma_gemini_config';
const providerIds: ProviderId[] = ['gemini', 'openai', 'openai-compatible'];

export interface ProviderSettings {
  version: 1;
  revision: number;
  provider: ProviderId;
  targetLanguage: string;
  profiles: Record<ProviderId, ProviderConfig>;
}

function defaults(): ProviderSettings {
  return {
    version: 1,
    revision: 0,
    provider: 'gemini',
    targetLanguage: 'id',
    profiles: {
      gemini: defaultProviderConfig('gemini'),
      openai: defaultProviderConfig('openai'),
      'openai-compatible': defaultProviderConfig('openai-compatible'),
    },
  };
}

let fallback = defaults();

function read(
  area: chrome.storage.StorageArea | undefined,
  keys: string[]
): Promise<Record<string, unknown>> {
  if (!area) return Promise.resolve({});
  return new Promise((resolve, reject) =>
    area.get(keys, (values) => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(values);
    })
  );
}

function write(area: chrome.storage.StorageArea, data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) =>
    area.set(data, () => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    })
  );
}

async function persist(settings: ProviderSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    fallback = structuredClone(settings);
    return;
  }
  const stored = structuredClone(settings);
  const sessionKeys: Record<string, string> = {};
  for (const id of providerIds) {
    const profile = stored.profiles[id];
    if (!profile.rememberKey) {
      sessionKeys[id] = profile.apiKey;
      profile.apiKey = '';
    }
  }
  if (Object.values(sessionKeys).some(Boolean) && !chrome.storage.session) {
    throw new Error('Session key storage is unavailable. Update Chrome or enable Remember Key.');
  }
  if (chrome.storage.session) await write(chrome.storage.session, { [SESSION_KEY]: sessionKeys });
  await write(chrome.storage.local, { [SETTINGS_KEY]: stored });
}

export async function getProviderSettings(): Promise<ProviderSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return structuredClone(fallback);
  const [local, session] = await Promise.all([
    read(chrome.storage.local, [SETTINGS_KEY, LEGACY_KEY]),
    read(chrome.storage.session, [SESSION_KEY]),
  ]);
  const stored = local[SETTINGS_KEY] as Partial<ProviderSettings> | undefined;
  const settings = defaults();
  if (!stored && local[LEGACY_KEY]) {
    const legacy = local[LEGACY_KEY] as Partial<ProviderConfig> & { targetLanguage?: string };
    settings.profiles.gemini = {
      ...settings.profiles.gemini,
      apiKey: typeof legacy.apiKey === 'string' ? legacy.apiKey : '',
      modelName: legacy.modelName || settings.profiles.gemini.modelName,
      rememberKey: legacy.rememberKey ?? true,
    };
    settings.targetLanguage = legacy.targetLanguage || 'id';
    await persist(settings);
    await new Promise<void>((resolve, reject) =>
      chrome.storage.local.remove(LEGACY_KEY, () => {
        if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      })
    );
    return settings;
  }
  if (stored?.version === 1) {
    settings.provider = providerIds.includes(stored.provider as ProviderId)
      ? stored.provider!
      : 'gemini';
    settings.revision = typeof stored.revision === 'number' ? stored.revision : 0;
    settings.targetLanguage = stored.targetLanguage || 'id';
    const keys = session[SESSION_KEY] as Record<string, string> | undefined;
    for (const id of providerIds) {
      const profile = { ...settings.profiles[id], ...stored.profiles?.[id], provider: id };
      profile.apiKey = profile.rememberKey ? profile.apiKey : keys?.[id] || '';
      settings.profiles[id] = profile;
    }
  }
  return settings;
}

export async function saveProviderSettings(
  profile: ProviderConfig,
  targetLanguage: string
): Promise<ProviderSettings> {
  if (!providerIds.includes(profile.provider)) throw new Error('Select a supported provider.');
  if (!['id', 'en'].includes(targetLanguage)) throw new Error('Select Indonesian or English.');
  if (!profile.modelName.trim()) throw new Error('Enter a vision-capable model ID.');
  if (
    !['responses', 'chat-completions'].includes(profile.apiFormat) ||
    !['json-schema', 'json-object', 'prompt'].includes(profile.responseFormat)
  ) {
    throw new Error('Select a supported API and response format.');
  }
  if (
    !['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
      profile.reasoningEffort
    )
  )
    throw new Error('Select a supported reasoning effort.');
  const normalized = {
    ...profile,
    modelName: profile.modelName.trim(),
    apiKey: profile.apiKey.trim(),
  };
  normalized.baseUrl =
    profile.provider === 'openai-compatible'
      ? normalizeBaseUrl(profile.baseUrl)
      : defaultProviderConfig(profile.provider).baseUrl;
  if (profile.provider === 'openai') {
    normalized.apiFormat = 'responses';
    resolveReasoningEffort(normalized.modelName, normalized.reasoningEffort, false);
  }
  const settings = await getProviderSettings();
  settings.profiles[profile.provider] = normalized;
  settings.provider = profile.provider;
  settings.targetLanguage = targetLanguage;
  settings.revision++;
  await persist(settings);
  return settings;
}
