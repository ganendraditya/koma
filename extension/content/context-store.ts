import { ContextStore } from '@core/context/context-store';
import type {
  ContextScopeIds,
  ContextStorePort,
  ContextWriteOptions,
  StoredContextSnapshot,
} from '@core/context/context-store';
import { EXTENSION_MESSAGE_TYPES } from '@shared/messages';

interface ContextStorageResponse<T> {
  success: boolean;
  result?: T;
  error?: string;
  code?: string;
}

function contextStorageCommand<T>(operation: string, payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const runtime = chrome.runtime;
      runtime.sendMessage(
        { type: EXTENSION_MESSAGE_TYPES.CONTEXT_STORAGE_COMMAND, operation, ...payload },
        (response: ContextStorageResponse<T> | undefined) => {
          const error = runtime.lastError;
          if (error || !response?.success) {
            const failure = new Error(
              response?.error ?? error?.message ?? 'Context storage operation failed.'
            );
            if (response?.code) Object.assign(failure, { code: response.code });
            reject(failure);
            return;
          }
          resolve(response.result as T);
        }
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Context storage operation failed.'));
    }
  });
}

export class ExtensionContextStore implements ContextStorePort {
  private readonly fallback =
    typeof chrome === 'undefined' || !chrome.storage?.local ? new ContextStore() : undefined;

  load(scopeId: string): Promise<StoredContextSnapshot | null> {
    if (this.fallback) return this.fallback.load(scopeId);
    return contextStorageCommand('load', { scopeId });
  }

  saveContext(
    scopeIds: ContextScopeIds,
    options: ContextWriteOptions
  ): Promise<StoredContextSnapshot> {
    if (this.fallback) return this.fallback.saveContext(scopeIds, options);
    return contextStorageCommand('saveContext', { scopeIds, options });
  }

  async remove(scopeIds: string[]): Promise<void> {
    const uniqueScopeIds = [...new Set(scopeIds)];
    if (this.fallback) return this.fallback.remove(uniqueScopeIds);
    await contextStorageCommand('remove', { scopeIds: uniqueScopeIds });
  }
}
