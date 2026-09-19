import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager, ContextAwareProvider } from '@core/context';
import {
  MangaImage,
  ProviderCapabilities,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  GlossaryEntry,
} from '@core/contracts';
import { buildGeminiSystemPrompt } from '@providers/gemini/prompt';

class MockTranslationProvider implements TranslationProvider {
  readonly id = 'mock-provider';
  readonly name = 'Mock Translation Provider';

  public calls: TranslationRequest[] = [];
  public shouldFail = false;
  public failureError = new Error('Upstream provider timeout');
  public mockBubbles: TranslationResult['bubbles'] = [];
  public mockContextDelta: TranslationResult['contextDelta'];

  capabilities(): ProviderCapabilities {
    return {
      vision: true,
      ocr: true,
      translation: true,
      boundingBoxes: true,
    };
  }

  async translatePage(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(request);

    if (this.shouldFail) {
      throw this.failureError;
    }

    return {
      pageId: 'page_001',
      imageId: request.image.id,
      sourceLanguage: request.sourceLanguage || 'ja',
      targetLanguage: request.targetLanguage,
      bubbles:
        this.mockBubbles.length > 0
          ? [...this.mockBubbles]
          : [
              {
                id: 'bubble_1',
                sourceText: 'お前は誰だ？',
                translatedText: 'Siapa kau?',
                speaker: 'Karakter A',
                box: { ymin: 100, xmin: 100, ymax: 200, xmax: 300 },
                bubbleType: 'speech',
              },
            ],
      contextDelta: this.mockContextDelta,
    };
  }
}

function createDummyImage(id: string, pageIndex = 1): MangaImage {
  return {
    id,
    url: `https://example.com/manga/${id}.jpg`,
    pageIndex,
  };
}

describe('KOMA-009: Minimal Context-Aware Translation', () => {
  let contextManager: ContextManager;
  let mockProvider: MockTranslationProvider;
  let contextAwareProvider: ContextAwareProvider;

  beforeEach(() => {
    contextManager = new ContextManager({ maxDialogueEntries: 15 });
    mockProvider = new MockTranslationProvider();
    contextAwareProvider = new ContextAwareProvider(mockProvider, contextManager);
  });

  describe('AC 1 & AC 2: Dialogue Context Accumulation Across Images', () => {
    it('appends successful translation dialogue into local context', async () => {
      mockProvider.mockBubbles = [
        {
          id: 'b1',
          sourceText: '行くぞ！',
          translatedText: 'Ayo maju!',
          speaker: 'Luffy',
          box: { ymin: 10, xmin: 10, ymax: 50, xmax: 50 },
          bubbleType: 'speech',
        },
        {
          id: 'b2',
          sourceText: '待ってくれ！',
          translatedText: 'Tunggu aku!',
          speaker: 'Usopp',
          box: { ymin: 60, xmin: 60, ymax: 90, xmax: 90 },
          bubbleType: 'speech',
        },
      ];

      await contextAwareProvider.translatePage({
        image: createDummyImage('img_01', 1),
        targetLanguage: 'id',
      });

      const history = contextManager.getDialogueHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        speaker: 'Luffy',
        sourceText: '行くぞ！',
        translatedText: 'Ayo maju!',
        pageIndex: 1,
      });
      expect(history[1]).toEqual({
        speaker: 'Usopp',
        sourceText: '待ってくれ！',
        translatedText: 'Tunggu aku!',
        pageIndex: 1,
      });
    });

    it('retains dialogue history from multiple previous translated images', async () => {
      mockProvider.mockBubbles = [
        {
          id: 'b1',
          sourceText: 'Page 1 line',
          translatedText: 'Halaman satu',
          box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
        },
      ];
      await contextAwareProvider.translatePage({
        image: createDummyImage('img_01', 1),
        targetLanguage: 'id',
      });

      mockProvider.mockBubbles = [
        {
          id: 'b2',
          sourceText: 'Page 2 line',
          translatedText: 'Halaman dua',
          box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
        },
      ];
      await contextAwareProvider.translatePage({
        image: createDummyImage('img_02', 2),
        targetLanguage: 'id',
      });

      const history = contextManager.getDialogueHistory();
      expect(history).toHaveLength(2);
      expect(history[0].translatedText).toBe('Halaman satu');
      expect(history[0].pageIndex).toBe(1);
      expect(history[1].translatedText).toBe('Halaman dua');
      expect(history[1].pageIndex).toBe(2);
    });

    it('ignores non-narrative sound effects from dialogue history', () => {
      contextManager.recordTranslation({
        pageId: 'p1',
        imageId: 'img_01',
        sourceLanguage: 'ja',
        targetLanguage: 'id',
        bubbles: [
          {
            id: 'b1',
            sourceText: 'ドカーン',
            translatedText: 'BOOOM',
            box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
            bubbleType: 'sfx',
          },
          {
            id: 'b2',
            sourceText: '大丈夫か？',
            translatedText: 'Kamu tidak apa-apa?',
            box: { ymin: 10, xmin: 10, ymax: 20, xmax: 20 },
            bubbleType: 'speech',
          },
        ],
      });

      const history = contextManager.getDialogueHistory();
      expect(history).toHaveLength(1);
      expect(history[0].translatedText).toBe('Kamu tidak apa-apa?');
    });
  });

  describe('AC 3 & AC 4: Configurable Maximum Size & FIFO Truncation', () => {
    it('honors configured maximum dialogue entries size', () => {
      const customManager = new ContextManager({ maxDialogueEntries: 5 });
      expect(customManager.getMaxDialogueEntries()).toBe(5);

      customManager.setMaxDialogueEntries(10);
      expect(customManager.getMaxDialogueEntries()).toBe(10);
    });

    it('removes oldest dialogue entries in FIFO order when maximum is exceeded', () => {
      const smallManager = new ContextManager({ maxDialogueEntries: 3 });

      // Add 4 bubbles across consecutive translations
      for (let i = 1; i <= 4; i++) {
        smallManager.recordTranslation({
          bubbles: [
            {
              id: `b${i}`,
              sourceText: `Text ${i}`,
              translatedText: `Dialog ${i}`,
              box: { ymin: 0, xmin: 0, ymax: 1, xmax: 1 },
            },
          ],
        });
      }

      const history = smallManager.getDialogueHistory();
      expect(history).toHaveLength(3);
      // Dialog 1 should have been evicted; Dialog 2, 3, 4 remain
      expect(history.map((d) => d.translatedText)).toEqual(['Dialog 2', 'Dialog 3', 'Dialog 4']);
    });

    it('truncates excess entries immediately when maxDialogueEntries is lowered', () => {
      for (let i = 1; i <= 5; i++) {
        contextManager.recordTranslation({
          bubbles: [
            {
              id: `b${i}`,
              sourceText: `Source ${i}`,
              translatedText: `Translation ${i}`,
              box: { ymin: 0, xmin: 0, ymax: 1, xmax: 1 },
            },
          ],
        });
      }
      expect(contextManager.getDialogueCount()).toBe(5);

      contextManager.setMaxDialogueEntries(2);
      expect(contextManager.getDialogueCount()).toBe(2);
      expect(contextManager.getDialogueHistory().map((d) => d.translatedText)).toEqual([
        'Translation 4',
        'Translation 5',
      ]);
    });
  });

  describe('AC 5: Context Injection into Subsequent Translation Requests', () => {
    it('supplies accumulated dialogue context to subsequent translation requests', async () => {
      mockProvider.mockBubbles = [
        {
          id: 'p1_b1',
          sourceText: 'お前を倒す',
          translatedText: 'Aku akan mengalahkanmu',
          box: { ymin: 0, xmin: 0, ymax: 1, xmax: 1 },
        },
      ];

      // Page 1
      await contextAwareProvider.translatePage({
        image: createDummyImage('img_p1', 1),
        targetLanguage: 'id',
      });

      // Page 2
      mockProvider.mockBubbles = [
        {
          id: 'p2_b1',
          sourceText: 'やってみろ',
          translatedText: 'Coba saja',
          box: { ymin: 0, xmin: 0, ymax: 1, xmax: 1 },
        },
      ];
      await contextAwareProvider.translatePage({
        image: createDummyImage('img_p2', 2),
        targetLanguage: 'id',
      });

      expect(mockProvider.calls).toHaveLength(2);

      // Call 1 had empty dialogue
      expect(mockProvider.calls[0].context?.recentDialogue).toEqual([]);

      // Call 2 received Call 1 dialogue
      const secondCallContext = mockProvider.calls[1].context;
      expect(secondCallContext?.recentDialogue).toHaveLength(1);
      expect(secondCallContext?.recentDialogue?.[0].translatedText).toBe('Aku akan mengalahkanmu');
    });
  });

  describe('AC 6: Provider Prompt Distinguishes Context from Source Text', () => {
    it('includes clear boundary and negative constraints in system prompt', () => {
      const prompt = buildGeminiSystemPrompt('id', {
        recentDialogue: [{ speaker: 'Luffy', translatedText: 'Aku lapar sekali.' }],
        glossary: [{ original: '覇気', translation: 'Haki', isHard: true }],
      });

      // Prompt must explicitly instruct the model regarding context boundaries
      expect(prompt).toContain('HISTORICAL CONTINUITY:');
      expect(prompt).toContain('prior pages only');
      expect(prompt).toContain('NEVER create or output bubbles for dialogue from prior pages');
      expect(prompt).toContain('do NOT re-output as current bubbles');
    });
  });

  describe('AC 7: Context Isolation from Current Page Renderings', () => {
    it('returns only current image bubbles and never mixes context into result bubbles', async () => {
      contextManager.recordTranslation({
        bubbles: [
          {
            id: 'prior_01',
            sourceText: 'Old source',
            translatedText: 'Old translated text',
            box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
          },
        ],
      });

      mockProvider.mockBubbles = [
        {
          id: 'current_01',
          sourceText: 'Current source',
          translatedText: 'Current translated text',
          box: { ymin: 50, xmin: 50, ymax: 100, xmax: 100 },
        },
      ];

      const result = await contextAwareProvider.translatePage({
        image: createDummyImage('img_curr', 2),
        targetLanguage: 'id',
      });

      // Overlay renderer receives ONLY result.bubbles. Verify it has only current_01.
      expect(result.bubbles).toHaveLength(1);
      expect(result.bubbles[0].id).toBe('current_01');
      expect(result.bubbles[0].translatedText).toBe('Current translated text');
    });
  });

  describe('AC 8 & AC 9: Basic Glossary Structure & Manual Term Injection', () => {
    it('stores, retrieves, and removes glossary entries', () => {
      const entry: GlossaryEntry = {
        original: '海賊王',
        translation: 'Raja Bajak Laut',
        isHard: true,
      };

      contextManager.addGlossaryEntry(entry);
      expect(contextManager.getGlossary()).toEqual([entry]);

      const removed = contextManager.removeGlossaryEntry('海賊王');
      expect(removed).toBe(true);
      expect(contextManager.getGlossary()).toEqual([]);
    });

    it('normalizes glossary keys by trimming whitespace on add, delete, and AI updates', () => {
      contextManager.addGlossaryEntry({
        original: '  覇気  ',
        translation: '  Haki  ',
        isHard: true,
      });

      expect(contextManager.getGlossary()).toEqual([
        { original: '覇気', translation: 'Haki', isHard: true },
      ]);

      // Soft update with whitespace should still match the hard-pinned key and be rejected
      contextManager.recordTranslation({
        bubbles: [],
        contextDelta: {
          glossaryUpdates: [{ original: ' 覇気 ', translation: 'Tekad' }],
        },
      });
      expect(contextManager.getGlossary()[0].translation).toBe('Haki');

      // Deleting with whitespace should find and remove it
      const removed = contextManager.removeGlossaryEntry(' 覇気 ');
      expect(removed).toBe(true);
      expect(contextManager.getGlossary()).toHaveLength(0);
    });

    it('supplies manually inserted glossary item to translation provider', async () => {
      contextManager.addGlossaryEntry({
        original: '覇気',
        translation: 'Haki',
        isHard: true,
      });

      await contextAwareProvider.translatePage({
        image: createDummyImage('img_01', 1),
        targetLanguage: 'id',
      });

      expect(mockProvider.calls).toHaveLength(1);
      const injectedGlossary = mockProvider.calls[0].context?.glossary;
      expect(injectedGlossary).toHaveLength(1);
      expect(injectedGlossary?.[0]).toEqual({
        original: '覇気',
        translation: 'Haki',
        isHard: true,
      });
    });

    it('protects hard-pinned glossary entries from being overwritten by soft AI context deltas', () => {
      contextManager.addGlossaryEntry({
        original: '覇気',
        translation: 'Haki',
        isHard: true,
      });

      // Simulate soft AI model returning a different translation in contextDelta
      contextManager.recordTranslation({
        bubbles: [],
        contextDelta: {
          glossaryUpdates: [{ original: '覇気', translation: 'Tekad Semangat' }],
        },
      });

      const glossary = contextManager.getGlossary();
      expect(glossary).toHaveLength(1);
      expect(glossary[0].translation).toBe('Haki');
    });

    it('adopts soft glossary updates when no hard-pinned entry exists', () => {
      contextManager.recordTranslation({
        bubbles: [],
        contextDelta: {
          glossaryUpdates: [{ original: '雷鳴八卦', translation: 'Raimei Hakke' }],
        },
      });

      const glossary = contextManager.getGlossary();
      expect(glossary).toHaveLength(1);
      expect(glossary[0]).toEqual({
        original: '雷鳴八卦',
        translation: 'Raimei Hakke',
        isHard: false,
      });
    });
  });

  describe('AC 10: Reset Context Action', () => {
    it('clears dialogue history and glossary on reset', () => {
      contextManager.recordTranslation({
        bubbles: [
          {
            id: 'b1',
            sourceText: 'Teks',
            translatedText: 'Terjemahan',
            box: { ymin: 0, xmin: 0, ymax: 10, xmax: 10 },
          },
        ],
      });
      contextManager.addGlossaryEntry({
        original: '先輩',
        translation: 'Senpai',
      });

      expect(contextManager.getDialogueCount()).toBe(1);
      expect(contextManager.getGlossary()).toHaveLength(1);

      contextManager.reset();

      expect(contextManager.getDialogueCount()).toBe(0);
      expect(contextManager.getGlossary()).toHaveLength(0);
      expect(contextManager.getPacket().recentDialogue).toEqual([]);
      expect(contextManager.getPacket().glossary).toEqual([]);
    });
  });

  describe('AC 11: Zero-Context Fallback', () => {
    it('translates cleanly when no prior context exists', async () => {
      const freshManager = new ContextManager();
      const provider = new ContextAwareProvider(mockProvider, freshManager);

      const result = await provider.translatePage({
        image: createDummyImage('img_01', 1),
        targetLanguage: 'id',
      });

      expect(result).toBeDefined();
      expect(result.bubbles).toHaveLength(1);
      expect(mockProvider.calls[0].context?.recentDialogue).toEqual([]);
      expect(mockProvider.calls[0].context?.glossary).toEqual([]);
    });
  });

  describe('AC 12: Failure Safety & Error Isolation', () => {
    it('does not pollute context when translation fails or throws', async () => {
      // Pre-seed with one valid dialogue entry
      contextManager.recordTranslation({
        bubbles: [
          {
            id: 'b0',
            sourceText: 'Valid',
            translatedText: 'Valid translated dialogue',
            box: { ymin: 0, xmin: 0, ymax: 1, xmax: 1 },
          },
        ],
      });
      expect(contextManager.getDialogueCount()).toBe(1);

      mockProvider.shouldFail = true;

      await expect(
        contextAwareProvider.translatePage({
          image: createDummyImage('img_fail', 2),
          targetLanguage: 'id',
        })
      ).rejects.toThrow('Upstream provider timeout');

      // Context must remain completely untouched
      expect(contextManager.getDialogueCount()).toBe(1);
      expect(contextManager.getDialogueHistory()[0].translatedText).toBe(
        'Valid translated dialogue'
      );
    });

    it('safely ignores corrupt or malformed translation results in recordTranslation', () => {
      contextManager.recordTranslation(null);
      contextManager.recordTranslation(undefined);
      contextManager.recordTranslation({ bubbles: 'not-an-array' as unknown as [] });
      contextManager.recordTranslation({ bubbles: [null, undefined, { translatedText: '' }] });

      expect(contextManager.getDialogueCount()).toBe(0);
    });
  });
});
