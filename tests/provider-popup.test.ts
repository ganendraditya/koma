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
        done({ success: true, started: true, imageCount: 3 })
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
  it('switches provider drafts, restricts reasoning choices, and saves the selected session key', async () => {
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
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
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
    expect(JSON.stringify(local)).not.toContain('openai-draft');
    expect(JSON.stringify(session)).toContain('openai-draft');
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
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        'access was not granted'
      )
    );
    expect((await getProviderSettings()).provider).toBe('gemini');
    expect(request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    click('Save Settings');
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
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
    click('Translate Current Page');
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
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
