import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProviderConfig } from '../providers/config';
import { getProviderSettings, saveProviderSettings } from '../extension/settings/storage';

function storage(initial: Record<string, unknown> = {}) {
  const local = { ...initial };
  const session: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn((keys: string[], done: (result: Record<string, unknown>) => void) => {
      done(Object.fromEntries(keys.map((key) => [key, values[key]])));
    }),
    set: vi.fn((data: Record<string, unknown>, done: () => void) => {
      Object.assign(values, data);
      done();
    }),
    remove: vi.fn((keys: string | string[], done: () => void) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      done();
    }),
  });
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) }, runtime: {} });
  return { local, session };
}

afterEach(() => vi.unstubAllGlobals());

describe('Provider settings and BYOK storage', () => {
  it('migrates the existing Gemini profile and honors its key storage mode', async () => {
    const { local, session } = storage({
      koma_gemini_config: {
        apiKey: 'legacy-key',
        modelName: 'custom-gemini',
        targetLanguage: 'en',
        rememberKey: false,
      },
    });
    const settings = await getProviderSettings();
    expect(settings.provider).toBe('gemini');
    expect(settings.targetLanguage).toBe('en');
    expect(settings.profiles.gemini).toMatchObject({
      apiKey: 'legacy-key',
      modelName: 'custom-gemini',
      rememberKey: false,
    });
    expect(JSON.stringify(local)).not.toContain('legacy-key');
    expect(JSON.stringify(session)).toContain('legacy-key');
    expect(local).not.toHaveProperty('koma_gemini_config');
  });

  it('isolates provider credentials and keeps session keys out of local storage', async () => {
    const { local, session } = storage();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'openai-secret' },
      'en'
    );
    await saveProviderSettings(
      { ...defaultProviderConfig('gemini'), apiKey: 'gemini-secret' },
      'id'
    );
    let settings = await getProviderSettings();
    expect(settings.profiles.openai.apiKey).toBe('openai-secret');
    expect(settings.profiles.gemini.apiKey).toBe('gemini-secret');
    expect(JSON.stringify(local)).not.toContain('-secret');
    for (const key of Object.keys(session)) delete session[key];
    settings = await getProviderSettings();
    expect(settings.profiles.openai.apiKey).toBe('');
    expect(settings.profiles.gemini.apiKey).toBe('');
    expect(settings.targetLanguage).toBe('id');
  });

  it('moves a remembered key back to session storage when Remember Key is unchecked', async () => {
    const { local, session } = storage();
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'remembered-secret', rememberKey: true },
      'en'
    );
    expect(JSON.stringify(local)).toContain('remembered-secret');
    await saveProviderSettings(
      { ...defaultProviderConfig('openai'), apiKey: 'remembered-secret', rememberKey: false },
      'en'
    );
    expect(JSON.stringify(local)).not.toContain('remembered-secret');
    expect(JSON.stringify(session)).toContain('remembered-secret');
    expect((await getProviderSettings()).profiles.openai.apiKey).toBe('remembered-secret');
  });

  it('saves custom API paths and rejects invalid URLs before changing storage', async () => {
    storage();
    await saveProviderSettings(
      {
        ...defaultProviderConfig('openai-compatible'),
        baseUrl: 'http://localhost:1234/api/v1/',
        modelName: 'vision-model',
      },
      'en'
    );
    const before = await getProviderSettings();
    expect(before.profiles['openai-compatible'].baseUrl).toBe('http://localhost:1234/api/v1');
    await expect(
      saveProviderSettings(
        { ...before.profiles['openai-compatible'], baseUrl: 'file:///private/test' },
        'en'
      )
    ).rejects.toThrow(/HTTP/);
    expect(await getProviderSettings()).toEqual(before);
  });
});
