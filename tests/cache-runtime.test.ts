import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTENSION_MESSAGE_TYPES } from '../shared/messages';
import { defaultProviderConfig } from '../providers/config';
import type { ReplayIdentity } from '../core/cache/replay';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: async (keys: string[] | null, done?: (values: Record<string, unknown>) => void) => {
      const values = keys
        ? Object.fromEntries(keys.map((k) => [k, data[k]]))
        : structuredClone(data);
      done?.(values);
      return values;
    },
    set: vi.fn(async (values: Record<string, unknown>, done?: () => void) => {
      Object.assign(data, structuredClone(values));
      done?.();
    }),
    remove: vi.fn(async (keys: string | string[], done?: () => void) => {
      for (const key of [keys].flat()) delete data[key];
      done?.();
    }),
  });
  const localArea = area(local);
  const sendMessage = vi.fn().mockResolvedValue({ success: true });
  vi.stubGlobal('chrome', {
    runtime: { id: 'koma-test', getURL: (path: string) => `chrome-extension://koma-test/${path}` },
    storage: { local: localArea, session: area(session) },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]), sendMessage },
  });
  const { saveProviderSettings } = await import('../extension/settings/storage');
  await saveProviderSettings(
    {
      ...defaultProviderConfig('openai-compatible'),
      baseUrl: 'http://localhost:1234/v1',
      modelName: 'model-a',
    },
    'en'
  );
  const { getRuntimeProviderConfig } = await import('../extension/background/translation');
  const config = await getRuntimeProviderConfig();
  const chapterId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const sender = {
    id: 'koma-test',
    frameId: 0,
    url: `https://mangadex.org/chapter/${chapterId}`,
    tab: { id: 1 } as chrome.tabs.Tab,
  };
  const identity: ReplayIdentity = {
    reading: { site: 'mangadex', chapterId },
    pageIndex: 0,
    sourceIdentity: 'filename',
    contentHash: 'a'.repeat(64),
    contextRevision: 'b'.repeat(64),
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    providerId: config.id,
    modelId: config.modelName,
    configuration: config.cacheIdentity,
    promptVersion: 1,
  };
  const { handleCacheMessage } = await import('../extension/background/cache');
  const command = (payload: object, from = sender) =>
    new Promise<Record<string, unknown>>((resolve) => {
      handleCacheMessage(
        { type: EXTENSION_MESSAGE_TYPES.CACHE_COMMAND, revision: config.revision, ...payload },
        from,
        (value) => resolve(value as Record<string, unknown>)
      );
    });
  const record = {
    schemaVersion: 2,
    identity,
    requestContextHash: 'c'.repeat(64),
    acceptedAt: 1,
    lastAccessedAt: 1,
    result: {
      imageId: 'image',
      pageId: 'page_0',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      bubbles: [],
    },
  };
  return { command, config, identity, record, sender, local, localArea, sendMessage };
}

describe('Background-owned translation cache commands', () => {
  it.each(['other-extension', 'iframe', 'wrong-site', 'unsupported-page'])(
    'rejects %s without storage access',
    async (kind) => {
      const { command, sender, identity, localArea } = await setup();
      const from = { ...sender };
      if (kind === 'other-extension') from.id = 'other-extension';
      else if (kind === 'iframe') from.frameId = 1;
      else if (kind === 'wrong-site')
        from.url = 'https://example.test/chapter/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      else from.url = 'https://mangadex.org/titles';
      const writes = localArea.set.mock.calls.length;
      expect(await command({ operation: 'lookup', identity }, from)).toMatchObject({
        success: false,
      });
      expect(localArea.set).toHaveBeenCalledTimes(writes);
    }
  );

  it.each(['chapter', 'config', 'revision', 'model', 'target', 'prompt'])(
    'rejects stale/mismatched %s identity',
    async (kind) => {
      const { command, identity } = await setup();
      const altered = structuredClone(identity);
      if (kind === 'chapter') altered.reading.chapterId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      if (kind === 'config') altered.configuration = 'dummy-secret';
      if (kind === 'model') altered.modelId = 'different-model';
      if (kind === 'target') altered.targetLanguage = 'id';
      if (kind === 'prompt') altered.promptVersion = 99;
      const response = await command({
        operation: 'lookup',
        identity: altered,
        ...(kind === 'revision' ? { revision: -1 } : {}),
      });
      expect(response.success).toBe(false);
      expect(JSON.stringify(response)).not.toContain('dummy-secret');
    }
  );

  it('clears from the popup, pauses both tabs and rejects an older acceptance ticket', async () => {
    const { command, identity, record, sender, local, sendMessage } = await setup();
    const lookup = await command({ operation: 'lookup', identity });
    await command({ operation: 'accept', record, generation: lookup.generation });
    local['koma_cache:legacy-debug'] = { result: 'old' };
    local['koma_context:v1:scope'] = { glossary: 'kept' };
    const settings = structuredClone(local.koma_provider_settings);
    const fromPopup = { ...sender, url: 'chrome-extension://koma-test/extension/popup/index.html' };
    expect(await command({ operation: 'clear' }, fromPopup)).toEqual({ success: true });
    expect(sendMessage.mock.calls.map(([tab, message]) => [tab, message.phase])).toEqual([
      [1, 'start'],
      [2, 'start'],
      [1, 'done'],
      [2, 'done'],
    ]);
    const stale = await command({ operation: 'accept', record, generation: lookup.generation });
    expect(stale.warning).toContain('not saved');
    expect(Object.keys(local).filter((k) => k.startsWith('koma_cache:'))).toHaveLength(0);
    expect(local.koma_provider_settings).toEqual(settings);
    expect(local['koma_context:v1:scope']).toEqual({ glossary: 'kept' });
  });

  it('reports clear failure without exposing details or resuming either reader', async () => {
    const { command, identity, record, localArea, sendMessage } = await setup();
    const lookup = await command({ operation: 'lookup', identity });
    await command({ operation: 'accept', record, generation: lookup.generation });
    localArea.remove.mockRejectedValue(new Error('storage dummy-secret'));
    const response = await command({ operation: 'clear' });
    expect(response.success).toBe(false);
    expect(JSON.stringify(response)).not.toContain('dummy-secret');
    expect(
      sendMessage.mock.calls.every(
        ([, message]) => message.type === EXTENSION_MESSAGE_TYPES.CACHE_CLEARED
      )
    ).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });
});
