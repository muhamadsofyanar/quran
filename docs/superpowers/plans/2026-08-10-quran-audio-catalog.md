# Quran Audio Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users select any live Al Quran Cloud reciter, a surah or ayah range, then receive cached combined audio and deterministic ayah markers without opening Explorer or running Whisper.

**Architecture:** A provider adapter discovers reciters and prepares per-ayah audio. PostgreSQL stores durable job state, BullMQ moves long work to a dedicated worker, MinIO stores the combined MP3, and the existing Studio polls the job before applying the returned asset and segments. Manual upload and Media Library flows remain available.

**Tech Stack:** Next.js 16/React 19 client, Node.js 22 ESM gateway, PostgreSQL 17, BullMQ/Redis, S3-compatible MinIO, FFmpeg/FFprobe, Node test runner.

## Global Constraints

- Al Quran Cloud and Islamic Network CDN are the only default upstreams; no API key is required.
- Display the complete live audio-edition catalog, with popular reciters ranked first and a bundled fallback only when discovery and disk cache are unavailable.
- Accept only server-discovered edition identifiers and official HTTPS audio hosts.
- Persist per-ayah downloads under `TQ_DATA_DIR`, combined audio in object storage, and job state in PostgreSQL.
- Reuse a completed workspace asset with the same deterministic source key.
- Keep every generated segment unverified until a human checks it.
- Preserve Pustaka Media and manual upload/transcription as fallback modes.

---

### Task 1: Provider adapter and unit contracts

**Files:**
- Create: `server/quran-audio.mjs`
- Create: `tests/quran-audio.test.mjs`

**Interfaces:**
- Produces: `listAudioEditions()`, `normalizeAudioCatalog()`, `validateAudioSelection()`, `buildAudioSourceKey()`, `buildCumulativeMarkers()`, `isAllowedAudioUrl()`, and `prepareQuranAudio()`.
- Consumes: the validated corpus shape returned by `server/quran-store.mjs`.

- [ ] Write failing tests for catalog normalization, popular ordering, fallback behavior, source-key determinism, range validation, URL allowlisting, and marker accumulation.
- [ ] Implement a six-hour disk/memory catalog cache with live, cached, and fallback status.
- [ ] Implement bounded parallel downloads with retry, persistent ayah cache, byte limits, FFprobe durations, FFmpeg concatenation, and temporary-file cleanup.
- [ ] Run `node --test tests/quran-audio.test.mjs`; expect all audio-adapter tests to pass.

### Task 2: Durable job queue and worker

**Files:**
- Create: `server/migrations/004-quran-audio-jobs.sql`
- Create: `server/quran-audio-queue.mjs`
- Create: `server/quran-audio-worker.mjs`
- Modify: `docker-compose.coolify.yml`

**Interfaces:**
- Produces: `enqueueQuranAudio(jobId)` and queue `tq-quran-audio`.
- Consumes: `prepareQuranAudio()` plus existing database, Redis, storage, project, media-asset, and audit tables.

- [ ] Add a job table containing workspace/project/user ownership, selection metadata, progress, status, output asset, segments, cache-hit flag, error, and timestamps.
- [ ] Add BullMQ retry/backoff and a dedicated worker process with concurrency one.
- [ ] Make the worker idempotently reuse a workspace asset by `sourceKey`, store one final MP3, insert metadata/markers/attribution, and mark failures without partial media rows.
- [ ] Add the `audio-worker` service using the shared application image, environment, data volume, PostgreSQL, Redis, and MinIO.

### Task 3: Authenticated and public HTTP APIs

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/platform-api.mjs`

**Interfaces:**
- Produces: `GET /media-api/quran/audio/reciters`, `POST /api/v1/quran-audio/jobs`, and `GET /api/v1/quran-audio/jobs/:jobId`.
- Consumes: provider catalog, corpus surah validation, workspace authorization, cache lookup, and BullMQ enqueue.

- [ ] Expose the safe public reciter catalog and cache status.
- [ ] Validate authenticated owner/editor requests against the project, live server catalog, surah ayah count, and rate limit.
- [ ] Return an immediate completed job when a matching workspace cache asset exists; otherwise create and enqueue a durable job.
- [ ] Restrict job polling to the originating workspace and serialize the finished asset and segments for Studio.

### Task 4: Studio source selector and result application

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the three HTTP APIs from Task 3 and existing asset/content/project APIs.
- Produces: source tabs, searchable reciter selection, surah/range controls, durable progress polling, and automatic project segment replacement.

- [ ] Add `Sumber Qur'an`, `Pustaka Media`, and `Unggah manual` tabs, with Qur'an as the default.
- [ ] Load and search all reciters, rank popular choices, constrain ayah inputs to the selected surah, and submit one preparation job.
- [ ] Poll while queued/downloading/merging/storing; display progress and recover the active job while the page stays open.
- [ ] On completion, load the stored audio, hydrate the active translation, create unverified segments, update project state, refresh Media Library, and open Sync.
- [ ] Keep the existing Library apply controls and manual upload/transcription controls functional.
- [ ] Verify keyboard labels, disabled states, responsive layout, and no avoidable React data waterfalls.

### Task 5: Documentation and release verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SOURCES.md`
- Modify: `README.md`
- Modify: `PHASE-MANIFEST.json`

**Interfaces:**
- Documents the provider, cache, queue, worker, environment defaults, and user workflow.

- [ ] Add audio catalog/cache environment defaults and operational notes.
- [ ] Run `npm run lint`; expect zero errors.
- [ ] Run `npm test`; expect build plus all Node tests to pass.
- [ ] Run `npm run validate:artifact`; expect the release manifest/artifact checks to pass.
- [ ] Inspect the final diff, scan for placeholders/secrets, update release metadata, and package the project as a deploy-ready ZIP.

## Self-review

- Spec coverage: provider discovery, full searchable qari list, popular ranking, fallback cache, range validation, durable background work, MinIO cache, deterministic markers, UI tabs, manual fallback, security, attribution, tests, and release packaging are each assigned above.
- Placeholder scan: no implementation step relies on TBD/TODO or unspecified error handling.
- Type consistency: API selection uses `edition`, `surahNumber`, `ayahStart`, and `ayahEnd`; completed jobs expose `asset` and `segments`, matching the Studio contract.
