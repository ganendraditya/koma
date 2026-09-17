/**
 * Represents a previously translated dialogue line preserved for narrative continuity.
 */
export interface DialogueEntry {
  speaker?: string;
  sourceText?: string;
  translatedText: string;
  pageIndex?: number;
}

/**
 * Terminology and name translation mapping.
 */
export interface GlossaryEntry {
  /**
   * Source term (e.g. '覇気', '先輩').
   */
  original: string;

  /**
   * Canonical target translation (e.g. 'Haki', 'Senpai').
   */
  translation: string;

  /**
   * When true, this entry is hard/user-pinned and must never be overridden by AI inference.
   */
  isHard?: boolean;
}

/**
 * Character profile established across chapters.
 */
export interface CharacterProfile {
  name: string;
  aliases?: string[];
  description?: string;
  pronouns?: string;
}

/**
 * Contextual memory packet attached to translation requests.
 */
export interface ContextPacket {
  /**
   * Series information if identified.
   */
  seriesTitle?: string;

  /**
   * Source language ISO code (e.g. 'ja', 'ko', 'zh').
   */
  sourceLanguage?: string;

  /**
   * Target language ISO code (e.g. 'id', 'en').
   */
  targetLanguage?: string;

  /**
   * High-level summary of recent story/scene events.
   */
  chapterSummary?: string;

  /**
   * Buffer of recent translated dialogue lines (recommended 10-20 entries).
   */
  recentDialogue?: DialogueEntry[];

  /**
   * Translation glossary of established terms.
   */
  glossary?: GlossaryEntry[];

  /**
   * Active characters appearing in the current scene/chapter.
   */
  characters?: CharacterProfile[];

  /**
   * Desired translation style.
   */
  translationStyle?: 'natural' | 'literal';

  /**
   * Whether to preserve Japanese honorifics (e.g. -san, -kun, -chan, senpai).
   */
  preserveHonorifics?: boolean;
}

/**
 * Delta changes returned alongside translation results to update context store.
 */
export interface ContextDelta {
  charactersDiscovered?: CharacterProfile[];
  glossaryUpdates?: GlossaryEntry[];
  sceneSummary?: string;
}
