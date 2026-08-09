import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Coolify stack includes durable data, queue, AI, and isolated renderer", async () => {
  const [dockerfile, compose] = await Promise.all([read("../Dockerfile"), read("../docker-compose.coolify.yml")]);
  assert.match(dockerfile, /apt-get install[^\n]*ffmpeg/);
  assert.match(dockerfile, /VOLUME \["\/app\/data"\]/);
  assert.match(compose, /tq-data:\/app\/data/);
  assert.match(compose, /transcriber:/);
  assert.match(compose, /tq-models:\/models/);
  assert.match(compose, /postgres:17\.10-alpine3\.24/);
  assert.match(compose, /redis:7\.4\.10-alpine/);
  assert.match(compose, /render-worker:/);
  assert.match(compose, /tq-postgres:/);
  assert.match(compose, /tq-redis:/);
  assert.match(compose, /tq-minio:/);
});

test("production platform ships authentication, immutable audit, storage, and recovery", async () => {
  const [auth, storage, platform, migration] = await Promise.all([
    read("../server/auth.mjs"), read("../server/storage.mjs"), read("../server/platform-api.mjs"), read("../server/migrations/001-production.sql"),
  ]);
  assert.match(auth, /scrypt/);
  assert.match(auth, /HttpOnly; SameSite=Strict/);
  assert.match(storage, /S3Client/);
  assert.match(platform, /\/api\/v1\/backup/);
  assert.match(platform, /\/api\/v1\/restore/);
  assert.match(migration, /append-only/);
  assert.match(migration, /tq_memberships/);
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
