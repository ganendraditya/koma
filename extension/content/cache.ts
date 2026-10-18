import type { ReadingIdentity } from '@core/contracts';
import {
  CACHE_PERSISTENCE_WARNING,
  type ReplayCache,
  type ReplayIdentity,
  type ReplayLookup,
  type ReplayRecord,
} from '@core/cache';
import { EXTENSION_MESSAGE_TYPES } from '@shared/messages';

export function cacheCommand<T>(operation: string, payload: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const runtime = chrome.runtime;
      runtime.sendMessage(
        { type: EXTENSION_MESSAGE_TYPES.CACHE_COMMAND, operation, ...payload },
        (response) => {
          if (runtime.lastError || !response?.success)
            reject(new Error('Cache operation could not be completed.'));
          else resolve(response);
        }
      );
    } catch {
      reject(new Error('Cache operation could not be completed.'));
    }
  });
}

export class ExtensionReplayCache implements ReplayCache {
  constructor(private readonly revision: number) {}

  async lookup(identity: ReplayIdentity): Promise<ReplayLookup> {
    try {
      return await cacheCommand<ReplayLookup>('lookup', { identity, revision: this.revision });
    } catch {
      return { record: null, generation: 'unavailable', warning: CACHE_PERSISTENCE_WARNING };
    }
  }

  async accept(record: ReplayRecord, generation: string): Promise<{ warning?: string }> {
    try {
      return await cacheCommand('accept', { record, generation, revision: this.revision });
    } catch {
      return { warning: CACHE_PERSISTENCE_WARNING };
    }
  }

  async invalidate(
    reading: ReadingIdentity,
    targetLanguage: string,
    fromPage?: number
  ): Promise<void> {
    await cacheCommand('invalidate', { reading, targetLanguage, fromPage });
  }
}
