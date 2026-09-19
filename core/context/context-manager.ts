import { ContextPacket, DialogueEntry, GlossaryEntry, TranslationResult } from '@core/contracts';
import { ContextManagerOptions, IContextManager } from './types';

const DEFAULT_MAX_DIALOGUE_ENTRIES = 15;

export class ContextManager implements IContextManager {
  private maxDialogueEntries: number;
  private dialogueHistory: DialogueEntry[] = [];
  private glossary: Map<string, GlossaryEntry> = new Map();

  public seriesTitle?: string;
  public sourceLanguage?: string;
  public targetLanguage?: string;
  public translationStyle?: 'natural' | 'literal';
  public preserveHonorifics?: boolean;

  constructor(options: ContextManagerOptions = {}) {
    this.maxDialogueEntries = Math.max(
      1,
      options.maxDialogueEntries ?? DEFAULT_MAX_DIALOGUE_ENTRIES
    );
    this.seriesTitle = options.seriesTitle;
    this.sourceLanguage = options.sourceLanguage;
    this.targetLanguage = options.targetLanguage;
    this.translationStyle = options.translationStyle;
    this.preserveHonorifics = options.preserveHonorifics;

    if (options.initialGlossary) {
      for (const entry of options.initialGlossary) {
        this.addGlossaryEntry(entry);
      }
    }
  }

  getPacket(): ContextPacket {
    return {
      seriesTitle: this.seriesTitle,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      translationStyle: this.translationStyle,
      preserveHonorifics: this.preserveHonorifics,
      recentDialogue: this.getDialogueHistory(),
      glossary: this.getGlossary(),
    };
  }

  recordTranslation(result: unknown, pageIndex?: number): void {
    if (!result || typeof result !== 'object') {
      return;
    }

    const typedResult = result as Partial<TranslationResult>;
    if (!Array.isArray(typedResult.bubbles)) {
      return;
    }

    for (const bubble of typedResult.bubbles) {
      if (!bubble || typeof bubble.translatedText !== 'string') {
        continue;
      }

      // Skip non-narrative sound effects from dialogue history.
      if (bubble.bubbleType === 'sfx') {
        continue;
      }

      const trimmedText = bubble.translatedText.trim();
      if (!trimmedText) {
        continue;
      }

      this.dialogueHistory.push({
        speaker: bubble.speaker?.trim() || undefined,
        sourceText: bubble.sourceText?.trim() || undefined,
        translatedText: trimmedText,
        pageIndex,
      });
    }

    // Maintain FIFO bounds by dropping oldest entries first.
    while (this.dialogueHistory.length > this.maxDialogueEntries) {
      this.dialogueHistory.shift();
    }

    // Merge non-hard glossary updates from provider context deltas.
    if (Array.isArray(typedResult.contextDelta?.glossaryUpdates)) {
      for (const update of typedResult.contextDelta.glossaryUpdates) {
        if (!update || !update.original || !update.translation) {
          continue;
        }

        const originalKey = update.original.trim();
        const translationValue = update.translation.trim();
        if (!originalKey || !translationValue) {
          continue;
        }

        const existing = this.glossary.get(originalKey);
        // Do not let soft AI inferences overwrite user-pinned terms.
        if (existing?.isHard) {
          continue;
        }

        this.glossary.set(originalKey, {
          original: originalKey,
          translation: translationValue,
          isHard: false,
        });
      }
    }
  }

  addGlossaryEntry(entry: GlossaryEntry): void {
    if (!entry || !entry.original || !entry.translation) {
      return;
    }

    const key = entry.original.trim();
    const translation = entry.translation.trim();
    if (!key || !translation) {
      return;
    }

    this.glossary.set(key, {
      original: key,
      translation,
      isHard: Boolean(entry.isHard),
    });
  }

  removeGlossaryEntry(original: string): boolean {
    return this.glossary.delete(original.trim());
  }

  getGlossary(): GlossaryEntry[] {
    return Array.from(this.glossary.values()).map((e) => ({ ...e }));
  }

  clearGlossary(): void {
    this.glossary.clear();
  }

  getDialogueHistory(): DialogueEntry[] {
    return this.dialogueHistory.map((d) => ({ ...d }));
  }

  getDialogueCount(): number {
    return this.dialogueHistory.length;
  }

  setMaxDialogueEntries(max: number): void {
    this.maxDialogueEntries = Math.max(1, Math.floor(max));
    while (this.dialogueHistory.length > this.maxDialogueEntries) {
      this.dialogueHistory.shift();
    }
  }

  getMaxDialogueEntries(): number {
    return this.maxDialogueEntries;
  }

  reset(): void {
    this.dialogueHistory = [];
    this.glossary.clear();
  }
}
