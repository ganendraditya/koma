import {
  ContextStore,
  type ContextScopeIds,
  type ContextWriteOptions,
} from '@core/context/context-store';
import { EXTENSION_MESSAGE_TYPES } from '@shared/messages';

type ContextStorageRequest =
  | { type: string; operation: 'load'; scopeId: string }
  | {
      type: string;
      operation: 'saveContext';
      scopeIds: ContextScopeIds;
      options: ContextWriteOptions;
    }
  | { type: string; operation: 'remove'; scopeIds: string[] };

const store = new ContextStore({
  storageArea: chrome.storage.local,
  maxScopes: 50,
});
let contextQueue: Promise<void> = Promise.resolve();

function readerChapter(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return undefined;
  try {
    const url = new URL(sender.url ?? sender.tab?.url ?? '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !['mangadex.org', 'www.mangadex.org'].includes(url.hostname)
    )
      return undefined;
    return url.pathname.match(/^\/chapter\/([^/]+)(?:\/\d+)?\/?$/i)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function parseScopeId(scopeId: unknown): string[] | undefined {
  if (typeof scopeId !== 'string' || scopeId.length > 2048) return undefined;
  try {
    const parts = JSON.parse(decodeURIComponent(scopeId));
    if (
      Array.isArray(parts) &&
      parts.length === 5 &&
      (parts[0] === 'chapter' || parts[0] === 'series') &&
      parts[1] === 'mangadex' &&
      (parts[2] === null || typeof parts[2] === 'string') &&
      (parts[3] === null || typeof parts[3] === 'string') &&
      typeof parts[4] === 'string' &&
      parts[4].length > 0 &&
      ((parts[0] === 'chapter' && typeof parts[3] === 'string') ||
        (parts[0] === 'series' && typeof parts[2] === 'string'))
    )
      return parts;
  } catch {
    return undefined;
  }
  return undefined;
}

function validWriteOptions(value: unknown): value is ContextWriteOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as Partial<ContextWriteOptions>;
  return (
    Array.isArray(options.glossaryChanges) &&
    options.glossaryChanges.every(
      (change) =>
        Boolean(change) &&
        typeof change.original === 'string' &&
        Boolean(change.original.trim()) &&
        (change.source === 'user' || change.source === 'model') &&
        (change.expected === null ||
          (change.expected?.original === change.original &&
            typeof change.expected.translation === 'string' &&
            typeof change.expected.isHard === 'boolean')) &&
        (change.next === null ||
          (change.next?.original === change.original &&
            typeof change.next.translation === 'string' &&
            typeof change.next.isHard === 'boolean'))
    ) &&
    Array.isArray(options.dialogueChanges) &&
    options.dialogueChanges.every(
      (change) =>
        Boolean(change) &&
        typeof change.imageId === 'string' &&
        (change.expected === null || typeof change.expected?.imageId === 'string') &&
        (change.next === null || typeof change.next?.imageId === 'string')
    ) &&
    (options.replayRevision === undefined ||
      (typeof options.replayRevision === 'string' && options.replayRevision.length <= 256)) &&
    Number.isSafeInteger(options.expectedGlossaryRevision) &&
    options.expectedGlossaryRevision! >= 0 &&
    Number.isSafeInteger(options.expectedChapterGeneration) &&
    options.expectedChapterGeneration! >= 0 &&
    Number.isSafeInteger(options.expectedGlossaryGeneration) &&
    options.expectedGlossaryGeneration! >= 0 &&
    Number.isSafeInteger(options.maxDialogueEntries) &&
    options.maxDialogueEntries! >= 1 &&
    options.maxDialogueEntries! <= 100
  );
}

function contextScopeMatchesReader(request: ContextStorageRequest, chapterId: string): boolean {
  if (request.operation === 'load') {
    const scope = parseScopeId(request.scopeId);
    return Boolean(scope && (scope[0] === 'series' || scope[3]?.toLowerCase() === chapterId));
  }
  if (request.operation === 'remove') {
    if (
      !Array.isArray(request.scopeIds) ||
      request.scopeIds.length < 1 ||
      request.scopeIds.length > 2
    )
      return false;
    const scopes = request.scopeIds.map(parseScopeId);
    const chapterScope = scopes.find((scope) => scope?.[0] === 'chapter');
    const glossaryScope = scopes.find((scope) => scope?.[0] === 'series');
    return Boolean(
      chapterScope &&
      chapterScope[3]?.toLowerCase() === chapterId &&
      scopes.every((scope) => scope !== undefined) &&
      (scopes.length === 1 ||
        (glossaryScope &&
          chapterScope[2] === glossaryScope[2] &&
          chapterScope[4] === glossaryScope[4]))
    );
  }
  const chapterScope = parseScopeId(request.scopeIds?.chapter);
  const glossaryScope = parseScopeId(request.scopeIds?.glossary);
  return Boolean(
    chapterScope?.[0] === 'chapter' &&
    chapterScope[3]?.toLowerCase() === chapterId &&
    glossaryScope &&
    chapterScope[1] === glossaryScope[1] &&
    chapterScope[4] === glossaryScope[4] &&
    (glossaryScope[0] === 'series'
      ? chapterScope[2] === glossaryScope[2]
      : request.scopeIds.chapter === request.scopeIds.glossary)
  );
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const task = contextQueue.then(operation);
  contextQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

export function handleContextStorageMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void
): boolean {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: string }).type !== EXTENSION_MESSAGE_TYPES.CONTEXT_STORAGE_COMMAND
  )
    return false;

  const request = message as ContextStorageRequest;
  const chapterId = readerChapter(sender);
  if (!chapterId || !contextScopeMatchesReader(request, chapterId)) {
    respond({ success: false, error: 'Context storage command is unavailable.' });
    return false;
  }

  if (request.operation === 'saveContext' && !validWriteOptions(request.options)) {
    respond({ success: false, error: 'Invalid context storage change.' });
    return false;
  }
  const task = enqueue(async () => {
    switch (request.operation) {
      case 'load':
        return store.load(request.scopeId);
      case 'saveContext':
        return store.saveContext(request.scopeIds, request.options);
      case 'remove':
        await store.remove(request.scopeIds);
        return null;
    }
  });
  void task.then(
    (result) => respond({ success: true, result }),
    (error: unknown) =>
      respond({
        success: false,
        error: error instanceof Error ? error.message : 'Context storage operation failed.',
        code:
          error && typeof error === 'object' && 'code' in error
            ? (error as { code: string }).code
            : undefined,
      })
  );
  return true;
}
