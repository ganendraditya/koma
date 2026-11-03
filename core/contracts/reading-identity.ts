/** Stable reader identity supplied by a site adapter without exposing DOM details to core. */
export interface ReadingIdentity {
  site: string;
  chapterId: string;
  seriesId?: string;
}
