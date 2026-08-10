// @phase TQ-04/TQ-08 — validated Qur'an corpus, index, and license-gated content editions.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { alignTranscriptSequence, matchTranscript } from "../lib/media-core.mjs";

const EXPECTED = { surahs: 114, ayahs: 6236, juz: 30, pages: 604, rubus: 240 };
const DEFAULT_SOURCE = "https://api.alquran.cloud/v1/quran/quran-uthmani";

function locations() {
  const root = process.env.TQ_DATA_DIR || path.join(process.cwd(), "data");
  return {
    root,
    corpus: path.join(root, "quran", "quran-uthmani.json"),
    metadata: path.join(root, "quran", "metadata.json"),
    content: path.join(root, "quran", "content"),
  };
}

async function sourceRegistry() {
  const bundled = JSON.parse(await readFile(new URL("./sources/quran-content-sources.json", import.meta.url), "utf8"));
  let configured = [];
  if (process.env.TQ_QURAN_CONTENT_SOURCES_JSON) {
    try {
      const parsed = JSON.parse(process.env.TQ_QURAN_CONTENT_SOURCES_JSON);
      configured = Array.isArray(parsed) ? parsed : parsed.sources || [];
    } catch {
      throw new Error("TQ_QURAN_CONTENT_SOURCES_JSON bukan JSON yang valid.");
    }
  }
  const merged = new Map((bundled.sources || []).map((item) => [item.edition, item]));
  for (const item of configured) merged.set(item.edition, { ...merged.get(item.edition), ...item });
  return [...merged.values()];
}

export async function readCorpus() {
  const { corpus } = locations();
  return JSON.parse(await readFile(corpus, "utf8"));
}

export async function corpusStatus() {
  const { corpus, metadata } = locations();
  try {
    const [info, meta] = await Promise.all([stat(corpus), readFile(metadata, "utf8")]);
    return { available: true, sizeBytes: info.size, ...JSON.parse(meta) };
  } catch {
    return { available: false, expected: EXPECTED };
  }
}

export async function syncCorpus() {
  const source = process.env.TQ_QURAN_SOURCE_URL || DEFAULT_SOURCE;
  const response = await fetch(source, { headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/0.2" } });
  if (!response.ok) throw new Error(`Sumber korpus merespons HTTP ${response.status}`);
  const payload = await response.json();
  const sourceSurahs = payload?.data?.surahs;
  if (!Array.isArray(sourceSurahs) || sourceSurahs.length !== EXPECTED.surahs) {
    throw new Error("Sinkronisasi dibatalkan: sumber tidak memuat tepat 114 surah.");
  }

  const surahs = [];
  const ayahs = [];
  const unique = new Set();
  const juz = new Set();
  const pages = new Set();
  const rubus = new Set();

  for (const sourceSurah of sourceSurahs) {
    const surahNumber = Number(sourceSurah.number);
    const sourceAyahs = Array.isArray(sourceSurah.ayahs) ? sourceSurah.ayahs : [];
    surahs.push({
      number: surahNumber,
      nameArabic: String(sourceSurah.name || ""),
      nameLatin: String(sourceSurah.englishName || `Surah ${surahNumber}`),
      nameTranslation: String(sourceSurah.englishNameTranslation || ""),
      revelationType: String(sourceSurah.revelationType || ""),
      ayahCount: sourceAyahs.length,
    });
    for (const sourceAyah of sourceAyahs) {
      const globalNumber = Number(sourceAyah.number);
      const ayah = {
        globalNumber,
        surahNumber,
        surah: String(sourceSurah.englishName || `Surah ${surahNumber}`),
        ayah: Number(sourceAyah.numberInSurah),
        arabic: String(sourceAyah.text || ""),
        juz: Number(sourceAyah.juz) || null,
        page: Number(sourceAyah.page) || null,
        rubu: Number(sourceAyah.hizbQuarter) || null,
      };
      if (!ayah.globalNumber || !ayah.ayah || !ayah.arabic) throw new Error("Korpus memuat baris ayat yang tidak lengkap.");
      unique.add(globalNumber);
      if (ayah.juz) juz.add(ayah.juz);
      if (ayah.page) pages.add(ayah.page);
      if (ayah.rubu) rubus.add(ayah.rubu);
      ayahs.push(ayah);
    }
  }

  if (ayahs.length !== EXPECTED.ayahs || unique.size !== EXPECTED.ayahs || juz.size !== EXPECTED.juz || pages.size !== EXPECTED.pages || rubus.size !== EXPECTED.rubus) {
    throw new Error(`Korpus tidak lengkap (${surahs.length} surah, ${ayahs.length} ayat, ${juz.size} juz, ${pages.size} halaman, ${rubus.size} rubu).`);
  }

  const corpus = { schemaVersion: 1, edition: payload?.data?.edition?.identifier || "quran-uthmani", surahs, ayahs };
  const serialized = `${JSON.stringify(corpus)}\n`;
  const checksum = createHash("sha256").update(serialized).digest("hex");
  const { root, corpus: corpusPath, metadata } = locations();
  await mkdir(path.join(root, "quran"), { recursive: true });
  const temporary = `${corpusPath}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o640 });
  await rename(temporary, corpusPath);
  const meta = {
    syncedAt: new Date().toISOString(),
    source,
    edition: corpus.edition,
    checksum: `sha256:${checksum}`,
    counts: { surahs: surahs.length, ayahs: ayahs.length, juz: juz.size, pages: pages.size, rubus: rubus.size },
    expected: EXPECTED,
  };
  await writeFile(metadata, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o640 });
  return { available: true, ...meta };
}

export async function matchAgainstCorpus(transcript, limit = 10) {
  const corpus = await readCorpus();
  return matchTranscript(String(transcript || ""), corpus.ayahs, Math.min(20, Math.max(1, Number(limit) || 10)));
}

export async function alignAgainstCorpus(parts, options = {}) {
  const corpus = await readCorpus();
  return alignTranscriptSequence(Array.isArray(parts) ? parts : [], corpus.ayahs, options);
}

export async function getSurah(number) {
  const corpus = await readCorpus();
  const surahNumber = Number(number);
  const surah = corpus.surahs.find((item) => item.number === surahNumber);
  if (!surah) return null;
  return { ...surah, ayahs: corpus.ayahs.filter((item) => item.surahNumber === surahNumber) };
}

export async function listSurahs() {
  const corpus = await readCorpus();
  return corpus.surahs.map((surah) => ({ ...surah }));
}

export async function listContentSources() {
  return (await sourceRegistry()).map(({ sourceUrl, ...item }) => ({ ...item, sourceConfigured: Boolean(sourceUrl) }));
}

export async function contentStatus() {
  const { content } = locations();
  const sources = await sourceRegistry();
  const statuses = [];
  for (const source of sources) {
    try {
      const metadata = JSON.parse(await readFile(path.join(content, `${source.edition}.metadata.json`), "utf8"));
      statuses.push({ edition: source.edition, available: true, ...metadata });
    } catch {
      statuses.push({ edition: source.edition, available: false, enabled: Boolean(source.enabled), licenseName: source.licenseName });
    }
  }
  return statuses;
}

export async function syncContentEdition(edition) {
  const source = (await sourceRegistry()).find((item) => item.edition === edition);
  if (!source) throw new Error("Sumber terjemahan/tafsir tidak terdaftar.");
  if (!source.enabled || source.redistributionAllowed !== true || !source.licenseName || source.licenseName === "verification-required") {
    throw Object.assign(new Error("Sinkronisasi diblokir sampai izin redistribusi dan metadata lisensi sumber diverifikasi."), { statusCode: 409, code: "LICENSE_VERIFICATION_REQUIRED" });
  }
  const response = await fetch(source.sourceUrl, { headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/1.0" } });
  if (!response.ok) throw new Error(`Sumber ${edition} merespons HTTP ${response.status}`);
  const payload = await response.json();
  const sourceSurahs = payload?.data?.surahs;
  if (!Array.isArray(sourceSurahs) || sourceSurahs.length !== EXPECTED.surahs) throw new Error("Edisi tidak memuat tepat 114 surah.");
  const entries = [];
  for (const surah of sourceSurahs) for (const ayah of (surah.ayahs || [])) entries.push({
    globalNumber: Number(ayah.number),
    surahNumber: Number(surah.number),
    ayah: Number(ayah.numberInSurah),
    text: String(ayah.text || ""),
  });
  if (entries.length !== EXPECTED.ayahs || entries.some((item) => !item.globalNumber || !item.ayah || !item.text)) throw new Error("Edisi tidak memuat tepat 6.236 baris lengkap.");
  const document = {
    schemaVersion: 1,
    edition,
    kind: source.kind,
    language: source.language,
    name: source.name,
    author: source.author,
    license: { name: source.licenseName, url: source.licenseUrl },
    sourceUrl: source.sourceUrl,
    entries,
  };
  const serialized = `${JSON.stringify(document)}\n`;
  const checksum = `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
  const { content } = locations();
  await mkdir(content, { recursive: true });
  const target = path.join(content, `${edition}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o640 });
  await rename(temporary, target);
  const metadata = { edition, kind: source.kind, language: source.language, name: source.name, author: source.author, license: document.license, sourceUrl: source.sourceUrl, syncedAt: new Date().toISOString(), checksum, entries: entries.length };
  await writeFile(path.join(content, `${edition}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
  return { available: true, ...metadata };
}

export async function getContentEntry(edition, surahNumber, ayahNumber) {
  const { content } = locations();
  const document = JSON.parse(await readFile(path.join(content, `${String(edition).replace(/[^a-z0-9._-]/gi, "")}.json`), "utf8"));
  return document.entries.find((item) => item.surahNumber === Number(surahNumber) && item.ayah === Number(ayahNumber)) || null;
}
