import { ContextPacket, DialogueEntry, GlossaryEntry, TranslationResult } from '@core/contracts';
import {
  ContextManagerOptions,
  ContextSnapshot,
  DialogueContributionSnapshot,
  IContextManager,
} from './types';

const DEFAULT_MAX_DIALOGUE_ENTRIES = 15;
const DEFAULT_MAX_GLOSSARY_ENTRIES = 50;

interface DialogueContribution {
  imageId: string;
  pageIndex?: number;
  entries: DialogueEntry[];
  order: number;
}

function normalizePageIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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

export class ContextManager implements IContextManager {
  private maxDialogueEntries: number;
  private maxGlossaryEntries: number;
  private readonly dialogueContributions = new Map<string, DialogueContribution>();
  private glossary: Map<string, GlossaryEntry> = new Map();
  private nextOrder = 0;
  private nextGeneratedId = 0;

  public seriesTitle?: string;
  public sourceLanguage?: string;
  public targetLanguage?: string;
  public translationStyle?: 'natural' | 'literal';
  public preserveHonorifics?: boolean;

  constructor(options: ContextManagerOptions = {}) {
    const rawMaxDialogue = options.maxDialogueEntries;
    this.maxDialogueEntries = Number.isFinite(rawMaxDialogue)
      ? Math.max(1, Math.floor(rawMaxDialogue!))
      : DEFAULT_MAX_DIALOGUE_ENTRIES;

    const rawMaxGlossary = options.maxGlossaryEntries;
    this.maxGlossaryEntries = Number.isFinite(rawMaxGlossary)
      ? Math.max(1, Math.floor(rawMaxGlossary!))
      : DEFAULT_MAX_GLOSSARY_ENTRIES;

    this.seriesTitle = options.seriesTitle;
    this.sourceLanguage = options.sourceLanguage;
    this.targetLanguage = options.targetLanguage;
    this.translationStyle = options.translationStyle;
    this.preserveHonorifics = options.preserveHonorifics;

    for (const entry of options.initialGlossary ?? []) {
      this.setGlossaryEntry(entry);
    }
  }

  getPacket(beforePageIndex?: number): ContextPacket {
    return {
      seriesTitle: this.seriesTitle,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      translationStyle: this.translationStyle,
      preserveHonorifics: this.preserveHonorifics,
      recentDialogue: this.getDialogueHistory(beforePageIndex),
      glossary: this.getGlossary(),
    };
  }

  recordTranslation(result: unknown, pageIndex?: number, imageId?: string): void {
    if (!result || typeof result !== 'object') return;

    const typedResult = result as Partial<TranslationResult>;
    const normalizedPageIndex = normalizePageIndex(pageIndex);
    const stagedDialogues: DialogueEntry[] = [];
    if (Array.isArray(typedResult.bubbles)) {
      for (const bubble of typedResult.bubbles) {
        if (!bubble || typeof bubble !== 'object' || typeof bubble.translatedText !== 'string') {
          continue;
        }

        if (bubble.bubbleType === 'sfx') continue;

        const translatedText = bubble.translatedText.trim();
        if (!translatedText) continue;

        stagedDialogues.push({
          speaker:
            typeof bubble.speaker === 'string' ? bubble.speaker.trim() || undefined : undefined,
          sourceText:
            typeof bubble.sourceText === 'string'
              ? bubble.sourceText.trim() || undefined
              : undefined,
          translatedText,
          pageIndex: normalizedPageIndex,
        });
      }
    }

    const stableImageId = typeof imageId === 'string' ? imageId.trim() : '';
    if (stableImageId) {
      if (stagedDialogues.length) {
        this.dialogueContributions.set(stableImageId, {
          imageId: stableImageId,
          pageIndex: normalizedPageIndex,
          entries: stagedDialogues,
          order: this.nextOrder++,
        });
      } else {
        this.dialogueContributions.delete(stableImageId);
      }
    } else if (stagedDialogues.length) {
      const generatedId = `context-entry:${this.nextGeneratedId++}`;
      this.dialogueContributions.set(generatedId, {
        imageId: generatedId,
        pageIndex: normalizedPageIndex,
        entries: stagedDialogues,
        order: this.nextOrder++,
      });
    }
    this.trimDialogueHistory();

    const stagedGlossaryUpdates: { original: string; translation: string }[] = [];
    if (Array.isArray(typedResult.contextDelta?.glossaryUpdates)) {
      for (const update of typedResult.contextDelta.glossaryUpdates) {
        if (
          !update ||
          typeof update !== 'object' ||
          typeof update.original !== 'string' ||
          typeof update.translation !== 'string'
        )
          continue;

        const original = update.original.trim();
        const translation = update.translation.trim();
        if (original && translation) stagedGlossaryUpdates.push({ original, translation });
      }
    }

    for (const update of stagedGlossaryUpdates) {
      this.setGlossaryEntry(
        {
          original: update.original,
          translation: update.translation,
          isHard: false,
        },
        true
      );
    }
  }

  addGlossaryEntry(entry: GlossaryEntry): boolean {
    return this.setGlossaryEntry(entry);
  }

  removeGlossaryEntry(original: string): boolean {
    if (!original || typeof original !== 'string') return false;
    return this.glossary.delete(original.trim());
  }

  getGlossary(): GlossaryEntry[] {
    return Array.from(this.glossary.values()).map((entry) => ({ ...entry }));
  }

  clearGlossary(): void {
    this.glossary.clear();
  }

  getDialogueHistory(beforePageIndex?: number): DialogueEntry[] {
    const pageLimit = normalizePageIndex(beforePageIndex);
    const contributions = [...this.dialogueContributions.values()]
      .filter((contribution) => {
        if (pageLimit === undefined) return true;
        return contribution.pageIndex !== undefined && contribution.pageIndex < pageLimit;
      })
      .sort((a, b) => {
        if (a.pageIndex !== undefined && b.pageIndex !== undefined && a.pageIndex !== b.pageIndex)
          return a.pageIndex - b.pageIndex;
        if (a.pageIndex === undefined && b.pageIndex !== undefined) return 1;
        if (a.pageIndex !== undefined && b.pageIndex === undefined) return -1;
        return a.order - b.order || a.imageId.localeCompare(b.imageId);
      });

    return contributions
      .flatMap((contribution) => contribution.entries)
      .slice(-this.maxDialogueEntries)
      .map((entry) => ({ ...entry }));
  }

  getDialogueCount(): number {
    return [...this.dialogueContributions.values()].reduce(
      (count, contribution) => count + contribution.entries.length,
      0
    );
  }

  setMaxDialogueEntries(max: number): void {
    this.maxDialogueEntries = Number.isFinite(max)
      ? Math.max(1, Math.floor(max))
      : DEFAULT_MAX_DIALOGUE_ENTRIES;
    this.trimDialogueHistory();
  }

  async commitTranslation(
    result: unknown,
    pageIndex?: number,
    imageId?: string,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    const previous = this.exportSnapshot();
    this.recordTranslation(result, pageIndex, imageId);
    try {
      await Promise.resolve();
      signal?.throwIfAborted();
    } catch (error) {
      this.restoreSnapshot(previous);
      throw error;
    }
  }

  getMaxDialogueEntries(): number {
    return this.maxDialogueEntries;
  }

  exportSnapshot(): ContextSnapshot {
    const dialogueContributions: DialogueContributionSnapshot[] = [
      ...this.dialogueContributions.values(),
    ].map((contribution) => ({
      imageId: contribution.imageId,
      pageIndex: contribution.pageIndex,
      entries: contribution.entries.map((entry) => ({ ...entry })),
      order: contribution.order,
    }));

    return {
      schemaVersion: 1,
      dialogueContributions,
      glossary: this.getGlossary(),
    };
  }

  restoreSnapshot(snapshot: unknown): void {
    this.resetMemory();
    if (!snapshot || typeof snapshot !== 'object') return;
    const stored = snapshot as Partial<ContextSnapshot>;
    if (stored.schemaVersion !== 1) return;

    if (Array.isArray(stored.glossary)) {
      for (const entry of stored.glossary) this.setGlossaryEntry(entry, true);
    }

    if (Array.isArray(stored.dialogueContributions)) {
      for (const raw of stored.dialogueContributions) {
        if (
          !raw ||
          typeof raw !== 'object' ||
          typeof raw.imageId !== 'string' ||
          !raw.imageId.trim() ||
          !Array.isArray(raw.entries)
        )
          continue;

        const entries = raw.entries.filter(
          (entry): entry is DialogueEntry =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof entry.translatedText === 'string' &&
            Boolean(entry.translatedText.trim())
        );
        if (!entries.length) continue;

        const pageIndex = normalizePageIndex(raw.pageIndex);
        const order =
          Number.isSafeInteger(raw.order) && raw.order >= 0 ? raw.order : this.nextOrder;
        this.dialogueContributions.set(raw.imageId, {
          imageId: raw.imageId,
          pageIndex,
          entries: entries.map((entry) => ({
            speaker: typeof entry.speaker === 'string' ? entry.speaker : undefined,
            sourceText: typeof entry.sourceText === 'string' ? entry.sourceText : undefined,
            translatedText: entry.translatedText.trim(),
            pageIndex,
          })),
          order,
        });
        this.nextOrder = Math.max(this.nextOrder, order + 1);
      }
    }

    this.trimDialogueHistory();
  }

  reset(): void | Promise<void> {
    this.resetMemory();
  }

  protected resetMemory(): void {
    this.dialogueContributions.clear();
    this.glossary.clear();
    this.nextOrder = 0;
    this.nextGeneratedId = 0;
  }

  private setGlossaryEntry(entry: GlossaryEntry, preserveHard = false): boolean {
    if (!isGlossaryEntry(entry)) return false;
    const original = entry.original.trim();
    const existing = this.glossary.get(original);
    if (preserveHard && existing?.isHard && !entry.isHard) return false;

    if (!existing && this.glossary.size >= this.maxGlossaryEntries) {
      const oldestSoft = [...this.glossary.entries()].find(([, value]) => !value.isHard);
      if (oldestSoft) this.glossary.delete(oldestSoft[0]);
      else if (!entry.isHard) return false;
      else return false;
    }

    this.glossary.set(original, {
      original,
      translation: entry.translation.trim(),
      isHard: Boolean(entry.isHard),
    });
    return true;
  }

  private trimDialogueHistory(): void {
    while (this.getDialogueCount() > this.maxDialogueEntries) {
      const oldest = [...this.dialogueContributions.values()].sort((a, b) => {
        if (a.pageIndex !== undefined && b.pageIndex !== undefined && a.pageIndex !== b.pageIndex)
          return a.pageIndex - b.pageIndex;
        if (a.pageIndex === undefined && b.pageIndex !== undefined) return -1;
        if (a.pageIndex !== undefined && b.pageIndex === undefined) return 1;
        return a.order - b.order || a.imageId.localeCompare(b.imageId);
      })[0];
      if (!oldest) return;
      oldest.entries.shift();
      if (!oldest.entries.length) this.dialogueContributions.delete(oldest.imageId);
    }
  }
}
