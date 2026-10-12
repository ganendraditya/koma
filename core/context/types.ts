import { ContextPacket, DialogueEntry, GlossaryEntry, ReadingIdentity } from '@core/contracts';

export interface ContextScope {
  reading: ReadingIdentity;
  targetLanguage: string;
}

export interface DialogueContributionSnapshot {
  imageId: string;
  pageIndex?: number;
  entries: DialogueEntry[];
  order: number;
}

export interface ContextSnapshot {
  schemaVersion: 1;
  replayRevision?: string;
  dialogueContributions: DialogueContributionSnapshot[];
  glossary: GlossaryEntry[];
}

export interface ContextManagerOptions {
  /**
   * Maximum dialogue entries preserved in the rolling FIFO buffer.
   * Default: 15 (recommended range: 10 to 20).
   */
  maxDialogueEntries?: number;

  /**
   * Maximum glossary entries preserved in memory.
   * Default: 50.
   */
  maxGlossaryEntries?: number;

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

  getPacket(beforePageIndex?: number): ContextPacket;
  getReplayRevision?(): string;
  recordTranslation(result: unknown, pageIndex?: number, imageId?: string): void;
  commitTranslation?(
    result: unknown,
    pageIndex?: number,
    imageId?: string,
    signal?: AbortSignal
  ): Promise<void>;
  addGlossaryEntry(entry: GlossaryEntry): boolean;
  removeGlossaryEntry(original: string): boolean;
  getGlossary(): GlossaryEntry[];
  clearGlossary(): void;
  getDialogueHistory(): DialogueEntry[];
  getDialogueCount(): number;
  setMaxDialogueEntries(max: number): void;
  getMaxDialogueEntries(): number;
  reset(): void | Promise<void>;
  resetScope?(scope: ContextScope): Promise<void>;
  ready?(): Promise<void>;
  flush?(): Promise<void>;
  setScope?(scope?: ContextScope): Promise<void>;
}
