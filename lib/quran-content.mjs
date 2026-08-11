// Shared Qur'an content helpers used by both the browser studio and Node services.

export function cleanQuranContentText(value) {
  return String(value ?? "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function mergeArabicIntoSegments(segments, surahs) {
  const arabicByReference = new Map();
  const surahNames = new Map();

  for (const surah of Array.isArray(surahs) ? surahs : []) {
    const surahNumber = Number(surah?.number);
    if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) continue;
    surahNames.set(surahNumber, String(surah?.nameLatin || `Surah ${surahNumber}`));
    for (const ayah of Array.isArray(surah?.ayahs) ? surah.ayahs : []) {
      const ayahNumber = Number(ayah?.ayah ?? ayah?.numberInSurah);
      const arabic = String(ayah?.arabic ?? ayah?.text ?? "").trim();
      if (Number.isInteger(ayahNumber) && ayahNumber >= 1 && arabic) {
        arabicByReference.set(`${surahNumber}:${ayahNumber}`, arabic);
      }
    }
  }

  return (Array.isArray(segments) ? segments : []).map((segment) => {
    if (String(segment?.arabic || "").trim()) return segment;
    const surahNumber = Number(segment?.surahNumber);
    const ayahNumber = Number(segment?.ayah);
    const arabic = arabicByReference.get(`${surahNumber}:${ayahNumber}`);
    if (!arabic) return segment;
    return {
      ...segment,
      surah: surahNames.get(surahNumber) || segment.surah,
      arabic,
      confidence: Math.max(Number(segment.confidence) || 0, 100),
    };
  });
}
