export { buildTranslationPrompt as buildGeminiSystemPrompt } from '../common/prompt';

export function getGeminiResponseSchema(): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      bubbles: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            box_2d: {
              type: 'ARRAY',
              items: { type: 'INTEGER' },
              description: 'Normalized [ymin, xmin, ymax, xmax] 0-1000',
            },
            source_text: { type: 'STRING' },
            translated_text: { type: 'STRING' },
            bubble_type: {
              type: 'STRING',
              enum: ['speech', 'narration', 'thought', 'sfx', 'other'],
            },
            speaker: { type: 'STRING' },
            reading_order: { type: 'INTEGER' },
          },
          required: ['box_2d', 'translated_text'],
        },
      },
      context_delta: {
        type: 'OBJECT',
        properties: {
          characters_discovered: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { name: { type: 'STRING' }, description: { type: 'STRING' } },
              required: ['name'],
            },
          },
          glossary_updates: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { original: { type: 'STRING' }, translation: { type: 'STRING' } },
              required: ['original', 'translation'],
            },
          },
          scene_summary: { type: 'STRING' },
        },
      },
    },
    required: ['bubbles'],
  };
}
