import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Coolify stack includes durable data, queue, AI, and isolated renderer", async () => {
  const [dockerfile, compose] = await Promise.all([read("../Dockerfile"), read("../docker-compose.coolify.yml")]);
  assert.match(dockerfile, /apt-get install[\s\S]*ffmpeg/);
  assert.match(dockerfile, /VOLUME \["\/app\/data"\]/);
  assert.match(compose, /tq-data:\/app\/data/);
  assert.match(compose, /transcriber:/);
  assert.match(compose, /tq-models:\/models/);
  assert.match(compose, /postgres:17\.10-alpine3\.24/);
  assert.match(compose, /redis:7\.4\.10-alpine/);
  assert.match(compose, /render-worker:/);
  assert.match(compose, /audio-worker:/);
  assert.match(compose, /tq-postgres:/);
  assert.match(compose, /tq-redis:/);
  assert.match(compose, /tq-minio:/);
});

test("TQ-13 ships dynamic reciters, durable audio jobs, cache, and Studio source tabs", async () => {
  const [audio, queue, worker, platform, server, page, migration, compose] = await Promise.all([
    read("../server/quran-audio.mjs"),
    read("../server/quran-audio-queue.mjs"),
    read("../server/quran-audio-worker.mjs"),
    read("../server/platform-api.mjs"),
    read("../server/index.mjs"),
    read("../app/page.tsx"),
    read("../server/migrations/004-quran-audio-jobs.sql"),
    read("../docker-compose.coolify.yml"),
  ]);
  assert.match(audio, /edition\/format\/audio/);
  assert.match(audio, /ffprobe/);
  assert.match(audio, /ffmpeg/);
  assert.match(audio, /ALLOWED_AUDIO_HOSTS/);
  assert.match(queue, /tq-quran-audio/);
  assert.match(worker, /sourceKey/);
  assert.match(platform, /\/api\/v1\/quran-audio\/jobs/);
  assert.match(server, /\/media-api\/quran\/audio\/reciters/);
  assert.match(page, /Sumber Qur/);
  assert.match(page, /Siapkan audio dan ayat/);
  assert.match(page, /Tanpa Explorer/);
  assert.match(migration, /tq_quran_audio_jobs/);
  assert.match(compose, /server\/quran-audio-worker\.mjs/);
});

test("Studio restores missing Arabic text from the canonical corpus", async () => {
  const [page, helpers, store] = await Promise.all([
    read("../app/page.tsx"),
    read("../lib/quran-content.mjs"),
    read("../server/quran-store.mjs"),
  ]);
  assert.match(page, /hydrateSegmentsArabic/);
  assert.match(page, /Memuat teks Arab/);
  assert.match(helpers, /mergeArabicIntoSegments/);
  assert.match(store, /cleanQuranContentText/);
});

test("production platform ships authentication, immutable audit, storage, and recovery", async () => {
  const [auth, storage, platform, migration] = await Promise.all([
    read("../server/auth.mjs"), read("../server/storage.mjs"), read("../server/platform-api.mjs"), read("../server/migrations/001-production.sql"),
  ]);
  assert.match(auth, /scrypt/);
  assert.match(auth, /HttpOnly; SameSite=Strict/);
  assert.match(storage, /S3Client/);
  assert.match(storage, /stream: object\.Body/);
  assert.doesNotMatch(storage, /getSignedUrl/);
  assert.match(platform, /\/api\/v1\/backup/);
  assert.match(platform, /\/api\/v1\/restore/);
  assert.match(migration, /append-only/);
  assert.match(migration, /tq_memberships/);
  const migration2 = await read("../server/migrations/002-media-library.sql");
  const migration3 = await read("../server/migrations/003-content-and-dedupe.sql");
  assert.match(migration2, /scope/);
  assert.match(migration2, /analysis_status/);
  assert.match(migration2, /cancel_requested/);
  assert.match(migration3, /indonesian_affairs/);
  assert.match(migration3, /duplicateOf/);
});

test("media gateway exposes real transcode and validated corpus paths", async () => {
  const [server, corpus] = await Promise.all([read("../server/index.mjs"), read("../server/quran-store.mjs")]);
  assert.match(server, /\/media-api\/transcode/);
  assert.match(server, /libx264/);
  assert.match(server, /"aac"/);
  assert.match(corpus, /ayahs: 6236/);
  assert.match(corpus, /pages: 604/);
  assert.match(corpus, /sha256/);
});

test("local transcription service is pinned and OpenAI-compatible", async () => {
  const [requirements, application] = await Promise.all([read("../services/transcriber/requirements.txt"), read("../services/transcriber/app.py")]);
  assert.match(requirements, /faster-whisper==1\.2\.1/);
  assert.match(requirements, /python-multipart==0\.0\.32/);
  assert.match(application, /\/v1\/audio\/transcriptions/);
  assert.match(application, /word_timestamps=True/);
  assert.match(application, /language.*"ar"/s);
});


test("TQ-07 sampai TQ-12 menyediakan pustaka media, konten QuranEnc, retry render, dan indeks 114 surah", async () => {
  const [platform, queue, server, page] = await Promise.all([read("../server/platform-api.mjs"), read("../server/render-queue.mjs"), read("../server/index.mjs"), read("../app/page.tsx")]);
  assert.match(platform, /request.method === "GET"/);
  assert.match(platform, /inferQuranAudioMetadata/);
  assert.match(platform, /analysis_status/);
  assert.match(platform, /\/api\/v1\/assets\/deduplicate/);
  assert.match(platform, /deduplicated/);
  assert.match(platform, /retryMatch/);
  assert.match(queue, /retryRender/);
  assert.match(server, /\/media-api\/quran\/surahs/);
  assert.match(server, /\/media-api\/quran\/content\/batch/);
  assert.match(page, /Pustaka Media Qur/);
  assert.match(page, /Batch 3 rasio/);
  assert.match(page, /renderScope/);
  assert.match(page, /quranenc:indonesian_affairs/);
  assert.match(page, /Tafsir/);
  assert.match(page, /Rapikan duplikat/);
  assert.match(page, /readOnly=\{translationSource !== "Teks manual"\}/);
  assert.match(page, /fetch\(\"\/media-api\/capabilities\"/);
  assert.match(page, /fetch\(\"\/api\/v1\/auth\/session\"/);
  assert.match(page, /setSessionMode\(account\.authenticated \? \"authenticated\" : \"guest\"\)/);
  assert.match(page, /refreshMediaLibrary\(\)/);
});
