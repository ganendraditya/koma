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
  private initialized = false;
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
      if (raw === undefined) return { record: null, generation: this.generation, warning };
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
          } catch {
            warning = CACHE_PERSISTENCE_WARNING;
          }
        }
        return { record: null, generation: this.generation, warning };
      }
      const record = structuredClone(raw);
      record.lastAccessedAt = this.nextTimestamp(all);
      this.remember(key, record);
      if (!this.memoryOnly.has(key) && all[key] !== undefined) {
        try {
          await this.write({ [key]: record });
        } catch {
          warning = CACHE_PERSISTENCE_WARNING;
        }
      }
      return { record: structuredClone(record), generation: this.generation, warning };
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
      if (generation !== this.generation) return { warning: CACHE_STALE_WARNING };
      if (!isReplayRecord(record)) return { warning: CACHE_PERSISTENCE_WARNING };
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
        await this.evict({ ...all, [key]: clean }, key);
      } catch {
        return { warning: CACHE_PERSISTENCE_WARNING };
      }
      try {
        await this.write({ [key]: clean });
        this.memoryOnly.delete(key);
        return {};
      } catch {
        // One bounded retry after evicting another cache record; unrelated storage is never removed.
        const remaining = await this.read().catch(() => ({}));
        const oldest = this.records(remaining).filter(([k]) => k !== key)[0];
        if (oldest) {
          try {
            await this.remove([oldest[0]]);
            this.memory.delete(oldest[0]);
            this.memoryOnly.delete(oldest[0]);
            await this.write({ [key]: clean });
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
      this.generation = globalThis.crypto.randomUUID();
      const all = await this.initialize();
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
      if (Object.keys(updates).length) await this.write(updates);
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      this.memory.clear();
      this.memoryOnly.clear();
      this.generation = globalThis.crypto.randomUUID();
      const all = await this.read();
      const keys = Object.keys(all).filter((k) => k.startsWith('koma_cache:'));
      await this.remove(keys);
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
    const all = await this.read();
    if (!this.initialized) {
      const stale = Object.keys(all).filter(
        (k) =>
          k.startsWith('koma_cache:koma:cache:v1:') ||
          (k.startsWith(REPLAY_PREFIX) &&
            (!isReplayRecord(all[k]) || serializedBytes(k, all[k]) > this.maxRecordBytes))
      );
      await this.remove(stale);
      for (const key of stale) delete all[key];
      await this.evict(all, '');
      this.initialized = true;
    }
    return all;
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
    const unrelated = Object.entries(all)
      .filter(([k]) => !k.startsWith(REPLAY_PREFIX))
      .reduce((n, [k, v]) => n + serializedBytes(k, v), 0);
    const budget = Math.min(
      this.maxBytes,
      Math.max(0, Math.floor(this.quotaBytes * 0.8) - unrelated)
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

  private read(): Promise<Record<string, unknown>> {
    const area = this.options.storageArea;
    return area ? this.storageCall((done) => area.get(null, done)) : Promise.resolve({});
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
