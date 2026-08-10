// @phase TQ-13 — dynamic Al Quran Cloud reciter catalog, per-ayah cache, and deterministic audio markers.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_API_BASE = "https://api.alquran.cloud/v1";
const DEFAULT_CDN_BASE = "https://cdn.islamic.network/quran/audio";
const POPULAR_EDITIONS = [
  "ar.alafasy",
  "ar.husary",
  "ar.minshawi",
  "ar.sudais",
  "ar.shuraim",
  "ar.abdulbasit",
  "ar.ajamy",
  "ar.muhammadayoub",
  "ar.hudhaify",
  "ar.muhammadjibreel",
];
const ALLOWED_AUDIO_HOSTS = new Set(["cdn.islamic.network", "cdn.alislam.ru"]);
const FALLBACK_EDITIONS = [
  ["ar.alafasy", "مشاري راشد العفاسي", "Mishary Rashid Alafasy", "Murattal"],
  ["ar.husary", "محمود خليل الحصري", "Mahmoud Khalil Al-Husary", "Murattal"],
  ["ar.minshawi", "محمد صديق المنشاوي", "Mohamed Siddiq Al-Minshawi", "Murattal"],
  ["ar.minshawimujawwad", "محمد صديق المنشاوي", "Al-Minshawi", "Mujawwad"],
  ["ar.sudais", "عبدالرحمن السديس", "Abdul Rahman Al-Sudais", "Murattal"],
  ["ar.shuraim", "سعود الشريم", "Saud Al-Shuraim", "Murattal"],
  ["ar.abdulbasit", "عبد الباسط عبد الصمد", "Abdul Basit Abdul Samad", "Murattal"],
  ["ar.abdulbasitmujawwad", "عبد الباسط عبد الصمد", "Abdul Basit Abdul Samad", "Mujawwad"],
  ["ar.ajamy", "أحمد بن علي العجمي", "Ahmed ibn Ali Al-Ajamy", "Murattal"],
  ["ar.muhammadayoub", "محمد أيوب", "Muhammad Ayyoub", "Murattal"],
  ["ar.hudhaify", "علي عبدالرحمن الحذيفي", "Ali Al-Hudhaify", "Murattal"],
  ["ar.muhammadjibreel", "محمد جبريل", "Muhammad Jibreel", "Murattal"],
];

let catalogMemory = null;

function audioRoot() {
  return path.join(process.env.TQ_DATA_DIR || path.join(process.cwd(), "data"), "quran", "audio");
}

function catalogPath() {
  return path.join(audioRoot(), "catalog.json");
}

function catalogTtlMs() {
  return Math.max(60_000, Number(process.env.TQ_QURAN_AUDIO_CATALOG_SECONDS || 21_600) * 1000);
}

function apiBase() {
  return String(process.env.TQ_QURAN_AUDIO_API_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function cdnBase() {
  return String(process.env.TQ_QURAN_AUDIO_CDN_URL || DEFAULT_CDN_BASE).replace(/\/+$/, "");
}

function safeEdition(value) {
  const edition = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,100}$/.test(edition) ? edition : "";
}

function catalogRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.editions)) return payload.editions;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

export function normalizeAudioCatalog(payload) {
  const seen = new Set();
  const normalized = catalogRows(payload).flatMap((item) => {
    const edition = safeEdition(item?.identifier || item?.edition || item?.id);
    if (!edition || seen.has(edition)) return [];
    const format = String(item?.format || "audio").toLowerCase();
    if (format !== "audio") return [];
    seen.add(edition);
    const name = String(item?.name || item?.arabicName || "").trim();
    const englishName = String(item?.englishName || item?.english_name || item?.title || name || edition).trim();
    const language = String(item?.language || "ar").trim().toLowerCase() || "ar";
    const type = String(item?.type || item?.style || "").trim();
    const popularIndex = POPULAR_EDITIONS.indexOf(edition);
    return [{
      edition,
      name,
      englishName,
      language,
      format: "audio",
      type,
      popular: popularIndex >= 0,
      popularIndex,
      searchableText: `${edition} ${name} ${englishName} ${type}`.toLowerCase(),
    }];
  });
  return normalized
    .sort((a, b) => Number(b.popular) - Number(a.popular) || a.popularIndex - b.popularIndex || a.englishName.localeCompare(b.englishName))
    .map((item) => ({
      edition: item.edition,
      name: item.name,
      englishName: item.englishName,
      language: item.language,
      format: item.format,
      type: item.type,
      popular: item.popular,
      searchableText: item.searchableText,
    }));
}

function fallbackCatalog() {
  return normalizeAudioCatalog(FALLBACK_EDITIONS.map(([identifier, name, englishName, type]) => ({
    identifier,
    name,
    englishName,
    type,
    format: "audio",
    language: "ar",
  })));
}

async function fetchJson(url, fetchImpl, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "Taysriul-Qurani/1.3" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Sumber audio merespons HTTP ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readDiskCatalog() {
  try {
    const parsed = JSON.parse(await readFile(catalogPath(), "utf8"));
    const editions = normalizeAudioCatalog(parsed.editions);
    if (!editions.length) return null;
    return { fetchedAt: Number(parsed.fetchedAt || 0), editions };
  } catch {
    return null;
  }
}

async function writeDiskCatalog(editions) {
  await mkdir(audioRoot(), { recursive: true });
  const target = catalogPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ fetchedAt: Date.now(), editions }, null, 2)}\n`, { mode: 0o640 });
  await rename(temporary, target);
}

export function resetAudioCatalogCacheForTests() {
  catalogMemory = null;
}

export async function listAudioEditions({ force = false, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (!force && catalogMemory && now - catalogMemory.fetchedAt < catalogTtlMs()) {
    return { editions: catalogMemory.editions, status: catalogMemory.status, warning: catalogMemory.warning || null };
  }
  const disk = await readDiskCatalog();
  if (!force && disk && now - disk.fetchedAt < catalogTtlMs()) {
    catalogMemory = { ...disk, status: "cached" };
    return { editions: disk.editions, status: "cached", warning: null };
  }
  try {
    const payload = await fetchJson(`${apiBase()}/edition/format/audio`, fetchImpl);
    const editions = normalizeAudioCatalog(payload);
    if (!editions.length) throw new Error("Katalog qari tidak memuat edisi audio.");
    await writeDiskCatalog(editions);
    catalogMemory = { fetchedAt: now, editions, status: "live" };
    return { editions, status: "live", warning: null };
  } catch (error) {
    if (disk?.editions?.length) {
      catalogMemory = { fetchedAt: now, editions: disk.editions, status: "cached", warning: error.message };
      return { editions: disk.editions, status: "cached", warning: "Katalog langsung tidak tersedia; daftar tersimpan digunakan." };
    }
    const editions = fallbackCatalog();
    catalogMemory = { fetchedAt: now, editions, status: "fallback", warning: error.message };
    return { editions, status: "fallback", warning: "Katalog lengkap sementara tidak tersedia; daftar qari cadangan digunakan." };
  }
}

export function buildAudioSourceKey({ edition, surahNumber, ayahStart, ayahEnd }) {
  return `alquran.cloud:${safeEdition(edition)}:${Number(surahNumber)}:${Number(ayahStart)}-${Number(ayahEnd)}`;
}

export function validateAudioSelection({ edition, surahNumber, ayahStart, ayahEnd, ayahCount, editions }) {
  const normalizedEdition = safeEdition(edition);
  const surah = Number(surahNumber);
  const start = Number(ayahStart);
  const end = Number(ayahEnd);
  const count = Number(ayahCount);
  if (!normalizedEdition || !Array.isArray(editions) || !editions.some((item) => item.edition === normalizedEdition)) {
    throw Object.assign(new Error("Qari tidak tersedia pada katalog server."), { statusCode: 400 });
  }
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    throw Object.assign(new Error("Nomor surah harus antara 1 dan 114."), { statusCode: 400 });
  }
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > count) {
    throw Object.assign(new Error(`Rentang ayat harus antara 1 dan ${count || "jumlah ayat surah"}.`), { statusCode: 400 });
  }
  return { edition: normalizedEdition, surahNumber: surah, ayahStart: start, ayahEnd: end };
}

export function isAllowedAudioUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ALLOWED_AUDIO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function buildCumulativeMarkers(ayahs, durations) {
  if (!Array.isArray(ayahs) || !Array.isArray(durations) || ayahs.length !== durations.length) {
    throw new Error("Ayat dan durasi tidak seimbang.");
  }
  let cursor = 0;
  return ayahs.map((ayah, index) => {
    const duration = Number(durations[index]);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Durasi QS ${ayah.surahNumber || ""}:${ayah.ayah} tidak valid.`);
    const start = Number(cursor.toFixed(3));
    cursor += duration;
    return {
      ayah: Number(ayah.ayah),
      globalAyah: Number(ayah.globalNumber),
      start,
      end: Number(cursor.toFixed(3)),
      arabic: String(ayah.arabic || ""),
    };
  });
}

export function segmentsFromMarkers(markers, surah) {
  return markers.map((marker) => ({
    id: `seg-${surah.number}-${marker.ayah}-${Math.random().toString(36).slice(2, 8)}`,
    surah: surah.nameLatin || `Surah ${surah.number}`,
    surahNumber: Number(surah.number),
    ayah: Number(marker.ayah),
    start: Number(marker.start),
    end: Number(marker.end),
    arabic: String(marker.arabic || ""),
    translation: "",
    confidence: 100,
    verified: false,
  }));
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${command} keluar dengan kode ${code}.`)));
  });
}

async function probeDuration(filename) {
  const result = await runProcess("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filename,
  ]);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Durasi audio ${path.basename(filename)} tidak dapat dibaca.`);
  return duration;
}

async function mapConcurrent(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => runner()));
  return results;
}

async function downloadAudio(url, target, fetchImpl, maxBytes) {
  try {
    const info = await stat(target);
    if (info.isFile() && info.size > 256 && info.size <= maxBytes) return { path: target, sizeBytes: info.size, cached: true };
  } catch {}
  if (!isAllowedAudioUrl(url)) throw new Error("Host audio tidak diizinkan.");
  await mkdir(path.dirname(target), { recursive: true });
  let lastError;
  const attempts = Math.max(1, Number(process.env.TQ_QURAN_AUDIO_JOB_ATTEMPTS || 3));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "audio/mpeg,audio/*;q=0.9", "user-agent": "Taysriul-Qurani/1.3" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
        throw new Error(`Tipe respons ${contentType} bukan audio.`);
      }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > maxBytes) throw new Error("Audio ayat melampaui batas ukuran.");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 256 || body.length > maxBytes) throw new Error("Ukuran audio ayat tidak valid.");
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, body, { mode: 0o640 });
      await rename(temporary, target);
      return { path: target, sizeBytes: body.length, cached: false };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Audio gagal diunduh setelah ${attempts} percobaan: ${lastError?.message || "sumber tidak tersedia"}`);
}

function ayahCachePath(edition, globalAyah) {
  return path.join(audioRoot(), "ayah", safeEdition(edition), `${String(globalAyah).padStart(4, "0")}.mp3`);
}

function selectProviderAyahs(payload) {
  const data = payload?.data || payload;
  return Array.isArray(data?.ayahs) ? data.ayahs : [];
}

export async function prepareQuranAudio({ edition, surah, ayahStart, ayahEnd, fetchImpl = fetch, onProgress = async () => {} }) {
  const catalog = await listAudioEditions({ fetchImpl });
  const selection = validateAudioSelection({
    edition,
    surahNumber: surah?.number,
    ayahStart,
    ayahEnd,
    ayahCount: surah?.ayahCount || surah?.ayahs?.length,
    editions: catalog.editions,
  });
  const reciter = catalog.editions.find((item) => item.edition === selection.edition);
  const corpusAyahs = (surah.ayahs || []).filter((item) => item.ayah >= selection.ayahStart && item.ayah <= selection.ayahEnd);
  if (corpusAyahs.length !== selection.ayahEnd - selection.ayahStart + 1) throw new Error("Korpus lokal tidak memuat seluruh rentang ayat.");
  await onProgress({ status: "downloading", progress: 3 });
  const providerPayload = await fetchJson(`${apiBase()}/surah/${selection.surahNumber}/${encodeURIComponent(selection.edition)}`, fetchImpl, 20_000);
  const providerByAyah = new Map(selectProviderAyahs(providerPayload).map((item) => [Number(item.numberInSurah), item]));
  const maxJobBytes = Math.max(1_000_000, Number(process.env.TQ_QURAN_AUDIO_MAX_BYTES || 536_870_912));
  const concurrency = Math.max(1, Math.min(8, Number(process.env.TQ_QURAN_AUDIO_DOWNLOAD_CONCURRENCY || 4)));
  let completed = 0;
  let accumulatedBytes = 0;
  const downloaded = await mapConcurrent(corpusAyahs, concurrency, async (ayah) => {
    const providerAyah = providerByAyah.get(Number(ayah.ayah));
    const globalAyah = Number(providerAyah?.number || ayah.globalNumber);
    const remoteUrl = String(providerAyah?.audio || `${cdnBase()}/128/${selection.edition}/${globalAyah}.mp3`);
    if (!providerAyah || !globalAyah) throw new Error(`Qari ${reciter?.englishName || selection.edition} tidak menyediakan QS ${selection.surahNumber}:${ayah.ayah}.`);
    const result = await downloadAudio(remoteUrl, ayahCachePath(selection.edition, globalAyah), fetchImpl, maxJobBytes);
    accumulatedBytes += result.sizeBytes;
    if (accumulatedBytes > maxJobBytes) throw new Error("Total audio melampaui batas persiapan.");
    completed += 1;
    await onProgress({ status: "downloading", progress: Math.round(5 + (completed / corpusAyahs.length) * 60) });
    return { ...result, ayah: { ...ayah, globalNumber: globalAyah } };
  });
  await onProgress({ status: "merging", progress: 68 });
  const durations = await mapConcurrent(downloaded, concurrency, async (item, index) => {
    const duration = await probeDuration(item.path);
    await onProgress({ status: "merging", progress: Math.round(68 + ((index + 1) / downloaded.length) * 13) });
    return duration;
  });
  const markers = buildCumulativeMarkers(downloaded.map((item) => item.ayah), durations);
  const work = await mkdtemp(path.join(tmpdir(), "tq-quran-audio-"));
  const concatFile = path.join(work, "concat.txt");
  const output = path.join(work, "output.mp3");
  try {
    await writeFile(concatFile, `${downloaded.map((item) => `file '${item.path.replaceAll("'", "'\\''")}'`).join("\n")}\n`, { mode: 0o600 });
    try {
      await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", output]);
    } catch {
      await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", output]);
    }
    await onProgress({ status: "merging", progress: 94 });
    const buffer = await readFile(output);
    if (!buffer.length || buffer.length > maxJobBytes) throw new Error("Hasil gabungan audio tidak valid.");
    return {
      buffer,
      contentType: "audio/mpeg",
      reciter,
      selection,
      markers,
      segments: segmentsFromMarkers(markers, surah),
      durationSeconds: markers.at(-1)?.end || 0,
      sourceKey: buildAudioSourceKey(selection),
      sourceUrl: "https://alquran.cloud/cdn",
      licenseUrl: "https://alquran.cloud/terms-and-conditions",
      attribution: "Recitation via Al Quran Cloud / Islamic Network; copyright remains with the reciter.",
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
