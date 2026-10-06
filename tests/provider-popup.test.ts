// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import html from '../extension/popup/index.html?raw';
import { initializePopup } from '../extension/popup/popup';
import { getProviderSettings } from '../extension/settings/storage';

function setup() {
  document.documentElement.innerHTML = html;
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>) => ({
    get: (keys: string[], done: (value: Record<string, unknown>) => void) =>
      done(Object.fromEntries(keys.map((key) => [key, values[key]]))),
    set: (data: Record<string, unknown>, done: () => void) => {
      Object.assign(values, data);
      done();
    },
  });
  const request = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', {
    storage: { local: area(local), session: area(session) },
    runtime: { onMessage: { addListener: vi.fn() } },
    permissions: { request },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 3, url: 'https://mangadex.org/chapter/test' }]),
      sendMessage: vi.fn((_id, _message, done) =>
        done({ success: true, started: true, imageCount: 3, isSupportedSite: true })
      ),
    },
  });
  return { request, local, session };
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = [...document.querySelectorAll('label')].find(
    (node) => node.textContent?.trim() === label
  );
  if (!element?.htmlFor) throw new Error(`Missing label: ${label}`);
  return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLSelectElement;
}

function change(label: string, value: string): void {
  const input = field(label);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

function click(text: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.replace(/\s+/g, ' ').trim() === text
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  button.click();
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Provider settings popup', () => {
  it('switches provider drafts, restricts reasoning choices, and saves all edited session keys', async () => {
    const { local, session } = setup();
    await initializePopup();
    change('Gemini API key', 'gemini-draft');
    change('Provider', 'openai');
    change('OpenAI API key', 'openai-draft');
    change('Vision model ID', 'o4-mini');
    expect(
      (field('Reasoning effort') as HTMLSelectElement).querySelector<HTMLOptionElement>(
        '[value="none"]'
      )?.disabled
    ).toBe(true);
    change('Provider', 'gemini');
    expect(field('Gemini API key').value).toBe('gemini-draft');
    change('Provider', 'openai');
    expect(field('OpenAI API key').value).toBe('openai-draft');
    click('Show');
    expect((field('OpenAI API key') as HTMLInputElement).type).toBe('text');
    click('Hide');
    expect((field('OpenAI API key') as HTMLInputElement).type).toBe('password');
    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toBe(
        'Provider settings saved.'
      )
    );
    const settings = await getProviderSettings();
    expect(settings.provider).toBe('openai');
    expect(settings.profiles.openai).toMatchObject({
      apiKey: 'openai-draft',
      modelName: 'o4-mini',
      reasoningEffort: 'auto',
    });
    expect(settings.profiles.gemini.apiKey).toBe('gemini-draft');
    expect(JSON.stringify(local)).not.toContain('openai-draft');
    expect(JSON.stringify(local)).not.toContain('gemini-draft');
    expect(JSON.stringify(session)).toContain('openai-draft');
    expect(JSON.stringify(session)).toContain('gemini-draft');
    change('Provider', 'gemini');
    expect(field('Gemini API key').value).toBe('gemini-draft');
  });

  it('saves an edited custom endpoint from another provider after permission is granted', async () => {
    const { request, local, session } = setup();
    await initializePopup();
    change('Provider', 'openai-compatible');
    change('API base URL', 'http://localhost:1234/api/v1/');
    change('Vision model ID', 'local-vision-model');
    change('API key (optional for local servers)', 'custom-draft');
    (field('Remember key') as HTMLInputElement).checked = true;
    change('Provider', 'gemini');
    change('Gemini API key', 'gemini-draft');
    const before = await getProviderSettings();
    request.mockResolvedValueOnce(false);

    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toContain(
        'access was not granted'
      )
    );
    expect(await getProviderSettings()).toEqual(before);
    expect(request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });

    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toBe(
        'Provider settings saved.'
      )
    );
    const settings = await getProviderSettings();
    expect(settings.provider).toBe('gemini');
    expect(settings.revision).toBe(before.revision + 1);
    expect(settings.profiles.gemini.apiKey).toBe('gemini-draft');
    expect(settings.profiles['openai-compatible']).toMatchObject({
      apiKey: 'custom-draft',
      modelName: 'local-vision-model',
      baseUrl: 'http://localhost:1234/api/v1',
      rememberKey: true,
    });
    expect(JSON.stringify(local)).toContain('custom-draft');
    expect(JSON.stringify(local)).not.toContain('gemini-draft');
    expect(JSON.stringify(session)).toContain('gemini-draft');
    expect(JSON.stringify(session)).not.toContain('custom-draft');
    change('Provider', 'openai-compatible');
    expect(field('API key (optional for local servers)').value).toBe('custom-draft');
  });

  it('ignores untouched custom-provider defaults when saving another provider', async () => {
    const { request } = setup();
    await initializePopup();
    change('Provider', 'openai-compatible');
    change('Provider', 'openai');
    change('OpenAI API key', 'openai-draft');
    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toBe(
        'Provider settings saved.'
      )
    );
    expect((await getProviderSettings()).profiles.openai.apiKey).toBe('openai-draft');
    expect(request).not.toHaveBeenCalled();
  });

  it('requests only the custom endpoint host and reports denied permission without saving', async () => {
    const { request } = setup();
    await initializePopup();
    change('Provider', 'openai-compatible');
    change('API base URL', 'http://localhost:1234/api/v1');
    change('Vision model ID', 'local-vision-model');
    request.mockResolvedValueOnce(false);
    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toContain(
        'access was not granted'
      )
    );
    expect((await getProviderSettings()).provider).toBe('gemini');
    expect(request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toBe(
        'Provider settings saved.'
      )
    );
    expect((await getProviderSettings()).profiles['openai-compatible']).toMatchObject({
      apiKey: '',
      baseUrl: 'http://localhost:1234/api/v1',
      modelName: 'local-vision-model',
    });
  });

  it('opens missing-provider settings and keeps expansion state accessible', async () => {
    setup();
    await initializePopup();
    click('Translate');
    await vi.waitFor(() =>
      expect(document.getElementById('settings-feedback')?.textContent).toContain(
        'Configure your selected provider'
      )
    );
    expect(
      document.querySelector('[aria-controls="settings-panel"]')?.getAttribute('aria-expanded')
    ).toBe('true');
    click('Provider Settings (BYOK) ▴');
    expect(
      document.querySelector('[aria-controls="settings-panel"]')?.getAttribute('aria-expanded')
    ).toBe('false');
  });
});
