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
  scopeGeneration?: number;
  glossaryRevision?: number;
  glossaryHistory?: GlossaryHistoryEntry[];
  replayRevision?: string;
  lastAccessedAt: number;
  dialogueContributions: DialogueContributionSnapshot[];
  glossary: GlossaryEntry[];
}

export interface GlossaryHistoryEntry {
  revision: number;
  original: string;
}

export interface GlossaryChange {
  original: string;
  expected: GlossaryEntry | null;
  next: GlossaryEntry | null;
  source: 'user' | 'model';
}

export interface DialogueChange {
  imageId: string;
  expected: DialogueContributionSnapshot | null;
  next: DialogueContributionSnapshot | null;
}

export interface ContextScopeIds {
  chapter: string;
  glossary: string;
}

export interface ContextWriteOptions {
  dialogueChanges: DialogueChange[];
  glossaryChanges: GlossaryChange[];
  replayRevision?: string;
  expectedGlossaryRevision: number;
  expectedChapterGeneration: number;
  expectedGlossaryGeneration: number;
  maxDialogueEntries: number;
}

export interface ContextStorePort {
  load(scopeId: string): Promise<StoredContextSnapshot | null>;
  saveContext(
    scopeIds: ContextScopeIds,
    options: ContextWriteOptions
  ): Promise<StoredContextSnapshot>;
  remove(scopeIds: string[]): Promise<void>;
}

export interface ContextStoreOptions {
  storageArea?: ContextStorageArea;
  maxScopes?: number;
  maxGlossaryEntries?: number;
  storagePrefix?: string;
}

const DEFAULT_MAX_SCOPES = 50;
const DEFAULT_STORAGE_PREFIX = 'koma_context:v1:';
const EPOCH_STORAGE_PREFIX = 'koma_context_epoch:v1:';
const MAX_GLOSSARY_HISTORY = 256;

export class ContextConflictError extends Error {
  readonly code = 'CONTEXT_CONFLICT';

  constructor(message = 'This glossary term changed in another tab. Reload before editing it.') {
    super(message);
    this.name = 'ContextConflictError';
  }
}

export class ContextScopeResetError extends Error {
  readonly code = 'CONTEXT_SCOPE_RESET';

  constructor() {
    super('This reading context was reset. Reload it before saving changes.');
    this.name = 'ContextScopeResetError';
  }
}

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
    (snapshot.scopeGeneration === undefined ||
      (Number.isSafeInteger(snapshot.scopeGeneration) && snapshot.scopeGeneration! >= 0)) &&
    (snapshot.glossaryRevision === undefined ||
      (Number.isSafeInteger(snapshot.glossaryRevision) && snapshot.glossaryRevision! >= 0)) &&
    (snapshot.glossaryHistory === undefined ||
      (Array.isArray(snapshot.glossaryHistory) &&
        snapshot.glossaryHistory.every(
          (entry) =>
            Boolean(entry) &&
            Number.isSafeInteger(entry.revision) &&
            entry.revision > 0 &&
            typeof entry.original === 'string' &&
            Boolean(entry.original)
        ))) &&
    (snapshot.replayRevision === undefined || typeof snapshot.replayRevision === 'string') &&
    typeof snapshot.lastAccessedAt === 'number' &&
    Number.isFinite(snapshot.lastAccessedAt) &&
    Array.isArray(snapshot.dialogueContributions) &&
    snapshot.dialogueContributions.every(isDialogueContribution) &&
    Array.isArray(snapshot.glossary) &&
    snapshot.glossary.every(isGlossaryEntry)
  );
}

function sameGlossaryEntry(
  left: GlossaryEntry | null | undefined,
  right: GlossaryEntry | null | undefined
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function cloneDialogueContribution(
  contribution: DialogueContributionSnapshot | null
): DialogueContributionSnapshot | null {
  return contribution
    ? { ...contribution, entries: contribution.entries.map((entry) => ({ ...entry })) }
    : null;
}

function sameDialogueContribution(
  left: DialogueContributionSnapshot | null | undefined,
  right: DialogueContributionSnapshot | null | undefined
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function emptySnapshot(scopeGeneration = 0): StoredContextSnapshot {
  return {
    schemaVersion: 1,
    scopeGeneration,
    glossaryRevision: 0,
    glossaryHistory: [],
    lastAccessedAt: 0,
    dialogueContributions: [],
    glossary: [],
  };
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
  private readonly maxGlossaryEntries: number;
  private readonly storagePrefix: string;
  private lastAccessedAt = 0;

  constructor(options: ContextStoreOptions = {}) {
    this.storageArea = options.storageArea ?? getChromeStorageArea();
    this.maxScopes = Number.isFinite(options.maxScopes)
      ? Math.max(1, Math.floor(options.maxScopes!))
      : DEFAULT_MAX_SCOPES;
    this.maxGlossaryEntries = Number.isFinite(options.maxGlossaryEntries)
      ? Math.max(1, Math.floor(options.maxGlossaryEntries!))
      : 50;
    this.storagePrefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  }

  load(scopeId: string): Promise<StoredContextSnapshot | null> {
    return this.loadNow(scopeId);
  }

  private async loadNow(scopeId: string): Promise<StoredContextSnapshot | null> {
    if (!this.storageArea) return null;
    const storageKey = this.getStorageKey(scopeId);
    const [raw, epoch] = await Promise.all([
      this.readStorageKey(storageKey),
      this.readEpoch(scopeId),
    ]);
    if (raw === undefined) {
      return epoch === undefined ? null : emptySnapshot(epoch);
    }
    if (!isStoredContextSnapshot(raw)) {
      await this.removeNow([scopeId]);
      return emptySnapshot((await this.readEpoch(scopeId)) ?? 0);
    }

    const scopeGeneration = Math.max(epoch ?? 0, raw.scopeGeneration ?? 0);
    if ((raw.scopeGeneration ?? 0) < scopeGeneration) return emptySnapshot(scopeGeneration);

    const snapshot = this.cloneSnapshot({
      ...raw,
      scopeGeneration,
      lastAccessedAt: await this.nextAccessTime(),
    });
    await this.writeStorageKey(storageKey, snapshot);
    return snapshot;
  }

  save(
    scopeId: string,
    sections:
      | Pick<StoredContextSnapshot, 'dialogueContributions' | 'glossary' | 'replayRevision'>
      | Partial<
          Pick<StoredContextSnapshot, 'dialogueContributions' | 'glossary' | 'replayRevision'>
        >
  ): Promise<void> {
    return this.saveNow(scopeId, sections);
  }

  private async saveNow(
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
    if (raw !== undefined && !existing) await this.removeNow([scopeId]);

    const snapshot: StoredContextSnapshot = {
      schemaVersion: 1,
      scopeGeneration: Math.max(
        existing?.scopeGeneration ?? 0,
        (await this.readEpoch(scopeId)) ?? 0
      ),
      glossaryRevision: existing?.glossaryRevision ?? 0,
      glossaryHistory: existing?.glossaryHistory ?? [],
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

  saveContext(
    scopeIds: ContextScopeIds,
    options: ContextWriteOptions
  ): Promise<StoredContextSnapshot> {
    return this.saveContextNow(scopeIds, options);
  }

  private async saveContextNow(
    scopeIds: ContextScopeIds,
    options: ContextWriteOptions
  ): Promise<StoredContextSnapshot> {
    if (!this.storageArea) return emptySnapshot(options.expectedGlossaryGeneration);

    const ids = [...new Set([scopeIds.chapter, scopeIds.glossary])];
    const records = new Map<string, StoredContextSnapshot>();
    for (const id of ids) {
      const raw = await this.readStorageKey(this.getStorageKey(id));
      const epoch = (await this.readEpoch(id)) ?? 0;
      const valid = isStoredContextSnapshot(raw) ? raw : undefined;
      const generation = Math.max(epoch, valid?.scopeGeneration ?? 0);
      if (id === scopeIds.chapter && generation !== options.expectedChapterGeneration)
        throw new ContextScopeResetError();
      if (id === scopeIds.glossary && generation !== options.expectedGlossaryGeneration)
        throw new ContextScopeResetError();
      records.set(
        id,
        valid && (valid.scopeGeneration ?? 0) === generation
          ? this.cloneSnapshot({ ...valid, scopeGeneration: generation })
          : emptySnapshot(generation)
      );
    }

    const chapterRecord = records.get(scopeIds.chapter)!;
    const glossaryRecord = records.get(scopeIds.glossary)!;
    const expectedRevision = options.expectedGlossaryRevision;
    const currentRevision = glossaryRecord.glossaryRevision ?? 0;
    if (expectedRevision > currentRevision) throw new ContextConflictError();
    const history = glossaryRecord.glossaryHistory ?? [];
    const historyUnavailable =
      expectedRevision < currentRevision &&
      (history.length === 0 || expectedRevision < history[0].revision - 1);
    if (historyUnavailable) {
      if (options.glossaryChanges.some((change) => change.source === 'user'))
        throw new ContextConflictError();
    }

    const glossary = new Map(
      glossaryRecord.glossary.map((entry) => [entry.original, { ...entry }])
    );
    const glossaryHistory = [...history];
    let glossaryRevision = currentRevision;
    let appliedUserGlossaryChange = false;
    for (const change of options.glossaryChanges) {
      const current = glossary.get(change.original) ?? null;
      const changedSinceRead = glossaryHistory.some(
        (entry) => entry.revision > expectedRevision && entry.original === change.original
      );
      const expectedMatches = sameGlossaryEntry(current, change.expected);
      if (change.source === 'model') {
        if (historyUnavailable) continue;
        if (current?.isHard && change.next && !change.next.isHard) continue;
        if (changedSinceRead || !expectedMatches) continue;
      } else if (changedSinceRead || !expectedMatches) {
        throw new ContextConflictError();
      }

      if (sameGlossaryEntry(current, change.next)) continue;
      if (change.next) {
        if (!current && glossary.size >= this.maxGlossaryEntries) {
          const oldestSoft = [...glossary.entries()].find(([, entry]) => !entry.isHard);
          if (oldestSoft) {
            glossary.delete(oldestSoft[0]);
            glossaryRevision++;
            glossaryHistory.push({ revision: glossaryRevision, original: oldestSoft[0] });
          } else if (change.source === 'model') {
            continue;
          } else {
            throw new Error(
              'The series glossary is full. Remove a pinned term before adding another one.'
            );
          }
        }
        glossary.set(change.original, { ...change.next, original: change.original });
      } else {
        glossary.delete(change.original);
      }
      if (change.source === 'user') appliedUserGlossaryChange = true;
      glossaryRevision++;
      glossaryHistory.push({ revision: glossaryRevision, original: change.original });
    }

    const dialogues = new Map(
      chapterRecord.dialogueContributions.map((contribution) => [
        contribution.imageId,
        contribution,
      ])
    );
    for (const change of options.dialogueChanges) {
      const current = dialogues.get(change.imageId) ?? null;
      if (
        !sameDialogueContribution(current, change.expected) &&
        !sameDialogueContribution(current, change.next)
      )
        continue;
      if (change.next) dialogues.set(change.imageId, cloneDialogueContribution(change.next)!);
      else dialogues.delete(change.imageId);
    }

    const allDialogue = [...dialogues.values()].sort((left, right) => {
      if (
        left.pageIndex !== undefined &&
        right.pageIndex !== undefined &&
        left.pageIndex !== right.pageIndex
      )
        return left.pageIndex - right.pageIndex;
      if (left.pageIndex === undefined && right.pageIndex !== undefined) return 1;
      if (left.pageIndex !== undefined && right.pageIndex === undefined) return -1;
      return left.order - right.order || left.imageId.localeCompare(right.imageId);
    });
    let count = allDialogue.reduce((total, contribution) => total + contribution.entries.length, 0);
    while (count > options.maxDialogueEntries && allDialogue.length) {
      const oldest = allDialogue[0];
      oldest.entries.shift();
      count--;
      if (!oldest.entries.length) allDialogue.shift();
    }

    const accessTime = await this.nextAccessTime();
    const replayRevision =
      (appliedUserGlossaryChange || !glossaryRecord.replayRevision) && options.replayRevision
        ? options.replayRevision
        : glossaryRecord.replayRevision;
    const chapterNext: StoredContextSnapshot = {
      ...chapterRecord,
      schemaVersion: 1,
      scopeGeneration: options.expectedChapterGeneration,
      replayRevision,
      lastAccessedAt: accessTime,
      dialogueContributions: allDialogue,
      ...(scopeIds.chapter === scopeIds.glossary
        ? {
            glossary: [...glossary.values()],
            replayRevision,
            glossaryRevision,
            glossaryHistory: glossaryHistory.slice(-MAX_GLOSSARY_HISTORY),
          }
        : {}),
    };
    const glossaryNext =
      scopeIds.chapter === scopeIds.glossary
        ? chapterNext
        : {
            ...glossaryRecord,
            schemaVersion: 1 as const,
            scopeGeneration: options.expectedGlossaryGeneration,
            glossaryRevision,
            glossaryHistory: glossaryHistory.slice(-MAX_GLOSSARY_HISTORY),
            replayRevision,
            lastAccessedAt: accessTime,
            glossary: [...glossary.values()],
          };
    const recordsToWrite: Record<string, StoredContextSnapshot> = {
      [this.getStorageKey(scopeIds.chapter)]: chapterNext,
      [this.getStorageKey(scopeIds.glossary)]: glossaryNext,
    };
    await this.writeStorageItems(recordsToWrite);
    await this.prune(new Set(ids));
    return this.cloneSnapshot(glossaryNext);
  }

  remove(scopeIds: string[]): Promise<void> {
    return this.removeNow(scopeIds);
  }

  private async removeNow(scopeIds: string[]): Promise<void> {
    if (!this.storageArea) return;
    const keys = [...new Set(scopeIds)].map((scopeId) => this.getStorageKey(scopeId));
    const uniqueIds = [...new Set(scopeIds)];
    if (!keys.length) return;

    const epochs: Record<string, number> = {};
    for (const scopeId of uniqueIds) {
      const raw = await this.readStorageKey(this.getStorageKey(scopeId));
      const storedGeneration = isStoredContextSnapshot(raw) ? (raw.scopeGeneration ?? 0) : 0;
      const epoch = (await this.readEpoch(scopeId)) ?? 0;
      epochs[this.getEpochKey(scopeId)] = Math.max(storedGeneration, epoch) + 1;
    }
    await this.writeStorageItems(epochs);
    await this.removeStorageKeys(keys);
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
      scopeGeneration: snapshot.scopeGeneration ?? 0,
      glossaryRevision: snapshot.glossaryRevision ?? 0,
      glossaryHistory: (snapshot.glossaryHistory ?? []).map((entry) => ({ ...entry })),
      replayRevision: snapshot.replayRevision,
      lastAccessedAt: snapshot.lastAccessedAt,
      dialogueContributions: snapshot.dialogueContributions.map((contribution) => ({
        ...contribution,
        entries: contribution.entries.map((entry) => ({ ...entry })),
      })),
      glossary: snapshot.glossary.map((entry) => ({ ...entry })),
    };
  }

  private async prune(protectedScopeIds = new Set<string>()): Promise<void> {
    const items = await this.readAllStorage();
    if (!items) return;

    const records = Object.entries(items)
      .filter(([key]) => key.startsWith(this.storagePrefix))
      .map(([key, value]) => ({ key, value }));
    const corruptKeys = records.filter(({ value }) => !isStoredContextSnapshot(value));
    if (corruptKeys.length) {
      await this.removeNow(corruptKeys.map(({ key }) => key.slice(this.storagePrefix.length)));
    }

    const validRecords = records
      .filter(({ value }) => isStoredContextSnapshot(value))
      .sort((a, b) => {
        const left = a.value as StoredContextSnapshot;
        const right = b.value as StoredContextSnapshot;
        return left.lastAccessedAt - right.lastAccessedAt || a.key.localeCompare(b.key);
      });
    const candidates = validRecords.filter(
      ({ key }) => !protectedScopeIds.has(key.slice(this.storagePrefix.length))
    );
    const excess = validRecords.length - this.maxScopes;
    if (excess > 0) {
      const evicted = candidates.slice(0, excess);
      await this.removeNow(evicted.map(({ key }) => key.slice(this.storagePrefix.length)));
    }
  }

  private getEpochKey(scopeId: string): string {
    return `${EPOCH_STORAGE_PREFIX}${this.storagePrefix}${scopeId}`;
  }

  private async readEpoch(scopeId: string): Promise<number | undefined> {
    const raw = await this.readStorageKey(this.getEpochKey(scopeId));
    return Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : undefined;
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
    return this.writeStorageItems({ [storageKey]: value });
  }

  private writeStorageItems(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = this.storageArea?.set(items, () => {
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
