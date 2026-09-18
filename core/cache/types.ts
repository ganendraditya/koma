import { TranslationResult, MangaImage } from '../contracts';

export interface CacheKeyInput {
  image: Pick<MangaImage, 'id'> & Partial<Pick<MangaImage, 'url' | 'pageIndex'>>;
  targetLanguage: string;
  sourceLanguage?: string;
  providerId?: string;
  modelId?: string;
}

export interface CacheEntry {
  key: string;
  result: TranslationResult;
  cachedAt: number;
}

export interface TranslationCache {
  get(key: string): Promise<TranslationResult | null>;
  set(key: string, result: TranslationResult): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
}
