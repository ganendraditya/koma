/**
 * Website-specific manga readers & image extractors (e.g. MangaDex)
 */

export interface SiteAdapter {
  name: string;
  matches(url: string): boolean;
  detectMangaImages(): HTMLImageElement[];
}
