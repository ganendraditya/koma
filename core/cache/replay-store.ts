import type { ReadingIdentity } from '../contracts';
import type { ContextStorageArea } from '../context/context-store';
import {
  isReplayRecord,
  normalizedIdentity,
  normalizedResult,
  replayDescriptor,
  replayKey,
  REPLAY_PREFIX,
  type ReplayCache,
  type ReplayIdentity,
  type ReplayLookup,
  type ReplayRecord,
} from './replay';

export const CACHE_PERSISTENCE_WARNING =
  'Translation is ready, but its cache could not be saved. Reload may require another request.';
export const CACHE_OVERSIZE_WARNING =
  'Translation is ready, but this result exceeds the cache size limit and will not survive reload.';
export const CACHE_STALE_WARNING =
  'Translation is ready, but the cache changed during this request. This result was not saved.';

interface ReplayStoreOptions {
  storageArea?: ContextStorageArea;
  maxRecords?: number;
  maxBytes?: number;
  maxRecordBytes?: number;
  maxMemoryEntries?: number;
  quotaBytes?: number;
}

export function serializedBytes(key: string, value: unknown): number {
  return (
    new TextEncoder().encode(key).byteLength +
    new TextEncoder().encode(JSON.stringify(value)).byteLength
  );
}

export class ReplayStore implements ReplayCache {
  private readonly memory = new Map<string, ReplayRecord>();
  private readonly memoryOnly = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = globalThis.crypto.randomUUID();
  private readonly scopeGenerations = new Map<string, number>();
  private readonly pageGenerations = new Map<string, Map<number, number>>();
  private all?: Record<string, unknown>;
  private initialization?: Promise<Record<string, unknown>>;
  private readonly pendingStorageKeys = new Set<string>();
  private readonly storageByteCounts = new Map<string, number>();
  private unrelatedStorageBytes = 0;
  private timestamp = 0;
  private readonly maxRecords: number;
  private readonly maxBytes: number;
  private readonly maxRecordBytes: number;
  private readonly maxMemoryEntries: number;
  private readonly quotaBytes: number;

  constructor(private readonly options: ReplayStoreOptions = {}) {
    const bound = (n: number | undefined, fallback: number) =>
      Number.isFinite(n) ? Math.max(1, Math.floor(n!)) : fallback;
    this.maxRecords = bound(options.maxRecords, 200);
    this.maxBytes = bound(options.maxBytes, 4 * 1024 * 1024);
    this.maxRecordBytes = bound(options.maxRecordBytes, 256 * 1024);
    this.maxMemoryEntries = bound(options.maxMemoryEntries, 100);
    this.quotaBytes = bound(options.quotaBytes, 10 * 1024 * 1024);

    if (typeof chrome !== 'undefined') {
      chrome.storage?.onChanged?.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        for (const [key, change] of Object.entries(changes)) {
          if (this.all)
            this.applyStorageChange(key, change.newValue, change.newValue === undefined);
          else this.pendingStorageKeys.add(key);
        }
      });
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }

  lookup(identity: ReplayIdentity): Promise<ReplayLookup> {
    return this.serial(async () => {
      let warning: string | undefined;
      let all: Record<string, unknown> = {};
      try {
        all = await this.initialize();
      } catch {
        warning = CACHE_PERSISTENCE_WARNING;
      }
      const key = await replayKey(identity);
      const raw = this.memory.get(key) ?? all[key];
      const generation = this.generationFor(identity);
      if (raw === undefined) return { record: null, generation, warning };
      if (
        !isReplayRecord(raw) ||
        replayDescriptor(raw.identity) !== replayDescriptor(identity) ||
        raw.invalidated
      ) {
        if (
          !isReplayRecord(raw) ||
          (isReplayRecord(raw) && replayDescriptor(raw.identity) !== replayDescriptor(identity))
        ) {
          this.memory.delete(key);
          this.memoryOnly.delete(key);
          try {
            await this.remove([key]);
            delete all[key];
          } catch {
            warning = CACHE_PERSISTENCE_WARNING;
          }
        }
        return { record: null, generation, warning };
      }
      const record = structuredClone(raw);
      record.lastAccessedAt = this.nextTimestamp(all);
      this.remember(key, record);
      const persisted = !this.memoryOnly.has(key) && all[key] !== undefined;
      if (persisted) {
        try {
          await this.write({ [key]: record });
          all[key] = record;
        } catch {
          warning = CACHE_PERSISTENCE_WARNING;
        }
      }
      return { record: structuredClone(record), generation, warning };
    });
  }

  accept(record: ReplayRecord, generation: string): Promise<{ warning?: string }> {
    return this.serial(async () => {
      let all: Record<string, unknown>;
      let storageAvailable = true;
      try {
        all = await this.initialize();
      } catch {
        all = {};
        storageAvailable = false;
      }
      if (!isReplayRecord(record)) return { warning: CACHE_PERSISTENCE_WARNING };
      if (generation !== this.generationFor(record.identity))
        return { warning: CACHE_STALE_WARNING };
      const key = await replayKey(record.identity);
      const clean: ReplayRecord = {
        schemaVersion: 2,
        identity: normalizedIdentity(record.identity),
        result: normalizedResult(record.result),
        requestContextHash: record.requestContextHash,
        acceptedAt: record.acceptedAt,
        lastAccessedAt: this.nextTimestamp(all),
      };
      this.remember(key, clean);
      this.memoryOnly.add(key);
      if (serializedBytes(key, clean) > this.maxRecordBytes)
        return { warning: CACHE_OVERSIZE_WARNING };
      if (!this.options.storageArea || !storageAvailable)
        return { warning: CACHE_PERSISTENCE_WARNING };
      try {
        const before = Object.keys(all).filter((storedKey) => storedKey.startsWith(REPLAY_PREFIX));
        const candidate = { ...all, [key]: clean };
        await this.evict(candidate, key);
        for (const storedKey of before) {
          if (!(storedKey in candidate)) delete all[storedKey];
        }
      } catch {
        return { warning: CACHE_PERSISTENCE_WARNING };
      }
      try {
        await this.write({ [key]: clean });
        all[key] = clean;
        this.memoryOnly.delete(key);
        return {};
      } catch {
        // One bounded retry after evicting another cache record; unrelated storage is never removed.
        const oldest = this.records(all).filter(([k]) => k !== key)[0];
        if (oldest) {
          try {
            await this.remove([oldest[0]]);
            delete all[oldest[0]];
            this.memory.delete(oldest[0]);
            this.memoryOnly.delete(oldest[0]);
            await this.write({ [key]: clean });
            all[key] = clean;
            this.memoryOnly.delete(key);
            return {};
          } catch {
            /* The normalized result remains usable in memory. */
          }
        }
        return { warning: CACHE_PERSISTENCE_WARNING };
      }
    });
  }

  invalidate(reading: ReadingIdentity, targetLanguage: string, fromPage?: number): Promise<void> {
    return this.serial(async () => {
      const all = await this.initialize();
      if (fromPage !== undefined) {
        const key = this.chapterScopeKey(reading, targetLanguage);
        const generations = this.pageGenerations.get(key) ?? new Map<number, number>();
        generations.set(fromPage, (generations.get(fromPage) ?? 0) + 1);
        this.pageGenerations.set(key, generations);
      } else {
        const key = reading.seriesId
          ? this.seriesScopeKey(reading, targetLanguage)
          : this.chapterScopeKey(reading, targetLanguage);
        this.scopeGenerations.set(key, (this.scopeGenerations.get(key) ?? 0) + 1);
      }
      const updates: Record<string, ReplayRecord> = {};
      for (const [key, raw] of new Map([...Object.entries(all), ...this.memory])) {
        if (!isReplayRecord(raw)) continue;
        const identity = raw.identity;
        const sameScope =
          identity.reading.site === reading.site &&
          identity.targetLanguage === targetLanguage &&
          (fromPage !== undefined
            ? identity.reading.chapterId === reading.chapterId && identity.pageIndex >= fromPage
            : reading.seriesId
              ? identity.reading.seriesId === reading.seriesId
              : identity.reading.chapterId === reading.chapterId);
        if (!sameScope) continue;
        this.memory.delete(key);
        this.memoryOnly.delete(key);
        if (isReplayRecord(all[key])) updates[key] = { ...all[key], invalidated: true };
      }
      if (Object.keys(updates).length) {
        await this.write(updates);
        Object.assign(all, updates);
      }
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      this.memory.clear();
      this.memoryOnly.clear();
      this.generation = globalThis.crypto.randomUUID();
      this.scopeGenerations.clear();
      this.pageGenerations.clear();
      const all = await this.initialize();
      const stored = await this.read();
      const keys = [
        ...new Set(
          [...Object.keys(all), ...Object.keys(stored)].filter((key) =>
            key.startsWith('koma_cache:')
          )
        ),
      ];
      await this.remove(keys);
      for (const key of keys) delete all[key];
    });
  }

  size(): Promise<number> {
    return this.serial(async () => {
      const all = await this.initialize();
      return new Set([
        ...this.memory.keys(),
        ...Object.keys(all).filter((k) => k.startsWith(REPLAY_PREFIX)),
      ]).size;
    });
  }

  private async initialize(): Promise<Record<string, unknown>> {
    if (this.all) return this.all;
    if (!this.initialization) {
      const initialization = this.read().then(async (stored) => {
        const all: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(stored)) {
          if (key.startsWith(REPLAY_PREFIX) || key.startsWith('koma_cache:koma:cache:v1:')) {
            all[key] = value;
          } else {
            const bytes = serializedBytes(key, value);
            this.storageByteCounts.set(key, bytes);
            this.unrelatedStorageBytes += bytes;
          }
        }

        const stale = Object.keys(all).filter(
          (key) =>
            key.startsWith('koma_cache:koma:cache:v1:') ||
            (key.startsWith(REPLAY_PREFIX) &&
              (!isReplayRecord(all[key]) || serializedBytes(key, all[key]) > this.maxRecordBytes))
        );
        await this.remove(stale);
        for (const key of stale) delete all[key];

        this.all = all;
        const changedKeys = [...this.pendingStorageKeys];
        this.pendingStorageKeys.clear();
        if (changedKeys.length) {
          const latest = await this.read(changedKeys);
          for (const key of changedKeys) {
            this.applyStorageChange(key, latest[key], latest[key] === undefined);
          }
        }
        await this.evict(all, '');
        return all;
      });
      this.initialization = initialization.catch((error: unknown) => {
        this.all = undefined;
        this.initialization = undefined;
        this.storageByteCounts.clear();
        this.unrelatedStorageBytes = 0;
        throw error;
      });
    }
    return this.initialization!;
  }

  private applyStorageChange(key: string, value: unknown, removed: boolean): void {
    if (!this.all) return;
    if (key.startsWith(REPLAY_PREFIX)) {
      if (removed) delete this.all[key];
      else this.all[key] = value;
      return;
    }

    const previousBytes = this.storageByteCounts.get(key) ?? 0;
    this.unrelatedStorageBytes -= previousBytes;
    this.storageByteCounts.delete(key);
    if (!removed) {
      const bytes = serializedBytes(key, value);
      this.storageByteCounts.set(key, bytes);
      this.unrelatedStorageBytes += bytes;
    }
  }

  private chapterScopeKey(reading: ReadingIdentity, targetLanguage: string): string {
    return JSON.stringify(['chapter', reading.site, targetLanguage, reading.chapterId]);
  }

  private seriesScopeKey(reading: ReadingIdentity, targetLanguage: string): string {
    return JSON.stringify(['series', reading.site, targetLanguage, reading.seriesId]);
  }

  private generationFor(identity: ReplayIdentity): string {
    const { reading } = identity;
    const chapterKey = this.chapterScopeKey(reading, identity.targetLanguage);
    const pageGenerations = [...(this.pageGenerations.get(chapterKey) ?? [])]
      .filter(([fromPage]) => identity.pageIndex >= fromPage)
      .sort(([left], [right]) => left - right);
    return JSON.stringify([
      this.generation,
      reading.seriesId
        ? (this.scopeGenerations.get(this.seriesScopeKey(reading, identity.targetLanguage)) ?? 0)
        : 0,
      this.scopeGenerations.get(chapterKey) ?? 0,
      pageGenerations,
    ]);
  }

  private nextTimestamp(all: Record<string, unknown>): number {
    const latest = Object.values(all).reduce<number>(
      (n, v) => (isReplayRecord(v) ? Math.max(n, v.lastAccessedAt) : n),
      0
    );
    this.timestamp = Math.max(Date.now(), this.timestamp + 1, latest + 1);
    return this.timestamp;
  }

  private records(all: Record<string, unknown>): [string, ReplayRecord][] {
    return Object.entries(all)
      .filter(
        (pair): pair is [string, ReplayRecord] =>
          pair[0].startsWith(REPLAY_PREFIX) && isReplayRecord(pair[1])
      )
      .sort(
        ([a, x], [b, y]) => x.lastAccessedAt - y.lastAccessedAt || (a < b ? -1 : a > b ? 1 : 0)
      );
  }

  private async evict(all: Record<string, unknown>, protectedKey: string): Promise<void> {
    const records = this.records(all);
    const budget = Math.min(
      this.maxBytes,
      Math.max(0, Math.floor(this.quotaBytes * 0.8) - this.unrelatedStorageBytes)
    );
    let bytes = records.reduce((n, [k, v]) => n + serializedBytes(k, v), 0);
    let count = records.length;
    const removed: string[] = [];
    for (const [key, value] of records) {
      if (count <= this.maxRecords && bytes <= budget) break;
      if (key === protectedKey) continue;
      removed.push(key);
      count--;
      bytes -= serializedBytes(key, value);
    }
    if (removed.length) {
      await this.remove(removed);
      for (const key of removed) {
        delete all[key];
        this.memory.delete(key);
        this.memoryOnly.delete(key);
      }
    }
    if (bytes > budget) throw new Error('Cache budget is exhausted.');
  }

  private remember(key: string, record: ReplayRecord): void {
    this.memory.delete(key);
    this.memory.set(key, structuredClone(record));
    while (this.memory.size > this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value!;
      this.memory.delete(oldest);
      this.memoryOnly.delete(oldest);
    }
  }

  private storageCall<T>(invoke: (done: (value: T) => void) => Promise<T> | void): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value: T, error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      try {
        const result = invoke((value) =>
          done(value, typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined)
        );
        result?.then((value) => done(value)).catch((error) => done(undefined as T, error));
      } catch (error) {
        done(undefined as T, error);
      }
    });
  }

  private read(keys: string[] | null = null): Promise<Record<string, unknown>> {
    const area = this.options.storageArea;
    return area ? this.storageCall((done) => area.get(keys, done)) : Promise.resolve({});
  }

  private write(values: Record<string, unknown>): Promise<void> {
    const area = this.options.storageArea;
    return area
      ? this.storageCall<void>((done) => area.set(values, () => done(undefined)))
      : Promise.resolve();
  }

  private remove(keys: string[]): Promise<void> {
    const area = this.options.storageArea;
    return area && keys.length
      ? this.storageCall<void>((done) => area.remove(keys, () => done(undefined)))
      : Promise.resolve();
  }
}
