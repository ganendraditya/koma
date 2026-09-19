import { TranslationResult, validateTranslationResult } from '../contracts';
import { CacheEntry, TranslationCache } from './types';

export interface CacheOptions {
  maxMemoryEntries?: number;
  storagePrefix?: string;
  storageArea?: {
    get(
      keys: string | string[] | null | Record<string, unknown>,
      callback?: (items: Record<string, unknown>) => void
    ): Promise<Record<string, unknown>> | void;
    set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void;
    remove(keys: string | string[], callback?: () => void): Promise<void> | void;
  };
}

export class KomaTranslationCache implements TranslationCache {
  private readonly memory = new Map<string, CacheEntry>();
  private readonly maxMemoryEntries: number;
  private readonly storagePrefix: string;
  private readonly storageArea?: CacheOptions['storageArea'];

  constructor(options: CacheOptions = {}) {
    this.maxMemoryEntries = options.maxMemoryEntries ?? 100;
    this.storagePrefix = options.storagePrefix ?? 'koma_cache:';
    this.storageArea =
      options.storageArea ??
      (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : undefined);
  }

  async get(key: string): Promise<TranslationResult | null> {
    const memEntry = this.memory.get(key);
    if (memEntry) {
      if (validateTranslationResult(memEntry.result).valid) {
        // Refresh access order for LRU eviction
        this.memory.delete(key);
        this.memory.set(key, memEntry);
        return memEntry.result;
      }
      this.memory.delete(key);
    }

    if (!this.storageArea) {
      return null;
    }

    const storageKey = this.getStorageKey(key);
    const rawData = await this.readStorageKey(storageKey);

    if (!rawData || typeof rawData !== 'object') {
      return null;
    }

    const entry = rawData as Partial<CacheEntry>;
    if (!entry.result || !validateTranslationResult(entry.result).valid) {
      // Gracefully purge corrupted storage record
      await this.removeStorageKey(storageKey);
      return null;
    }

    this.storeInMemory(key, entry.result, entry.cachedAt ?? Date.now());
    return entry.result;
  }

  async set(key: string, result: TranslationResult): Promise<void> {
    const validation = validateTranslationResult(result);
    if (!validation.valid) {
      return;
    }

    const now = Date.now();
    this.storeInMemory(key, result, now);

    if (this.storageArea) {
      const storageKey = this.getStorageKey(key);
      const entry: CacheEntry = { key, result, cachedAt: now };
      await this.writeStorageKey(storageKey, entry);
    }
  }

  async has(key: string): Promise<boolean> {
    const result = await this.get(key);
    return result !== null;
  }

  async delete(key: string): Promise<boolean> {
    const existedInMem = this.memory.delete(key);
    let existedInStorage = false;

    if (this.storageArea) {
      const storageKey = this.getStorageKey(key);
      const rawData = await this.readStorageKey(storageKey);
      if (rawData !== undefined) {
        existedInStorage = true;
        await this.removeStorageKey(storageKey);
      }
    }

    return existedInMem || existedInStorage;
  }

  async clear(): Promise<void> {
    this.memory.clear();

    if (!this.storageArea) {
      return;
    }

    const allItems = await this.readAllStorage();
    if (!allItems) {
      return;
    }

    const matchingKeys = Object.keys(allItems).filter((k) => k.startsWith(this.storagePrefix));
    if (matchingKeys.length > 0) {
      await this.removeStorageKey(matchingKeys);
    }
  }

  async size(): Promise<number> {
    if (!this.storageArea) {
      return this.memory.size;
    }

    const allItems = await this.readAllStorage();
    if (!allItems) {
      return this.memory.size;
    }

    const storageKeys = new Set(
      Object.keys(allItems)
        .filter((k) => k.startsWith(this.storagePrefix))
        .map((k) => k.slice(this.storagePrefix.length))
    );

    for (const key of this.memory.keys()) {
      storageKeys.add(key);
    }

    return storageKeys.size;
  }

  private getStorageKey(key: string): string {
    return `${this.storagePrefix}${key}`;
  }

  private storeInMemory(key: string, result: TranslationResult, cachedAt: number): void {
    if (this.memory.has(key)) {
      this.memory.delete(key);
    } else if (this.memory.size >= this.maxMemoryEntries) {
      const oldestKey = this.memory.keys().next().value;
      if (oldestKey !== undefined) {
        this.memory.delete(oldestKey);
      }
    }

    this.memory.set(key, { key, result, cachedAt });
  }

  private async readStorageKey(storageKey: string): Promise<unknown> {
    return new Promise((resolve) => {
      try {
        const res = this.storageArea?.get([storageKey], (items: Record<string, unknown>) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            resolve(undefined);
            return;
          }
          resolve(items?.[storageKey]);
        });
        if (res instanceof Promise) {
          res.then((items) => resolve(items?.[storageKey])).catch(() => resolve(undefined));
        }
      } catch {
        resolve(undefined);
      }
    });
  }

  private async writeStorageKey(storageKey: string, entry: CacheEntry): Promise<void> {
    return new Promise((resolve) => {
      try {
        const res = this.storageArea?.set({ [storageKey]: entry }, () => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            resolve();
            return;
          }
          resolve();
        });
        if (res instanceof Promise) {
          res.then(resolve).catch(() => resolve());
        }
      } catch {
        resolve();
      }
    });
  }

  private async removeStorageKey(storageKey: string | string[]): Promise<void> {
    return new Promise((resolve) => {
      try {
        const res = this.storageArea?.remove(storageKey, () => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            resolve();
            return;
          }
          resolve();
        });
        if (res instanceof Promise) {
          res.then(resolve).catch(() => resolve());
        }
      } catch {
        resolve();
      }
    });
  }

  private async readAllStorage(): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolve) => {
      try {
        const res = this.storageArea?.get(null, (items: Record<string, unknown>) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            resolve(undefined);
            return;
          }
          resolve(items);
        });
        if (res instanceof Promise) {
          res.then(resolve).catch(() => resolve(undefined));
        }
      } catch {
        resolve(undefined);
      }
    });
  }
}
