export type SubtitleSegment = {
  start: number;
  end: number;
  arabic: string;
  translation: string;
  tafsir?: string;
};

export type QuranMatchItem = {
  surah: string;
  surahNumber: number;
  ayah: number;
  arabic: string;
  translation?: string;
};

export function normalizeArabic(value?: string): string;
export function arabicSimilarity(left: string, right: string): number;
export function matchTranscript<T extends QuranMatchItem>(transcript: string, ayahs: T[], limit?: number): Array<T & { score: number }>;
export type TranscriptWord = { word?: string; start?: number; end?: number; probability?: number };
export type TranscriptPart = { text: string; start?: number; end?: number; confidence?: number; avg_logprob?: number; words?: TranscriptWord[] };
export function alignTranscriptSequence<T extends QuranMatchItem>(parts: TranscriptPart[], ayahs: T[], options?: { lookBehind?: number; lookAhead?: number; alternatives?: number; threshold?: number }): Array<{
  partIndex: number;
  text: string;
  start?: number | null;
  end?: number | null;
  matched: boolean;
  repeated?: boolean;
  confidence: number;
  ayah?: T & { score: number; similarity: number; corpusIndex: number };
  alternatives: Array<T & { score: number; similarity: number }>;
  words?: Array<{ word: string; heard: string; start: number; end: number; confidence: number | null }>;
}>;
export function formatSubtitleTime(seconds: number, decimal?: string): string;
export function buildSrt(segments: SubtitleSegment[], mode?: "arabic" | "translation" | "tafsir" | "both" | "all"): string;
export function buildVtt(segments: SubtitleSegment[], mode?: "arabic" | "translation" | "tafsir" | "both" | "all"): string;
export function buildAss(segments: SubtitleSegment[], mode?: "arabic" | "translation" | "tafsir" | "both" | "all", ratio?: "16:9" | "9:16" | "1:1"): string;
