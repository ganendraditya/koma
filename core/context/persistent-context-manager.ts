import { ContextManagerOptions } from './types';
import { ContextManager } from './context-manager';
import { ContextScope, ContextSnapshot, DialogueContributionSnapshot } from './types';
import {
  ContextStore,
  ContextStorePort,
  DialogueChange,
  GlossaryChange,
  StoredContextSnapshot,
  createContextScopeId,
} from './context-store';

interface PersistentContextManagerOptions extends ContextManagerOptions {
  store?: ContextStorePort;
}

interface ActiveScopeIds {
  chapter: string;
  glossary: string;
}

interface ScopeWriteState {
  chapterGeneration: number;
  glossaryGeneration: number;
  glossaryRevision: number;
  replayRevision?: string;
  localGlossary: ContextSnapshot['glossary'];
  localDialogue: DialogueContributionSnapshot[];
}

function cloneDialogue(
  contributions: DialogueContributionSnapshot[]
): DialogueContributionSnapshot[] {
  return contributions.map((contribution) => ({
    ...contribution,
    entries: contribution.entries.map((entry) => ({ ...entry })),
  }));
}

function glossaryChanges(
  previous: ContextSnapshot['glossary'],
  next: ContextSnapshot['glossary'],
  source: GlossaryChange['source']
): GlossaryChange[] {
  const before = new Map(previous.map((entry) => [entry.original, entry]));
  const after = new Map(next.map((entry) => [entry.original, entry]));
  const originals = new Set([...before.keys(), ...after.keys()]);
  const changes: GlossaryChange[] = [];
  for (const original of originals) {
    const expected = before.get(original) ?? null;
    const value = after.get(original) ?? null;
    if (JSON.stringify(expected) === JSON.stringify(value)) continue;
    changes.push({
      original,
      expected: expected ? { ...expected } : null,
      next: value ? { ...value } : null,
      source,
    });
  }
  return changes;
}

function dialogueChanges(
  previous: DialogueContributionSnapshot[],
  next: DialogueContributionSnapshot[]
): DialogueChange[] {
  const before = new Map(previous.map((entry) => [entry.imageId, entry]));
  const after = new Map(next.map((entry) => [entry.imageId, entry]));
  const imageIds = new Set([...before.keys(), ...after.keys()]);
  const changes: DialogueChange[] = [];
  for (const imageId of imageIds) {
    const expected = before.get(imageId) ?? null;
    const value = after.get(imageId) ?? null;
    if (JSON.stringify(expected) === JSON.stringify(value)) continue;
    changes.push({
      imageId,
      expected: expected
        ? { ...expected, entries: expected.entries.map((entry) => ({ ...entry })) }
        : null,
      next: value ? { ...value, entries: value.entries.map((entry) => ({ ...entry })) } : null,
    });
  }
  return changes;
}

function makeScopeWriteState(
  chapterRecord: StoredContextSnapshot | null,
  glossaryRecord: StoredContextSnapshot | null,
  initial: ContextSnapshot
): ScopeWriteState {
  return {
    chapterGeneration: chapterRecord?.scopeGeneration ?? 0,
    glossaryGeneration: glossaryRecord?.scopeGeneration ?? 0,
    glossaryRevision: glossaryRecord?.glossaryRevision ?? 0,
    replayRevision: glossaryRecord?.replayRevision ?? initial.replayRevision,
    localGlossary: (glossaryRecord?.glossary ?? initial.glossary).map((entry) => ({ ...entry })),
    localDialogue: cloneDialogue(
      chapterRecord?.dialogueContributions ?? initial.dialogueContributions
    ),
  };
}

export class PersistentContextManager extends ContextManager {
  private readonly store: ContextStorePort;
  private readonly initialSnapshot: ContextSnapshot;
  private activeScopeIds?: ActiveScopeIds;
  private scopeSignature = '';
  private generation = 0;
  private loading: Promise<void> = Promise.resolve();
  private readonly scopeLoads = new Map<string, Promise<void>>();
  private readonly scopeResets = new Map<string, Promise<void>>();
  private writes: Promise<void> = Promise.resolve();
  private readonly pendingUserWrites: Promise<void>[] = [];
  private readonly scopeWriteStates = new Map<string, ScopeWriteState>();
  private commits: Promise<void> = Promise.resolve();
  private activeCommit?: { signature: string; resetRequested: boolean };

  constructor(options: PersistentContextManagerOptions = {}) {
    const { store, ...managerOptions } = options;
    super(managerOptions);
    this.store = store ?? new ContextStore();
    this.initialSnapshot = super.exportSnapshot();
  }

  setScope(scope?: ContextScope): Promise<void> {
    const nextIds = this.getScopeIds(scope);
    const nextSignature = nextIds ? `${nextIds.chapter}\n${nextIds.glossary}` : '';
    if (nextSignature === this.scopeSignature) return this.ready();

    const generation = ++this.generation;
    this.scopeSignature = nextSignature;
    this.activeScopeIds = nextIds;
    const targetLanguage =
      typeof scope?.targetLanguage === 'string' ? scope.targetLanguage.trim() : '';
    this.targetLanguage = targetLanguage || undefined;
    super.reset();
    super.restoreSnapshot(this.initialSnapshot);

    if (!nextIds) {
      this.loading = Promise.resolve();
      return this.loading;
    }

    const resetBarrier = this.scopeResets.get(nextSignature);
    const loading = (async () => {
      try {
        if (resetBarrier) await resetBarrier;
        if (generation !== this.generation) return;

        const chapterPromise = this.store.load(nextIds.chapter);
        const glossaryPromise =
          nextIds.glossary === nextIds.chapter ? chapterPromise : this.store.load(nextIds.glossary);
        const [chapterRecord, glossaryRecord] = await Promise.all([
          chapterPromise,
          glossaryPromise,
        ]);
        if (generation !== this.generation) return;

        const initial = super.exportSnapshot();
        super.restoreSnapshot({
          schemaVersion: 1,
          replayRevision: glossaryRecord?.replayRevision ?? initial.replayRevision,
          dialogueContributions:
            chapterRecord?.dialogueContributions ?? initial.dialogueContributions,
          glossary: glossaryRecord?.glossary ?? initial.glossary,
        } satisfies ContextSnapshot);
        this.scopeWriteStates.set(
          nextSignature,
          makeScopeWriteState(chapterRecord, glossaryRecord, initial)
        );
      } catch {
        // A storage read failure leaves the in-memory context usable and empty for this scope.
        this.scopeWriteStates.set(
          nextSignature,
          makeScopeWriteState(null, null, this.initialSnapshot)
        );
      }
    })();

    this.loading = loading;
    this.scopeLoads.set(nextSignature, loading);
    void loading
      .finally(() => {
        if (this.scopeLoads.get(nextSignature) === loading) this.scopeLoads.delete(nextSignature);
      })
      .catch(() => undefined);
    return loading;
  }

  ready(): Promise<void> {
    return this.loading;
  }

  async flush(): Promise<void> {
    await this.loading;
    await this.writes;
    const pending = this.pendingUserWrites.splice(0);
    const errors: unknown[] = [];
    await Promise.all(
      pending.map((write) =>
        write.catch((error) => {
          errors.push(error);
        })
      )
    );
    if (errors.length) throw errors[0];
  }

  override recordTranslation(result: unknown, pageIndex?: number, imageId?: string): void {
    super.recordTranslation(result, pageIndex, imageId);
    this.scheduleWrite('model');
  }

  override commitTranslation(
    result: unknown,
    pageIndex?: number,
    imageId?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const commit = this.commits.then(() =>
      this.commitTranslationNow(result, pageIndex, imageId, signal)
    );
    this.commits = commit.catch(() => undefined);
    return commit;
  }

  override addGlossaryEntry(entry: Parameters<ContextManager['addGlossaryEntry']>[0]): boolean {
    const added = super.addGlossaryEntry(entry);
    if (added) this.scheduleWrite('user');
    return added;
  }

  override removeGlossaryEntry(original: string): boolean {
    const removed = super.removeGlossaryEntry(original);
    if (removed) this.scheduleWrite('user');
    return removed;
  }

  override clearGlossary(): void {
    super.clearGlossary();
    this.scheduleWrite('user');
  }

  override setMaxDialogueEntries(max: number): void {
    super.setMaxDialogueEntries(max);
    this.scheduleWrite('user');
  }

  override reset(): Promise<void> {
    const scopeIds = this.activeScopeIds;
    const previousLoading = this.loading;
    const signature = scopeIds ? `${scopeIds.chapter}\n${scopeIds.glossary}` : '';
    if (signature && this.activeCommit?.signature === signature)
      this.activeCommit.resetRequested = true;
    ++this.generation;
    super.reset();

    const cleanup = this.writes.then(async () => {
      await previousLoading;
      if (scopeIds) {
        await this.store.remove([scopeIds.chapter, scopeIds.glossary]);
        await this.refreshWriteState(signature, scopeIds);
      }
    });
    if (signature) {
      this.scopeResets.set(signature, cleanup);
      void cleanup
        .finally(() => {
          if (this.scopeResets.get(signature) === cleanup) this.scopeResets.delete(signature);
        })
        .catch(() => undefined);
    }
    this.writes = cleanup.catch(() => undefined);
    return cleanup;
  }

  resetScope(scope: ContextScope): Promise<void> {
    const scopeIds = this.getScopeIds(scope);
    if (!scopeIds) return Promise.reject(new Error('Cannot reset context without a valid scope.'));

    const signature = `${scopeIds.chapter}\n${scopeIds.glossary}`;
    if (this.activeCommit?.signature === signature) this.activeCommit.resetRequested = true;
    const active = this.scopeSignature === signature;
    const pendingLoads = new Set<Promise<void>>();
    const pendingScopeLoad = this.scopeLoads.get(signature);
    if (pendingScopeLoad) pendingLoads.add(pendingScopeLoad);
    if (active) {
      pendingLoads.add(this.loading);
      ++this.generation;
      super.reset();
    }

    const cleanup = this.writes.then(async () => {
      await Promise.all(pendingLoads);
      await this.store.remove([scopeIds.chapter, scopeIds.glossary]);
      if (active) await this.refreshWriteState(signature, scopeIds);
    });
    this.scopeResets.set(signature, cleanup);
    this.writes = cleanup.catch(() => undefined);
    void cleanup
      .finally(() => {
        if (this.scopeResets.get(signature) === cleanup) this.scopeResets.delete(signature);
      })
      .catch(() => undefined);
    return cleanup;
  }

  private getScopeIds(scope?: ContextScope): ActiveScopeIds | undefined {
    const reading = scope?.reading;
    const targetLanguage =
      typeof scope?.targetLanguage === 'string' ? scope.targetLanguage.trim() : '';
    if (
      !reading ||
      typeof reading.site !== 'string' ||
      !reading.site.trim() ||
      typeof reading.chapterId !== 'string' ||
      !reading.chapterId.trim() ||
      !targetLanguage
    )
      return undefined;

    const site = reading.site.trim().toLowerCase();
    const seriesId = typeof reading.seriesId === 'string' ? reading.seriesId.trim() : '';
    const chapter = createContextScopeId({
      kind: 'chapter',
      site,
      seriesId: seriesId || undefined,
      chapterId: reading.chapterId.trim(),
      targetLanguage,
    });
    const glossary = seriesId
      ? createContextScopeId({ kind: 'series', site, seriesId, targetLanguage })
      : chapter;
    return { chapter, glossary };
  }

  private scheduleWrite(source: GlossaryChange['source']): Promise<void> | undefined {
    const scopeIds = this.activeScopeIds;
    if (!scopeIds) return undefined;

    const snapshot = super.exportSnapshot();
    const write = this.enqueueSnapshotWrite(
      scopeIds,
      snapshot,
      this.loading,
      this.scopeSignature,
      source
    );
    if (source === 'user') this.pendingUserWrites.push(write);
    return write;
  }

  private async commitTranslationNow(
    result: unknown,
    pageIndex: number | undefined,
    imageId: string | undefined,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    const previous = super.exportSnapshot();
    const scopeIds = this.activeScopeIds ? { ...this.activeScopeIds } : undefined;
    const signature = this.scopeSignature;
    const generation = this.generation;
    const transaction = { signature, resetRequested: false };
    this.activeCommit = transaction;

    try {
      super.recordTranslation(result, pageIndex, imageId);
      if (scopeIds)
        await this.enqueueSnapshotWrite(
          scopeIds,
          super.exportSnapshot(),
          this.loading,
          signature,
          'model'
        );
      signal?.throwIfAborted();
    } catch (error) {
      if (
        !transaction.resetRequested &&
        generation === this.generation &&
        signature === this.scopeSignature
      ) {
        super.restoreSnapshot(previous);
      }
      if (scopeIds && !transaction.resetRequested) {
        await this.enqueueSnapshotWrite(
          scopeIds,
          previous,
          Promise.resolve(),
          signature,
          'model'
        ).catch(() => undefined);
      }
      if (signal?.aborted) throw error;
    } finally {
      if (this.activeCommit === transaction) this.activeCommit = undefined;
    }
  }

  private enqueueSnapshotWrite(
    scopeIds: ActiveScopeIds,
    snapshot: ContextSnapshot,
    readiness: Promise<void>,
    signature: string,
    source: GlossaryChange['source']
  ): Promise<void> {
    const write = this.writes.then(async () => {
      await readiness;
      await this.saveSnapshot(scopeIds, snapshot, signature, source);
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private async saveSnapshot(
    scopeIds: ActiveScopeIds,
    snapshot: ContextSnapshot,
    signature: string,
    source: GlossaryChange['source']
  ): Promise<void> {
    const state = this.scopeWriteStates.get(signature);
    if (!state) throw new Error('Reading context has not finished loading.');
    const glossaryDelta = glossaryChanges(state.localGlossary, snapshot.glossary, source);
    const dialogueDelta = dialogueChanges(state.localDialogue, snapshot.dialogueContributions);
    const replayRevisionChanged = snapshot.replayRevision !== state.replayRevision;
    if (!glossaryDelta.length && !dialogueDelta.length && !replayRevisionChanged) return;

    const result = await this.store.saveContext(scopeIds, {
      dialogueChanges: dialogueDelta,
      glossaryChanges: glossaryDelta,
      replayRevision: snapshot.replayRevision,
      expectedGlossaryRevision: state.glossaryRevision,
      expectedChapterGeneration: state.chapterGeneration,
      expectedGlossaryGeneration: state.glossaryGeneration,
      maxDialogueEntries: this.getMaxDialogueEntries(),
    });
    state.localGlossary = result.glossary.map((entry) => ({ ...entry }));
    state.localDialogue = cloneDialogue(snapshot.dialogueContributions);
    state.glossaryRevision = result.glossaryRevision ?? 0;
    state.replayRevision = result.replayRevision ?? state.replayRevision;
    if (
      signature === this.scopeSignature &&
      snapshot.replayRevision === super.getReplayRevision() &&
      result.replayRevision
    )
      super.setReplayRevision(result.replayRevision);
  }

  private async refreshWriteState(signature: string, scopeIds: ActiveScopeIds): Promise<void> {
    const chapterPromise = this.store.load(scopeIds.chapter);
    const glossaryPromise =
      scopeIds.chapter === scopeIds.glossary ? chapterPromise : this.store.load(scopeIds.glossary);
    const [chapterRecord, glossaryRecord] = await Promise.all([chapterPromise, glossaryPromise]);
    this.scopeWriteStates.set(
      signature,
      makeScopeWriteState(chapterRecord, glossaryRecord, this.initialSnapshot)
    );
  }
}
