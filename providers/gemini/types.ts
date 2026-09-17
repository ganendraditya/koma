/**
 * Google Gemini REST API request and response data structures.
 */

export interface GeminiInlineData {
  mimeType: string;
  data: string; // Base64-encoded binary data without prefix
}

export type GeminiPart =
  { text: string; inlineData?: never } | { inlineData: GeminiInlineData; text?: never };

export interface GeminiContent {
  role?: 'user' | 'model' | 'system';
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json' | 'text/plain';
  responseSchema?: Record<string, unknown>;
}

export interface GeminiRequestPayload {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: { text: string }[];
  };
  generationConfig?: GeminiGenerationConfig;
}

export interface GeminiCandidate {
  content?: {
    parts?: { text?: string }[];
    role?: string;
  };
  finishReason?: string;
  index?: number;
}

export interface GeminiErrorResponse {
  error?: {
    code: number;
    message: string;
    status: string;
    details?: unknown[];
  };
}

export interface GeminiResponsePayload {
  candidates?: GeminiCandidate[];
  error?: GeminiErrorResponse['error'];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Structured bubble output expected from Gemini JSON response.
 */
export interface GeminiRawBubble {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  source_text?: string;
  translated_text: string;
  bubble_type?: 'speech' | 'narration' | 'thought' | 'sfx' | 'other';
  speaker?: string | null;
  reading_order?: number;
}

export interface GeminiRawContextDelta {
  characters_discovered?: { name: string; description?: string }[];
  glossary_updates?: { original: string; translation: string }[];
  scene_summary?: string | null;
}

export interface GeminiStructuredOutput {
  bubbles: GeminiRawBubble[];
  context_delta?: GeminiRawContextDelta;
}
