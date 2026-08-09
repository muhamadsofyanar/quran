import assert from "node:assert/strict";
import test from "node:test";
import { alignTranscriptSequence, arabicSimilarity, buildAss, buildSrt, buildVtt, matchTranscript, normalizeArabic } from "../lib/media-core.mjs";

const segments = [
  { start: 0, end: 4.8, arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", translation: "Dengan nama Allah." },
  { start: 4.8, end: 10.7, arabic: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ", translation: "Segala puji bagi Allah." },
];

test("normalisasi Arab mengabaikan harakat untuk pencocokan", () => {
  assert.equal(normalizeArabic("بِسْمِ اللَّهِ"), "بسم الله");
  assert.ok(arabicSimilarity("الحمد لله رب العالمين", segments[1].arabic) > 0.9);
});

test("pencocokan menempatkan ayat paling mirip di urutan pertama", () => {
  const matches = matchTranscript("الحمد لله رب العالمين", [
    { surah: "Al-Fatihah", surahNumber: 1, ayah: 1, arabic: segments[0].arabic },
    { surah: "Al-Fatihah", surahNumber: 1, ayah: 2, arabic: segments[1].arabic },
  ]);
  assert.equal(matches[0].ayah, 2);
});

test("ekspor subtitle menghasilkan SRT, VTT, dan ASS valid", () => {
  assert.match(buildSrt(segments), /00:00:00,000 --> 00:00:04,800/);
  assert.match(buildVtt(segments), /^WEBVTT/);
  assert.match(buildAss(segments), /\[Events\]/);
  assert.match(buildAss(segments), /Dialogue: 0/);
});

test("alignment menjaga urutan, mengenali pengulangan, dan membawa timestamp kata", () => {
  const corpus = [
    { globalNumber: 1, surah: "Al-Fatihah", surahNumber: 1, ayah: 1, arabic: segments[0].arabic },
    { globalNumber: 2, surah: "Al-Fatihah", surahNumber: 1, ayah: 2, arabic: segments[1].arabic },
  ];
  const aligned = alignTranscriptSequence([
    { text: "بسم الله الرحمن الرحيم", start: 0, end: 4.8 },
    { text: "بسم الله الرحمن الرحيم", start: 4.8, end: 8.2 },
    { text: "الحمد لله رب العالمين", start: 8.2, end: 13, words: [{ word: "الحمد", start: 8.2, end: 8.8, probability: .98 }] },
  ], corpus);
  assert.equal(aligned[0].ayah.ayah, 1);
  assert.equal(aligned[1].repeated, true);
  assert.equal(aligned[2].ayah.ayah, 2);
  assert.equal(aligned[2].words[0].confidence, 98);
});
