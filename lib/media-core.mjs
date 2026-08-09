// @phase TQ-04 — deterministic subtitles and sequence-aware Qur'an alignment.

const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export function normalizeArabic(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(ARABIC_MARKS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u063A\u0641-\u064A0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(value, size = 3) {
  const compact = normalizeArabic(value).replace(/\s/g, "");
  if (!compact) return new Set();
  if (compact.length <= size) return new Set([compact]);
  const result = new Set();
  for (let index = 0; index <= compact.length - size; index += 1) {
    result.add(compact.slice(index, index + size));
  }
  return result;
}

export function arabicSimilarity(left, right) {
  const normalizedLeft = normalizeArabic(left);
  const normalizedRight = normalizeArabic(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    const shorter = Math.min(normalizedLeft.length, normalizedRight.length);
    const longer = Math.max(normalizedLeft.length, normalizedRight.length);
    return Math.min(1, 0.72 + (shorter / longer) * 0.28);
  }
  const leftSet = ngrams(normalizedLeft);
  const rightSet = ngrams(normalizedRight);
  let overlap = 0;
  for (const item of leftSet) if (rightSet.has(item)) overlap += 1;
  return (2 * overlap) / Math.max(1, leftSet.size + rightSet.size);
}

export function matchTranscript(transcript, ayahs, limit = 8) {
  return ayahs
    .map((ayah) => ({ ...ayah, score: arabicSimilarity(transcript, ayah.arabic) }))
    .filter((ayah) => ayah.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function candidateWindow(ayahs, previousIndex, lookBehind, lookAhead) {
  if (!Number.isInteger(previousIndex) || previousIndex < 0) return ayahs.map((ayah, index) => ({ ayah, index }));
  const start = Math.max(0, previousIndex - lookBehind);
  const end = Math.min(ayahs.length, previousIndex + lookAhead + 1);
  return ayahs.slice(start, end).map((ayah, index) => ({ ayah, index: start + index }));
}

function sourceConfidence(part) {
  if (Number.isFinite(part.confidence)) return Math.max(0, Math.min(1, Number(part.confidence)));
  if (Number.isFinite(part.avg_logprob)) return Math.max(0, Math.min(1, Math.exp(Number(part.avg_logprob))));
  return 0.8;
}

function alignWords(part, ayah) {
  const timed = Array.isArray(part.words) ? part.words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end)) : [];
  const verseWords = String(ayah.arabic || "").trim().split(/\s+/).filter(Boolean);
  if (!timed.length || !verseWords.length) return [];
  return timed.map((word, index) => ({
    word: verseWords[Math.min(verseWords.length - 1, Math.floor((index / Math.max(1, timed.length - 1)) * (verseWords.length - 1)))],
    heard: String(word.word || "").trim(),
    start: Number(word.start),
    end: Number(word.end),
    confidence: Number.isFinite(word.probability) ? Math.round(Math.max(0, Math.min(1, word.probability)) * 100) : null,
  }));
}

export function alignTranscriptSequence(parts, ayahs, options = {}) {
  const lookBehind = Math.max(1, Number(options.lookBehind || 3));
  const lookAhead = Math.max(8, Number(options.lookAhead || 24));
  const alternativesLimit = Math.max(1, Math.min(5, Number(options.alternatives || 3)));
  const threshold = Math.max(0.05, Math.min(0.95, Number(options.threshold || 0.16)));
  let previousIndex = -1;
  const aligned = [];

  for (const [partIndex, part] of parts.entries()) {
    const text = String(part.text || "").trim();
    if (!normalizeArabic(text)) continue;
    const window = candidateWindow(ayahs, previousIndex, lookBehind, lookAhead);
    let scored = window
      .map(({ ayah, index }) => {
        const similarity = arabicSimilarity(text, ayah.arabic);
        const distance = previousIndex < 0 ? 0 : index - previousIndex;
        const sequenceBonus = previousIndex < 0 ? 0 : distance === 1 ? 0.09 : distance === 0 ? 0.06 : distance > 1 && distance <= 4 ? 0.035 : 0;
        const backwardsPenalty = distance < -1 ? Math.min(0.2, Math.abs(distance) * 0.025) : 0;
        return { ...ayah, corpusIndex: index, similarity, score: Math.max(0, Math.min(1, similarity + sequenceBonus - backwardsPenalty)) };
      })
      .sort((left, right) => right.score - left.score);

    if (previousIndex < 0 && scored[0]?.score < 0.42) {
      scored = ayahs.map((ayah, index) => ({ ...ayah, corpusIndex: index, similarity: arabicSimilarity(text, ayah.arabic), score: arabicSimilarity(text, ayah.arabic) })).sort((left, right) => right.score - left.score);
    }
    const best = scored[0];
    if (!best || best.score < threshold) {
      aligned.push({ partIndex, text, start: part.start, end: part.end, matched: false, confidence: 0, alternatives: scored.slice(0, alternativesLimit) });
      continue;
    }
    const repeated = best.corpusIndex === previousIndex;
    const confidence = Math.round((best.score * 0.78 + sourceConfidence(part) * 0.22) * 100);
    const item = {
      partIndex,
      text,
      start: Number.isFinite(part.start) ? Number(part.start) : null,
      end: Number.isFinite(part.end) ? Number(part.end) : null,
      matched: true,
      repeated,
      confidence,
      ayah: best,
      alternatives: scored.slice(1, alternativesLimit + 1),
      words: alignWords(part, best),
    };
    aligned.push(item);
    previousIndex = best.corpusIndex;
  }

  return aligned;
}

export function formatSubtitleTime(seconds, decimal = ",") {
  const safe = Math.max(0, Number(seconds) || 0);
  const milliseconds = Math.round(safe * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${decimal}${String(millis).padStart(3, "0")}`;
}

function segmentText(segment, mode) {
  const arabic = String(segment.arabic || "").trim();
  const translation = String(segment.translation || "").trim();
  if (mode === "arabic") return arabic;
  if (mode === "translation") return translation;
  return [arabic, translation].filter(Boolean).join("\n");
}

export function buildSrt(segments, mode = "both") {
  return segments
    .filter((segment) => Number(segment.end) > Number(segment.start))
    .map((segment, index) => `${index + 1}\n${formatSubtitleTime(segment.start)} --> ${formatSubtitleTime(segment.end)}\n${segmentText(segment, mode)}\n`)
    .join("\n");
}

export function buildVtt(segments, mode = "both") {
  const cues = segments
    .filter((segment) => Number(segment.end) > Number(segment.start))
    .map((segment) => `${formatSubtitleTime(segment.start, ".")} --> ${formatSubtitleTime(segment.end, ".")}\n${segmentText(segment, mode)}\n`)
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}

function assTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const centiseconds = Math.round(safe * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cents = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cents).padStart(2, "0")}`;
}

function escapeAss(value) {
  return String(value || "").replace(/[\r\n]+/g, "\\N").replace(/[{}]/g, "");
}

export function buildAss(segments, mode = "both", ratio = "16:9") {
  const portrait = ratio === "9:16";
  const square = ratio === "1:1";
  const width = portrait ? 1080 : square ? 1080 : 1920;
  const height = portrait ? 1920 : square ? 1080 : 1080;
  const events = segments
    .filter((segment) => Number(segment.end) > Number(segment.start))
    .map((segment) => {
      const text = escapeAss(segmentText(segment, mode));
      return `Dialogue: 0,${assTime(segment.start)},${assTime(segment.end)},Quran,,0,0,0,,${text}`;
    })
    .join("\n");
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Quran,Arial,${portrait ? 58 : 64},&H00FFFFFF,&H000000FF,&H00102018,&H66000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,110,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
}
