export type QuranSegmentLike = {
  arabic?: string;
  surah?: string;
  surahNumber?: number;
  ayah?: number;
  confidence?: number;
};

export type QuranSurahLike = {
  number?: number;
  nameLatin?: string;
  ayahs?: Array<{ ayah?: number; numberInSurah?: number; arabic?: string; text?: string }>;
};

export function cleanQuranContentText(value: unknown): string;
export function mergeArabicIntoSegments<T extends QuranSegmentLike>(segments: T[], surahs: QuranSurahLike[]): T[];
