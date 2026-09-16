/**
 * Shared types, constants, and utilities across Koma modules.
 */

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DialogueBubble {
  id: string;
  box: BoundingBox;
  sourceText?: string;
  translatedText: string;
}
