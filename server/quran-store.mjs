// @phase TQ-04/TQ-08/TQ-12 — validated Qur'an corpus plus on-demand multilingual translation/tafsir catalog.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { alignTranscriptSequence, matchTranscript } from "../lib/media-core.mjs";
import { cleanQuranContentText } from "../lib/quran-content.mjs";

const EXPECTED = { surahs: 114, ayahs: 6236, juz: 30, pages: 604, rubus: 240 };
const DEFAULT_SOURCE = "https://api.alquran.cloud/v1/quran/quran-uthmani";
const QURANENC_BASE = "https://quranenc.com/api/v1";
const QURANENC_CATALOG_TTL = 6 * 60 * 60 * 1000;
const CONTENT_CACHE_MAX_AGE = Math.max(60_000, Number(process.env.TQ_CONTENT_CACHE_SECONDS || 604800) * 1000);
let quranEncCatalogCache = { fetchedAt: 0, items: [] };
const contentInflight = new Map();

function locations() {
  const root = process.env.TQ_DATA_DIR || path.join(process.cwd(), "data");
  return {
    root,
    corpus: path.join(root, "quran", "quran-uthmani.json"),
    metadata: path.join(root, "quran", "metadata.json"),
    content: path.join(root, "quran", "content"),
  };
}

function safeKey(value) {
  return String(value || "").replace(/[^a-z0-9._:-]/gi, "").slice(0, 160);
}

function sourceCacheDirectory(source) {
  return path.join(locations().content, safeKey(source.edition).replace(/:/g, "--"));
}

function sourceCachePath(source, surahNumber) {
  return path.join(sourceCacheDirectory(source), `surah-${String(surahNumber).padStart(3, "0")}.json`);
}

async function fetchJson(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/1.2" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Sumber merespons HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function bundledRegistry() {
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
  for (const item of configured) {
    if (!item?.edition) continue;
    merged.set(item.edition, { ...merged.get(item.edition), ...item });
  }
  return [...merged.values()];
}

function normalizeQuranEncCatalog(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.translations)
      ? payload.translations
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.result)
          ? payload.result
          : [];
  return raw
    .map((item) => {
      const key = safeKey(item?.key || item?.translation_key || item?.id);
      if (!key) return null;
      const language = String(item?.language_iso_code || item?.language || "").toLowerCase() || "und";
      const title = String(item?.title || item?.name || key).trim();
      const description = String(item?.description || "").trim();
      const combined = `${key} ${title} ${description}`.toLowerCase();
      const kind = /tafsir|tafsīr|mokhtasar|mukhtasar|interpretation/.test(combined) ? "tafsir" : "translation";
      return {
        edition: `quranenc:${key}`,
        provider: "quranenc",
        providerKey: key,
        kind,
        language,
        name: title,
        author: description || "QuranEnc translation catalog",
        version: String(item?.version || "latest"),
        lastUpdate: item?.last_update || null,
        sourceUrl: `${QURANENC_BASE}/translation/sura/${encodeURIComponent(key)}/{surah}`,
        licenseName: "QuranEnc republication terms",
        licenseUrl: "https://quranenc.com/en/home",
        attribution: `Source: QuranEnc.com — ${title}`,
        redistributionAllowed: true,
        enabled: true,
        preferred: false,
      };
    })
    .filter(Boolean);
}

async function discoverQuranEncSources() {
  if (process.env.TQ_QURANENC_DISCOVERY === "false") return [];
  if (Date.now() - quranEncCatalogCache.fetchedAt < QURANENC_CATALOG_TTL && quranEncCatalogCache.items.length) {
    return quranEncCatalogCache.items;
  }
  try {
    const payload = await fetchJson(`${QURANENC_BASE}/translations/list?localization=id`, 12_000);
    const items = normalizeQuranEncCatalog(payload);
    if (items.length) quranEncCatalogCache = { fetchedAt: Date.now(), items };
    return items;
  } catch {
    return quranEncCatalogCache.items || [];
  }
}

async function sourceRegistry({ discover = false } = {}) {
  const bundled = await bundledRegistry();
  if (!discover) return bundled;
  const live = await discoverQuranEncSources();
  const merged = new Map(bundled.map((item) => [item.edition, item]));
  for (const item of live) {
    const current = merged.get(item.edition);
    merged.set(item.edition, current ? {
      ...current,
      version: item.version || current.version,
      lastUpdate: item.lastUpdate || current.lastUpdate,
      language: item.language || current.language,
      providerKey: item.providerKey || current.providerKey,
    } : item);
  }
  return [...merged.values()].sort((a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || String(a.language).localeCompare(String(b.language)) || String(a.name).localeCompare(String(b.name)));
}

async function findSource(edition) {
  const normalized = safeKey(edition);
  const bundled = await sourceRegistry();
  const found = bundled.find((item) => item.edition === normalized);
  if (found) {
    if (found.provider === "quranenc" && process.env.TQ_QURANENC_DISCOVERY !== "false") {
      const live = (await discoverQuranEncSources()).find((item) => item.edition === normalized);
      if (live) return { ...found, version: live.version || found.version, lastUpdate: live.lastUpdate || found.lastUpdate };
    }
    return found;
  }
  if (normalized.startsWith("quranenc:")) {
    const providerKey = safeKey(normalized.slice("quranenc:".length));
    if (!providerKey) return null;
    const live = (await discoverQuranEncSources()).find((item) => item.providerKey === providerKey);
    if (live) return live;
    return {
      edition: normalized,
      provider: "quranenc",
      providerKey,
      kind: "translation",
      language: "und",
      name: providerKey,
      author: "QuranEnc translation catalog",
      version: "latest",
      sourceUrl: `${QURANENC_BASE}/translation/sura/${encodeURIComponent(providerKey)}/{surah}`,
      licenseName: "QuranEnc republication terms",
      licenseUrl: "https://quranenc.com/en/home",
      attribution: `Source: QuranEnc.com — ${providerKey}`,
      redistributionAllowed: true,
      enabled: true,
    };
  }
  return null;
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
  const response = await fetch(source, { headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/1.2" } });
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

export async function listContentSources(options = {}) {
  const sources = await sourceRegistry({ discover: options.discover !== false });
  const language = String(options.language || "").toLowerCase();
  const kind = String(options.kind || "").toLowerCase();
  return sources
    .filter((source) => !language || source.language === language)
    .filter((source) => !kind || source.kind === kind)
    .map(({ sourceUrl, ...item }) => ({ ...item, sourceConfigured: Boolean(sourceUrl), onDemand: item.provider === "quranenc" }));
}

async function cacheSummary(source) {
  try {
    const names = await readdir(sourceCacheDirectory(source));
    const cachedSurahs = names.filter((name) => /^surah-\d{3}\.json$/.test(name)).length;
    return { cachedSurahs, cached: cachedSurahs > 0, complete: cachedSurahs === EXPECTED.surahs };
  } catch {
    return { cachedSurahs: 0, cached: false, complete: false };
  }
}

export async function contentStatus() {
  const sources = await sourceRegistry();
  const statuses = [];
  for (const source of sources) {
    if (source.provider === "quranenc") {
      const cached = await cacheSummary(source);
      statuses.push({
        edition: source.edition,
        available: Boolean(source.enabled && source.redistributionAllowed),
        enabled: Boolean(source.enabled),
        licenseName: source.licenseName,
        provider: source.provider,
        onDemand: true,
        version: source.version || "latest",
        ...cached,
      });
      continue;
    }
    try {
      const metadata = JSON.parse(await readFile(path.join(locations().content, `${safeKey(source.edition)}.metadata.json`), "utf8"));
      statuses.push({ edition: source.edition, available: true, ...metadata });
    } catch {
      statuses.push({ edition: source.edition, available: false, enabled: Boolean(source.enabled), licenseName: source.licenseName });
    }
  }
  return statuses;
}

function normalizeQuranEncSurahPayload(payload, source, surahNumber) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.translations)
          ? payload.translations
          : [];
  return raw
    .map((item) => ({
      surahNumber: Number(item?.sura ?? item?.surah ?? surahNumber),
      ayah: Number(item?.aya ?? item?.ayah),
      text: cleanQuranContentText(item?.translation ?? item?.text ?? ""),
      footnotes: item?.footnotes ?? null,
      edition: source.edition,
      kind: source.kind,
      language: source.language,
      sourceName: source.name,
      sourceVersion: source.version || "latest",
      attribution: source.attribution || `Source: QuranEnc.com — ${source.name}`,
    }))
    .filter((item) => item.surahNumber === surahNumber && item.ayah >= 1 && item.text.trim());
}

async function fetchQuranEncSurah(source, surahNumber) {
  if (!source.enabled || source.redistributionAllowed !== true) {
    throw Object.assign(new Error("Sumber belum diizinkan untuk digunakan."), { statusCode: 409, code: "SOURCE_NOT_ENABLED" });
  }
  const corpus = await readCorpus();
  const surah = corpus.surahs.find((item) => item.number === surahNumber);
  if (!surah) throw Object.assign(new Error("Surah tidak ditemukan."), { statusCode: 404 });
  const url = `${QURANENC_BASE}/translation/sura/${encodeURIComponent(source.providerKey)}/${surahNumber}`;
  const payload = await fetchJson(url);
  const entries = normalizeQuranEncSurahPayload(payload, source, surahNumber);
  if (entries.length !== Number(surah.ayahCount)) {
    throw new Error(`Sumber ${source.name} mengembalikan ${entries.length} ayat untuk surah ${surahNumber}; seharusnya ${surah.ayahCount}.`);
  }
  const document = {
    schemaVersion: 2,
    edition: source.edition,
    provider: "quranenc",
    providerKey: source.providerKey,
    kind: source.kind,
    language: source.language,
    name: source.name,
    author: source.author,
    version: source.version || "latest",
    license: { name: source.licenseName, url: source.licenseUrl },
    attribution: source.attribution,
    fetchedAt: new Date().toISOString(),
    surahNumber,
    entries,
  };
  const serialized = `${JSON.stringify(document)}\n`;
  const checksum = `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
  const targetDir = sourceCacheDirectory(source);
  await mkdir(targetDir, { recursive: true });
  const target = sourceCachePath(source, surahNumber);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o640 });
  await rename(temporary, target);
  return { ...document, checksum };
}

async function readCachedQuranEncSurah(source, surahNumber) {
  const target = sourceCachePath(source, surahNumber);
  try {
    const [raw, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
    const document = JSON.parse(raw);
    if (Date.now() - info.mtimeMs <= CONTENT_CACHE_MAX_AGE && Array.isArray(document.entries)) {
      return {
        ...document,
        entries: document.entries.map((entry) => ({ ...entry, text: cleanQuranContentText(entry?.text) })),
      };
    }
  } catch {}
  return null;
}

async function getQuranEncSurah(source, surahNumber) {
  const cached = await readCachedQuranEncSurah(source, surahNumber);
  if (cached) return cached;
  const key = `${source.edition}:${surahNumber}`;
  if (contentInflight.has(key)) return contentInflight.get(key);
  const pending = fetchQuranEncSurah(source, surahNumber).finally(() => contentInflight.delete(key));
  contentInflight.set(key, pending);
  return pending;
}

export async function syncContentEdition(edition) {
  const source = await findSource(edition);
  if (!source) throw new Error("Sumber terjemahan/tafsir tidak terdaftar.");
  if (!source.enabled || source.redistributionAllowed !== true || !source.licenseName || source.licenseName === "verification-required") {
    throw Object.assign(new Error("Sinkronisasi diblokir sampai izin redistribusi dan metadata lisensi sumber diverifikasi."), { statusCode: 409, code: "LICENSE_VERIFICATION_REQUIRED" });
  }

  if (source.provider === "quranenc") {
    let entries = 0;
    for (let surahNumber = 1; surahNumber <= EXPECTED.surahs; surahNumber += 1) {
      const document = await fetchQuranEncSurah(source, surahNumber);
      entries += document.entries.length;
    }
    if (entries !== EXPECTED.ayahs) throw new Error(`Sinkronisasi ${source.name} tidak lengkap (${entries}/${EXPECTED.ayahs} ayat).`);
    const metadata = {
      edition: source.edition,
      provider: source.provider,
      providerKey: source.providerKey,
      kind: source.kind,
      language: source.language,
      name: source.name,
      author: source.author,
      version: source.version || "latest",
      license: { name: source.licenseName, url: source.licenseUrl },
      attribution: source.attribution,
      syncedAt: new Date().toISOString(),
      entries,
      cachedSurahs: EXPECTED.surahs,
    };
    await mkdir(locations().content, { recursive: true });
    await writeFile(path.join(locations().content, `${safeKey(source.edition).replace(/:/g, "--")}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
    return { available: true, ...metadata };
  }

  const response = await fetch(source.sourceUrl, { headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/1.2" } });
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
  const target = path.join(content, `${safeKey(edition)}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o640 });
  await rename(temporary, target);
  const metadata = { edition, kind: source.kind, language: source.language, name: source.name, author: source.author, license: document.license, sourceUrl: source.sourceUrl, syncedAt: new Date().toISOString(), checksum, entries: entries.length };
  await writeFile(path.join(content, `${safeKey(edition)}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
  return { available: true, ...metadata };
}

export async function getContentEntry(edition, surahNumber, ayahNumber) {
  const source = await findSource(edition);
  if (!source) return null;
  const surah = Number(surahNumber);
  const ayah = Number(ayahNumber);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1) return null;

  if (source.provider === "quranenc") {
    const document = await getQuranEncSurah(source, surah);
    return document.entries.find((item) => item.ayah === ayah) || null;
  }

  const { content } = locations();
  const document = JSON.parse(await readFile(path.join(content, `${safeKey(edition)}.json`), "utf8"));
  return document.entries.find((item) => item.surahNumber === surah && item.ayah === ayah) || null;
}

export async function getContentEntries(edition, refs = []) {
  const source = await findSource(edition);
  if (!source) throw Object.assign(new Error("Sumber terjemahan/tafsir tidak ditemukan."), { statusCode: 404 });
  const normalizedRefs = (Array.isArray(refs) ? refs : [])
    .map((item) => ({ surahNumber: Number(item?.surahNumber ?? item?.surah), ayah: Number(item?.ayah) }))
    .filter((item) => Number.isInteger(item.surahNumber) && item.surahNumber >= 1 && item.surahNumber <= 114 && Number.isInteger(item.ayah) && item.ayah >= 1)
    .slice(0, 500);
  const uniqueSurahs = [...new Set(normalizedRefs.map((item) => item.surahNumber))];
  const documents = new Map();
  if (source.provider === "quranenc") {
    for (const surahNumber of uniqueSurahs) documents.set(surahNumber, await getQuranEncSurah(source, surahNumber));
  }
  const entries = [];
  for (const ref of normalizedRefs) {
    let entry = null;
    if (source.provider === "quranenc") entry = documents.get(ref.surahNumber)?.entries?.find((item) => item.ayah === ref.ayah) || null;
    else entry = await getContentEntry(edition, ref.surahNumber, ref.ayah);
    if (entry) entries.push(entry);
  }
  return {
    edition: source.edition,
    kind: source.kind,
    language: source.language,
    name: source.name,
    version: source.version || "latest",
    attribution: source.attribution || null,
    entries,
  };
}

export { normalizeQuranEncCatalog };
