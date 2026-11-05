import type { ContextScope, IContextManager } from '../context/types';
import type { TranslationProvider, TranslationRequest, TranslationResult } from '../contracts';
import { validateTranslationResult } from '../contracts';
import { InvalidProviderResponseError } from '../errors';
import { logPipeline } from '../diagnostics';
import {
  replayPreferences,
  sha256,
  TRANSLATION_PROMPT_VERSION,
  type ReplayCache,
  type ReplayIdentity,
  type ReplayRecord,
} from './replay';

interface ReadingProviderOptions {
  context: IContextManager;
  cache: ReplayCache;
  getScope: () => ContextScope | undefined;
  prepare: (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationRequest>;
  warn?: (message: string) => void;
}

interface PendingAcceptance {
  pageIndex: number;
  contextImageId: string;
  record: ReplayRecord;
  generation: string;
  contextRevision: string;
  scopeSignature: string;
}

export class ReadingTranslationProvider implements TranslationProvider {
  private readonly pending = new WeakMap<TranslationResult, PendingAcceptance>();

  constructor(
    private readonly provider: TranslationProvider,
    private readonly options: ReadingProviderOptions
  ) {}

  get id() {
    return this.provider.id;
  }
  get name() {
    return this.provider.name;
  }
  get modelName() {
    return this.provider.modelName;
  }
  get cacheIdentity() {
    return this.provider.cacheIdentity;
  }
  capabilities() {
    return this.provider.capabilities();
  }

  async translatePage(
    request: TranslationRequest,
    signal?: AbortSignal
  ): Promise<TranslationResult> {
    signal?.throwIfAborted();
    await this.options.context.ready?.();
    signal?.throwIfAborted();
    const scope = this.options.getScope();
    const context = request.context ?? this.options.context.getPacket(request.image.pageIndex);
    const contextRevision = this.options.context.getReplayRevision?.() ?? 'initial';
    const prepared = await this.options.prepare({ ...request, context }, signal);
    signal?.throwIfAborted();
    const data = prepared.image.base64Data?.replace(/^data:image\/[^;]+;base64,/, '');
    if (!data) throw new InvalidProviderResponseError('Image data is unavailable.', this.id);
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const identity: ReplayIdentity = {
      reading: scope?.reading ?? { site: 'unknown', chapterId: request.image.id },
      pageIndex: request.image.pageIndex,
      sourceIdentity: request.image.sourceIdentity ?? request.image.id,
      contentHash: await sha256(bytes),
      sourceLanguage: (request.sourceLanguage ?? 'auto').trim().toLowerCase(),
      targetLanguage: request.targetLanguage.trim().toLowerCase(),
      providerId: this.id,
      modelId: request.options?.modelName ?? this.modelName ?? '',
      configuration: this.cacheIdentity ?? '',
      promptVersion: TRANSLATION_PROMPT_VERSION,
      contextRevision: await sha256(
        JSON.stringify([
          replayPreferences(context, contextRevision),
          request.options?.customPrompt ?? null,
          request.options?.temperature ?? null,
          prepared.image.mimeType ?? null,
          request.context ? context : null,
        ])
      ),
    };
    signal?.throwIfAborted();
    if (request.options?.bypassCache && scope) {
      await this.options.cache.invalidate(
        scope.reading,
        identity.targetLanguage,
        identity.pageIndex
      );
    }
    const lookup = await this.options.cache.lookup(identity);
    signal?.throwIfAborted();
    if (lookup.warning) this.options.warn?.(lookup.warning);
    let result: TranslationResult;
    if (lookup.record && !request.options?.bypassCache) {
      logPipeline('cache', 'hit');
      result = {
        ...lookup.record.result,
        imageId: request.image.id,
        pageId: `page_${request.image.pageIndex}`,
      };
    } else {
      logPipeline('cache', request.options?.bypassCache ? 'bypass' : 'miss');
      result = await this.provider.translatePage(prepared, signal);
    }
    signal?.throwIfAborted();
    if (
      !validateTranslationResult(result).valid ||
      result.targetLanguage !== identity.targetLanguage
    )
      throw new InvalidProviderResponseError(
        'The provider returned an invalid translation.',
        this.id
      );
    const bound = {
      ...result,
      imageId: request.image.id,
      pageId: `page_${request.image.pageIndex}`,
    };
    this.pending.set(bound, {
      pageIndex: request.image.pageIndex,
      contextImageId: scope
        ? `${scope.reading.site}:${scope.reading.chapterId}:${request.image.pageIndex}`
        : request.image.id,
      generation: lookup.generation,
      contextRevision,
      scopeSignature: JSON.stringify(scope),
      record: {
        schemaVersion: 2,
        identity,
        result: bound,
        requestContextHash:
          lookup.record?.requestContextHash ?? (await sha256(JSON.stringify(context))),
        acceptedAt: lookup.record?.acceptedAt ?? Date.now(),
        lastAccessedAt: Date.now(),
      },
    });
    return bound;
  }

  async acceptTranslation(result: TranslationResult, signal?: AbortSignal): Promise<void> {
    const pending = this.pending.get(result);
    this.pending.delete(result);
    signal?.throwIfAborted();
    if (!pending) throw new Error('Translation has no current acceptance ticket.');
    if (
      pending.scopeSignature !== JSON.stringify(this.options.getScope()) ||
      pending.contextRevision !== (this.options.context.getReplayRevision?.() ?? 'initial')
    ) {
      throw new DOMException('Reading context changed.', 'AbortError');
    }
    if (this.options.context.commitTranslation) {
      await this.options.context.commitTranslation(
        result,
        pending.pageIndex,
        pending.contextImageId,
        signal
      );
    } else {
      this.options.context.recordTranslation(result, pending.pageIndex, pending.contextImageId);
      await this.options.context.flush?.();
    }
    signal?.throwIfAborted();
    const status = await this.options.cache.accept(pending.record, pending.generation);
    if (signal?.aborted) return;
    if (status.warning) this.options.warn?.(status.warning);
  }
}
