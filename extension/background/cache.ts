import { ReplayStore, isReplayIdentity, isReplayRecord, type ReplayIdentity } from '@core/cache';
import type { ContextStorageArea } from '@core/context/context-store';
import { EXTENSION_MESSAGE_TYPES } from '@shared/messages';
import { getRuntimeProviderConfig } from './translation';

let store: ReplayStore | undefined;
let clearing: Promise<void> | undefined;

function getStore(): ReplayStore {
  return (store ??= new ReplayStore({
    storageArea: chrome.storage?.local as unknown as ContextStorageArea,
    quotaBytes: chrome.storage?.local?.QUOTA_BYTES,
  }));
}

function readerSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(sender.url ?? sender.tab?.url ?? '');
    return (
      sender.frameId === 0 &&
      ['https:', 'http:'].includes(url.protocol) &&
      ['mangadex.org', 'www.mangadex.org'].includes(url.hostname) &&
      /^\/chapter\/[a-f\d-]{36}(?:\/[1-9]\d*)?\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function popupSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('extension/popup/index.html')
  );
}

function validReading(value: unknown): value is ReplayIdentity['reading'] {
  if (!value || typeof value !== 'object') return false;
  const x = value as ReplayIdentity['reading'];
  return (
    x.site === 'mangadex' &&
    /^[a-f\d-]{36}$/.test(x.chapterId) &&
    (x.seriesId === undefined || /^[a-f\d-]{36}$/.test(x.seriesId))
  );
}

async function pauseReaders(phase: 'start' | 'done'): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: EXTENSION_MESSAGE_TYPES.CACHE_CLEARED,
          phase,
        });
      } catch {
        /* Tabs without Koma have no cache session to pause. */
      }
    })
  );
}

export function handleCacheMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void
): boolean {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: string }).type !== EXTENSION_MESSAGE_TYPES.CACHE_COMMAND
  )
    return false;
  const req = message as {
    operation?: string;
    identity?: unknown;
    record?: unknown;
    generation?: unknown;
    reading?: unknown;
    targetLanguage?: unknown;
    fromPage?: unknown;
    revision?: unknown;
  };
  const fromReader = readerSender(sender);
  if (!fromReader && !popupSender(sender)) {
    respond({ success: false, error: 'Cache command is unavailable.' });
    return false;
  }
  void (async () => {
    const cache = getStore();
    if (req.operation === 'clear') {
      clearing ??= (async () => {
        await pauseReaders('start');
        try {
          await cache.clear();
        } finally {
          await pauseReaders('done');
        }
      })().finally(() => {
        clearing = undefined;
      });
      await clearing;
      return { success: true };
    }
    if (!fromReader) throw new Error('Reader command required.');
    if (req.operation === 'size') return { success: true, count: await cache.size() };
    if (req.operation === 'invalidate') {
      if (
        !validReading(req.reading) ||
        !['id', 'en'].includes(String(req.targetLanguage)) ||
        (req.fromPage !== undefined &&
          (!Number.isSafeInteger(req.fromPage) || (req.fromPage as number) < 0))
      )
        throw new Error('Invalid scope.');
      const chapter = new URL(sender.url ?? sender.tab!.url!).pathname.split('/')[2].toLowerCase();
      if (chapter !== req.reading.chapterId.toLowerCase()) throw new Error('Chapter mismatch.');
      await cache.invalidate(
        req.reading,
        String(req.targetLanguage),
        req.fromPage as number | undefined
      );
      return { success: true };
    }
    const config = await getRuntimeProviderConfig();
    const identity =
      req.operation === 'accept' && isReplayRecord(req.record) ? req.record.identity : req.identity;
    if (
      !isReplayIdentity(identity) ||
      !validReading(identity.reading) ||
      req.revision !== config.revision ||
      identity.configuration !== config.cacheIdentity ||
      identity.providerId !== config.id ||
      identity.modelId !== config.modelName ||
      identity.targetLanguage !== config.targetLanguage ||
      identity.reading.chapterId.toLowerCase() !==
        new URL(sender.url ?? sender.tab!.url!).pathname.split('/')[2].toLowerCase()
    )
      throw new Error('Cache identity no longer matches the reader.');
    if (req.operation === 'lookup') return { success: true, ...(await cache.lookup(identity)) };
    if (
      req.operation === 'accept' &&
      isReplayRecord(req.record) &&
      typeof req.generation === 'string'
    ) {
      const status = await cache.accept(req.record, req.generation);
      return { success: true, ...status };
    }
    throw new Error('Unknown cache command.');
  })().then(respond, () =>
    respond({
      success: false,
      error: 'Cache operation failed. Displayed translations and provider settings are unchanged.',
    })
  );
  return true;
}
