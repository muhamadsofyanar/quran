import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAudioSourceKey,
  buildCumulativeMarkers,
  isAllowedAudioUrl,
  listAudioEditions,
  normalizeAudioCatalog,
  prepareQuranAudio,
  resetAudioCatalogCacheForTests,
  segmentsFromMarkers,
  validateAudioSelection,
} from "../server/quran-audio.mjs";

test("audio catalog keeps all editions while ranking popular qari first", () => {
  const editions = normalizeAudioCatalog({ data: [
    { identifier: "ar.other", name: "قارئ آخر", englishName: "Another Reciter", format: "audio", type: "versebyverse" },
    { identifier: "ar.alafasy", name: "مشاري العفاسي", englishName: "Mishary Alafasy", format: "audio", type: "versebyverse" },
    { identifier: "en.sahih", englishName: "Text edition", format: "text" },
  ] });
  assert.deepEqual(editions.map((item) => item.edition), ["ar.alafasy", "ar.other"]);
  assert.equal(editions[0].popular, true);
  assert.match(editions[1].searchableText, /قارئ آخر/);
});

test("catalog uses disk cache when a live refresh fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-audio-catalog-"));
  const before = process.env.TQ_DATA_DIR;
  process.env.TQ_DATA_DIR = root;
  resetAudioCatalogCacheForTests();
  try {
    const live = await listAudioEditions({
      force: true,
      fetchImpl: async () => new Response(JSON.stringify({ data: [
        { identifier: "ar.demo", name: "القارئ", englishName: "Demo Reciter", format: "audio" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    assert.equal(live.status, "live");
    resetAudioCatalogCacheForTests();
    const cached = await listAudioEditions({ force: true, fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(cached.status, "cached");
    assert.equal(cached.editions[0].edition, "ar.demo");
  } finally {
    resetAudioCatalogCacheForTests();
    if (before === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog has a useful bundled fallback when no cache exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-audio-fallback-"));
  const before = process.env.TQ_DATA_DIR;
  process.env.TQ_DATA_DIR = root;
  resetAudioCatalogCacheForTests();
  try {
    const result = await listAudioEditions({ force: true, fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(result.status, "fallback");
    assert.ok(result.editions.length >= 10);
    assert.equal(result.editions[0].edition, "ar.alafasy");
  } finally {
    resetAudioCatalogCacheForTests();
    if (before === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
});

test("selection validation accepts only known qari and legal ayah ranges", () => {
  const editions = [{ edition: "ar.alafasy" }];
  assert.deepEqual(validateAudioSelection({
    edition: "ar.alafasy",
    surahNumber: 1,
    ayahStart: 1,
    ayahEnd: 7,
    ayahCount: 7,
    editions,
  }), { edition: "ar.alafasy", surahNumber: 1, ayahStart: 1, ayahEnd: 7 });
  assert.throws(() => validateAudioSelection({
    edition: "ar.unknown",
    surahNumber: 1,
    ayahStart: 1,
    ayahEnd: 7,
    ayahCount: 7,
    editions,
  }), /Qari tidak tersedia/);
  assert.throws(() => validateAudioSelection({
    edition: "ar.alafasy",
    surahNumber: 1,
    ayahStart: 7,
    ayahEnd: 8,
    ayahCount: 7,
    editions,
  }), /Rentang ayat/);
});

test("source key and cumulative markers are deterministic", () => {
  const selection = { edition: "ar.alafasy", surahNumber: 1, ayahStart: 1, ayahEnd: 2 };
  assert.equal(buildAudioSourceKey(selection), "alquran.cloud:ar.alafasy:1:1-2");
  const markers = buildCumulativeMarkers([
    { surahNumber: 1, ayah: 1, globalNumber: 1, arabic: "بسم الله" },
    { surahNumber: 1, ayah: 2, globalNumber: 2, arabic: "الحمد لله" },
  ], [4.821, 5.179]);
  assert.deepEqual(markers.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 4.821 }, { start: 4.821, end: 10 }]);
  const segments = segmentsFromMarkers(markers, { number: 1, nameLatin: "Al-Fatihah" });
  assert.equal(segments[0].verified, false);
  assert.equal(segments[1].confidence, 100);
});

test("audio URL allowlist rejects browser-supplied or insecure hosts", () => {
  assert.equal(isAllowedAudioUrl("https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"), true);
  assert.equal(isAllowedAudioUrl("https://cdn.alislam.ru/quran/audio/128/ar.alafasy/1.mp3"), true);
  assert.equal(isAllowedAudioUrl("http://cdn.islamic.network/quran/audio/1.mp3"), false);
  assert.equal(isAllowedAudioUrl("https://example.com/audio.mp3"), false);
});

test("audio preparation downloads, probes, joins, and marks a short ayah range", {
  skip: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 || spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-audio-integration-"));
  const sample = path.join(root, "sample.mp3");
  const generated = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2",
    "-c:a", "libmp3lame", "-b:a", "64k", sample,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const bytes = await readFile(sample);
  const before = process.env.TQ_DATA_DIR;
  process.env.TQ_DATA_DIR = root;
  resetAudioCatalogCacheForTests();
  const progress = [];
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/edition/format/audio")) {
      return new Response(JSON.stringify({ data: [{ identifier: "ar.demo", name: "القارئ", englishName: "Demo Reciter", format: "audio" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/surah/1/ar.demo")) {
      return new Response(JSON.stringify({ data: { ayahs: [
        { number: 1, numberInSurah: 1, audio: "https://cdn.islamic.network/quran/audio/128/ar.demo/1.mp3" },
        { number: 2, numberInSurah: 2, audio: "https://cdn.islamic.network/quran/audio/128/ar.demo/2.mp3" },
      ] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(bytes.length) } });
  };
  try {
    const prepared = await prepareQuranAudio({
      edition: "ar.demo",
      surah: {
        number: 1,
        nameLatin: "Al-Fatihah",
        ayahCount: 2,
        ayahs: [
          { globalNumber: 1, surahNumber: 1, ayah: 1, arabic: "بسم الله" },
          { globalNumber: 2, surahNumber: 1, ayah: 2, arabic: "الحمد لله" },
        ],
      },
      ayahStart: 1,
      ayahEnd: 2,
      fetchImpl,
      onProgress: async (state) => progress.push(state),
    });
    assert.ok(prepared.buffer.length > bytes.length);
    assert.equal(prepared.markers.length, 2);
    assert.equal(prepared.markers[0].start, 0);
    assert.ok(prepared.markers[1].start > 0);
    assert.equal(prepared.segments.every((segment) => segment.verified === false), true);
    assert.equal(prepared.sourceKey, "alquran.cloud:ar.demo:1:1-2");
    assert.ok(progress.some((state) => state.status === "downloading"));
    assert.ok(progress.some((state) => state.status === "merging"));
  } finally {
    resetAudioCatalogCacheForTests();
    if (before === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
});
