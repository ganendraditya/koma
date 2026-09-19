import { ContextPacket, DialogueEntry, GlossaryEntry, TranslationResult } from '@core/contracts';
import { ContextManagerOptions, IContextManager } from './types';

const DEFAULT_MAX_DIALOGUE_ENTRIES = 15;
const DEFAULT_MAX_GLOSSARY_ENTRIES = 50;

export class ContextManager implements IContextManager {
  private maxDialogueEntries: number;
  private maxGlossaryEntries: number;
  private dialogueHistory: DialogueEntry[] = [];
  private glossary: Map<string, GlossaryEntry> = new Map();

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

    // Stage and validate dialogue entries before mutating context state.
    const stagedDialogues: DialogueEntry[] = [];
    if (Array.isArray(typedResult.bubbles)) {
      for (const bubble of typedResult.bubbles) {
        if (!bubble || typeof bubble !== 'object' || typeof bubble.translatedText !== 'string') {
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

        stagedDialogues.push({
          speaker:
            typeof bubble.speaker === 'string' ? bubble.speaker.trim() || undefined : undefined,
          sourceText:
            typeof bubble.sourceText === 'string'
              ? bubble.sourceText.trim() || undefined
              : undefined,
          translatedText: trimmedText,
          pageIndex,
        });
      }
    }

    // Stage and validate glossary updates defensively against malformed non-string inputs.
    const stagedGlossaryUpdates: { original: string; translation: string }[] = [];
    if (Array.isArray(typedResult.contextDelta?.glossaryUpdates)) {
      for (const update of typedResult.contextDelta.glossaryUpdates) {
        if (
          !update ||
          typeof update !== 'object' ||
          typeof update.original !== 'string' ||
          typeof update.translation !== 'string'
        ) {
          continue;
        }

        const originalKey = update.original.trim();
        const translationValue = update.translation.trim();
        if (!originalKey || !translationValue) {
          continue;
        }

        stagedGlossaryUpdates.push({
          original: originalKey,
          translation: translationValue,
        });
      }
    }

    // Commit staged dialogues to rolling FIFO history.
    for (const entry of stagedDialogues) {
      this.dialogueHistory.push(entry);
    }
    while (this.dialogueHistory.length > this.maxDialogueEntries) {
      this.dialogueHistory.shift();
    }

    // Commit staged glossary updates without overriding user-pinned hard entries.
    for (const update of stagedGlossaryUpdates) {
      const existing = this.glossary.get(update.original);
      if (existing?.isHard) {
        continue;
      }

      this.glossary.set(update.original, {
        original: update.original,
        translation: update.translation,
        isHard: false,
      });
    }

    // Evict oldest soft entries if dynamic glossary size exceeds threshold.
    while (this.glossary.size > this.maxGlossaryEntries) {
      let evicted = false;
      for (const [key, entry] of this.glossary.entries()) {
        if (!entry.isHard) {
          this.glossary.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        break;
      }
    }
  }

  addGlossaryEntry(entry: GlossaryEntry): void {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.original !== 'string' ||
      typeof entry.translation !== 'string'
    ) {
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
    if (!original || typeof original !== 'string') {
      return false;
    }
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
    const validMax = Number.isFinite(max)
      ? Math.max(1, Math.floor(max))
      : DEFAULT_MAX_DIALOGUE_ENTRIES;
    this.maxDialogueEntries = validMax;
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
