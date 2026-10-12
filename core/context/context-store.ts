import { GlossaryEntry } from '@core/contracts';
import { DialogueContributionSnapshot } from './types';

export interface ContextStorageArea {
  get(
    keys: string[] | null,
    callback?: (items: Record<string, unknown>) => void
  ): Promise<Record<string, unknown>> | void;
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void;
  remove(keys: string | string[], callback?: () => void): Promise<void> | void;
}

export interface ContextStoreScope {
  kind: 'chapter' | 'series';
  site: string;
  seriesId?: string;
  chapterId?: string;
  targetLanguage: string;
}

export interface StoredContextSnapshot {
  schemaVersion: 1;
  replayRevision?: string;
  lastAccessedAt: number;
  dialogueContributions: DialogueContributionSnapshot[];
  glossary: GlossaryEntry[];
}

export interface ContextStoreOptions {
  storageArea?: ContextStorageArea;
  maxScopes?: number;
  storagePrefix?: string;
}

const DEFAULT_MAX_SCOPES = 50;
const DEFAULT_STORAGE_PREFIX = 'koma_context:v1:';

function isGlossaryEntry(value: unknown): value is GlossaryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<GlossaryEntry>;
  return (
    typeof entry.original === 'string' &&
    Boolean(entry.original.trim()) &&
    typeof entry.translation === 'string' &&
    Boolean(entry.translation.trim()) &&
    (entry.isHard === undefined || typeof entry.isHard === 'boolean')
  );
}

function isDialogueContribution(value: unknown): value is DialogueContributionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const contribution = value as Partial<DialogueContributionSnapshot>;
  return (
    typeof contribution.imageId === 'string' &&
    Boolean(contribution.imageId.trim()) &&
    (contribution.pageIndex === undefined ||
      (Number.isSafeInteger(contribution.pageIndex) && contribution.pageIndex! >= 0)) &&
    Number.isSafeInteger(contribution.order) &&
    contribution.order! >= 0 &&
    Array.isArray(contribution.entries) &&
    contribution.entries.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof entry.translatedText === 'string' &&
        Boolean(entry.translatedText.trim()) &&
        (entry.speaker === undefined || typeof entry.speaker === 'string') &&
        (entry.sourceText === undefined || typeof entry.sourceText === 'string') &&
        (entry.pageIndex === undefined ||
          (Number.isSafeInteger(entry.pageIndex) && entry.pageIndex >= 0))
    )
  );
}

function isStoredContextSnapshot(value: unknown): value is StoredContextSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<StoredContextSnapshot>;
  return (
    snapshot.schemaVersion === 1 &&
    (snapshot.replayRevision === undefined || typeof snapshot.replayRevision === 'string') &&
    typeof snapshot.lastAccessedAt === 'number' &&
    Number.isFinite(snapshot.lastAccessedAt) &&
    Array.isArray(snapshot.dialogueContributions) &&
    snapshot.dialogueContributions.every(isDialogueContribution) &&
    Array.isArray(snapshot.glossary) &&
    snapshot.glossary.every(isGlossaryEntry)
  );
}

function getChromeStorageArea(): ContextStorageArea | undefined {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
  return chrome.storage.local as unknown as ContextStorageArea;
}

export function createContextScopeId(scope: ContextStoreScope): string {
  return encodeURIComponent(
    JSON.stringify([
      scope.kind,
      scope.site.trim().toLowerCase(),
      scope.seriesId?.trim().toLowerCase() || null,
      scope.chapterId?.trim().toLowerCase() || null,
      scope.targetLanguage.trim().toLowerCase(),
    ])
  );
}

export class ContextStore {
  private readonly storageArea?: ContextStorageArea;
  private readonly maxScopes: number;
  private readonly storagePrefix: string;
  private lastAccessedAt = 0;

  constructor(options: ContextStoreOptions = {}) {
    this.storageArea = options.storageArea ?? getChromeStorageArea();
    this.maxScopes = Number.isFinite(options.maxScopes)
      ? Math.max(1, Math.floor(options.maxScopes!))
      : DEFAULT_MAX_SCOPES;
    this.storagePrefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  }

  async load(scopeId: string): Promise<StoredContextSnapshot | null> {
    if (!this.storageArea) return null;
    const storageKey = this.getStorageKey(scopeId);
    const raw = await this.readStorageKey(storageKey);
    if (raw === undefined) return null;
    if (!isStoredContextSnapshot(raw)) {
      await this.removeStorageKeys(storageKey);
      return null;
    }

    const snapshot = this.cloneSnapshot({
      ...raw,
      lastAccessedAt: await this.nextAccessTime(),
    });
    await this.writeStorageKey(storageKey, snapshot);
    return snapshot;
  }

  async save(
    scopeId: string,
    sections:
      | Pick<StoredContextSnapshot, 'dialogueContributions' | 'glossary' | 'replayRevision'>
      | Partial<
          Pick<StoredContextSnapshot, 'dialogueContributions' | 'glossary' | 'replayRevision'>
        >
  ): Promise<void> {
    if (!this.storageArea) return;
    const storageKey = this.getStorageKey(scopeId);
    const raw = await this.readStorageKey(storageKey);
    const existing = isStoredContextSnapshot(raw) ? raw : undefined;
    if (raw !== undefined && !existing) await this.removeStorageKeys(storageKey);

    const snapshot: StoredContextSnapshot = {
      schemaVersion: 1,
      replayRevision: sections.replayRevision ?? existing?.replayRevision,
      lastAccessedAt: await this.nextAccessTime(),
      dialogueContributions: sections.dialogueContributions
        ? sections.dialogueContributions.map((contribution) => ({
            ...contribution,
            entries: contribution.entries.map((entry) => ({ ...entry })),
          }))
        : (existing?.dialogueContributions ?? []),
      glossary: sections.glossary
        ? sections.glossary.map((entry) => ({ ...entry }))
        : (existing?.glossary ?? []),
    };

    await this.writeStorageKey(storageKey, snapshot);
    await this.prune();
  }

  async remove(scopeIds: string[]): Promise<void> {
    const keys = [...new Set(scopeIds)].map((scopeId) => this.getStorageKey(scopeId));
    if (keys.length) await this.removeStorageKeys(keys);
  }

  private getStorageKey(scopeId: string): string {
    return `${this.storagePrefix}${scopeId}`;
  }

  private async nextAccessTime(): Promise<number> {
    const items = await this.readAllStorage();
    const latestStoredTime = items
      ? Object.entries(items)
          .filter(([key]) => key.startsWith(this.storagePrefix))
          .reduce((latest, [, value]) => {
            if (!isStoredContextSnapshot(value)) return latest;
            return Math.max(latest, value.lastAccessedAt);
          }, 0)
      : 0;
    this.lastAccessedAt = Math.max(Date.now(), this.lastAccessedAt + 1, latestStoredTime + 1);
    return this.lastAccessedAt;
  }

  private cloneSnapshot(snapshot: StoredContextSnapshot): StoredContextSnapshot {
    return {
      schemaVersion: 1,
      replayRevision: snapshot.replayRevision,
      lastAccessedAt: snapshot.lastAccessedAt,
      dialogueContributions: snapshot.dialogueContributions.map((contribution) => ({
        ...contribution,
        entries: contribution.entries.map((entry) => ({ ...entry })),
      })),
      glossary: snapshot.glossary.map((entry) => ({ ...entry })),
    };
  }

  private async prune(): Promise<void> {
    const items = await this.readAllStorage();
    if (!items) return;

    const records = Object.entries(items)
      .filter(([key]) => key.startsWith(this.storagePrefix))
      .map(([key, value]) => ({ key, value }));
    const corruptKeys = records.filter(({ value }) => !isStoredContextSnapshot(value));
    if (corruptKeys.length) await this.removeStorageKeys(corruptKeys.map(({ key }) => key));

    const validRecords = records
      .filter(({ value }) => isStoredContextSnapshot(value))
      .sort((a, b) => {
        const left = a.value as StoredContextSnapshot;
        const right = b.value as StoredContextSnapshot;
        return left.lastAccessedAt - right.lastAccessedAt || a.key.localeCompare(b.key);
      });
    const excess = validRecords.length - this.maxScopes;
    if (excess > 0) {
      await this.removeStorageKeys(validRecords.slice(0, excess).map(({ key }) => key));
    }
  }

  private async readStorageKey(storageKey: string): Promise<unknown> {
    if (!this.storageArea) return undefined;
    const items = await this.getItems([storageKey]);
    return items?.[storageKey];
  }

  private async readAllStorage(): Promise<Record<string, unknown> | undefined> {
    return this.getItems(null);
  }

  private getItems(keys: string[] | null): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (items?: Record<string, unknown>, error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(items);
      };

      try {
        const result = this.storageArea?.get(keys, (items) => {
          finish(items, this.getStorageError());
        });
        if (result && typeof result.then === 'function') {
          result.then((items) => finish(items)).catch((error) => finish(undefined, error));
        }
        if (!this.storageArea) finish();
      } catch (error) {
        finish(undefined, error);
      }
    });
  }

  private writeStorageKey(storageKey: string, value: StoredContextSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = this.storageArea?.set({ [storageKey]: value }, () => {
          finish(this.getStorageError());
        });
        if (result && typeof result.then === 'function') {
          result.then(() => finish()).catch((error) => finish(error));
        }
        if (!this.storageArea) finish();
      } catch (error) {
        finish(error);
      }
    });
  }

  private getStorageError(): Error | undefined {
    if (typeof chrome === 'undefined') return undefined;
    const lastError = chrome.runtime?.lastError;
    return lastError
      ? new Error(lastError.message || 'Context storage operation failed.')
      : undefined;
  }

  private removeStorageKeys(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = this.storageArea?.remove(keys, () => {
          const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined;
          finish(
            lastError
              ? new Error(lastError.message || 'Context storage removal failed.')
              : undefined
          );
        });
        if (result && typeof result.then === 'function') result.then(() => finish()).catch(finish);
        if (!this.storageArea) finish();
      } catch (error) {
        finish(error);
      }
    });
  }
}
