import { ContextPacket, DialogueEntry, GlossaryEntry } from '@core/contracts';

export interface ContextManagerOptions {
  /**
   * Maximum dialogue entries preserved in the rolling FIFO buffer.
   * Default: 15 (recommended range: 10 to 20).
   */
  maxDialogueEntries?: number;

  /**
   * Initial series or chapter metadata.
   */
  seriesTitle?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationStyle?: 'natural' | 'literal';
  preserveHonorifics?: boolean;

  /**
   * Initial pre-seeded glossary entries.
   */
  initialGlossary?: GlossaryEntry[];
}

export interface IContextManager {
  seriesTitle?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationStyle?: 'natural' | 'literal';
  preserveHonorifics?: boolean;

  getPacket(): ContextPacket;
  recordTranslation(result: unknown, pageIndex?: number): void;
  addGlossaryEntry(entry: GlossaryEntry): void;
  removeGlossaryEntry(original: string): boolean;
  getGlossary(): GlossaryEntry[];
  clearGlossary(): void;
  getDialogueHistory(): DialogueEntry[];
  getDialogueCount(): number;
  setMaxDialogueEntries(max: number): void;
  getMaxDialogueEntries(): number;
  reset(): void;
}
