import { ContextPacket } from '@core/contracts';

export function buildTranslationPrompt(targetLanguage: string, context?: ContextPacket): string {
  const targetLanguageName = targetLanguage.toLowerCase() === 'id' ? 'Indonesian' : 'English';

  let prompt = `You are an expert manga, manhwa, and comic translation engine.
Your task is to analyze the provided comic page image, detect all dialogue and narration regions, perform accurate OCR, translate the dialogue into natural ${targetLanguageName}, and return localized bounding boxes.

CRITICAL RULES:
1. BOUNDING BOXES:
   - Each bounding box MUST be an array of 4 integers: [ymin, xmin, ymax, xmax] normalized to the range 0 to 1000.
   - (0, 0) is the top-left corner of the image, and (1000, 1000) is the bottom-right corner.
   - Ensure coordinates tightly wrap the speech bubble or narration box containing the text.
   - Verify ymax >= ymin and xmax >= xmin.

2. OCR & READING ORDER:
   - Transcribe vertical and horizontal original text accurately in 'source_text'.
   - Determine reading order: for Japanese manga, order is typically top-to-bottom, right-to-left. For Korean/webtoons, order is top-to-bottom.

3. TRANSLATION QUALITY:
   - Translate into natural, contextually appropriate ${targetLanguageName} suitable for comics.
   - Preserve conversational tone, slang, character personality, and dialogue rhythm.
   - Do not add explanations, parenthetical notes, or translator chatter.

4. HISTORICAL CONTINUITY:
   - Any dialogue history or glossary provided in background context represents prior pages only.
   - Detect, transcribe, and translate ONLY text that visibly appears in the currently provided image.
   - NEVER create or output bubbles for dialogue from prior pages.`;

  if (context) {
    prompt +=
      '\n\nCONTEXT & CONTINUITY (Historical reference from prior pages; do NOT re-output as current bubbles):';

    if (context.seriesTitle) {
      prompt += `\n- Series Title: "${context.seriesTitle}"`;
    }

    if (context.translationStyle) {
      prompt += `\n- Translation Style: ${context.translationStyle}`;
    }

    if (context.preserveHonorifics !== undefined) {
      prompt += `\n- Preserve Japanese honorifics (e.g. -san, -kun, -chan, senpai): ${context.preserveHonorifics ? 'YES' : 'NO'}`;
    }

    if (context.characters && context.characters.length > 0) {
      prompt += '\n- Known Characters:';
      for (const char of context.characters) {
        prompt += `\n  * ${char.name}${char.description ? ` (${char.description})` : ''}`;
      }
    }

    if (context.glossary && context.glossary.length > 0) {
      prompt += '\n- Established Glossary (MUST preserve these exact translations):';
      for (const entry of context.glossary) {
        prompt += `\n  * "${entry.original}" -> "${entry.translation}"${entry.isHard ? ' [MANDATORY]' : ''}`;
      }
    }

    if (context.recentDialogue && context.recentDialogue.length > 0) {
      prompt += '\n- Recent Dialogue History (for narrative continuity):';
      const recent = context.recentDialogue.slice(-10);
      for (const d of recent) {
        prompt += `\n  * ${d.speaker ? `${d.speaker}: ` : ''}"${d.translatedText}"`;
      }
    }

    if (context.chapterSummary) {
      prompt += `\n- Recent Chapter Summary: ${context.chapterSummary}`;
    }
  }

  prompt += `\n\nOUTPUT FORMAT:
Respond ONLY with a valid JSON object adhering to this structure:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "source_text": "Original text in Japanese/Korean",
      "translated_text": "Translated dialogue in ${targetLanguageName}",
      "bubble_type": "speech" | "narration" | "thought" | "other",
      "speaker": "Speaker name if identifiable or null",
      "reading_order": 1
    }
  ],
  "context_delta": {
    "characters_discovered": [{ "name": "...", "description": "..." }],
    "glossary_updates": [{ "original": "...", "translation": "..." }],
    "scene_summary": "Brief summary of what happened on this page"
  }
}`;

  return prompt;
}

export function getTranslationResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      bubbles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            box_2d: {
              type: 'array',
              items: { type: 'integer' },
              minItems: 4,
              maxItems: 4,
              description: 'Normalized [ymin, xmin, ymax, xmax] 0-1000',
            },
            source_text: { type: ['string', 'null'] },
            translated_text: { type: 'string' },
            bubble_type: {
              type: 'string',
              enum: ['speech', 'narration', 'thought', 'sfx', 'other'],
            },
            speaker: { type: ['string', 'null'] },
            reading_order: { type: 'integer' },
          },
          required: [
            'box_2d',
            'source_text',
            'translated_text',
            'bubble_type',
            'speaker',
            'reading_order',
          ],
        },
      },
      context_delta: {
        type: 'object',
        additionalProperties: false,
        properties: {
          characters_discovered: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                description: { type: ['string', 'null'] },
              },
              required: ['name', 'description'],
            },
          },
          glossary_updates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                original: { type: 'string' },
                translation: { type: 'string' },
              },
              required: ['original', 'translation'],
            },
          },
          scene_summary: { type: ['string', 'null'] },
        },
        required: ['characters_discovered', 'glossary_updates', 'scene_summary'],
      },
    },
    required: ['bubbles', 'context_delta'],
  };
}
