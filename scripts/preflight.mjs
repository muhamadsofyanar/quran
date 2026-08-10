// @phase TQ-06/TQ-11/TQ-12 — deterministic release preflight without printing secrets.

import { access, readFile } from "node:fs/promises";

const required = [
  "Dockerfile",
  "docker-compose.coolify.yml",
  "server/index.mjs",
  "server/render-worker.mjs",
  "server/migrations/001-production.sql",
  "server/migrations/002-media-library.sql",
  "server/migrations/003-content-and-dedupe.sql",
  "server/sources/quran-content-sources.json",
  "services/transcriber/Dockerfile",
  "docs/COOLIFY.md",
  "docs/SECURITY.md",
  "docs/UPDATE-v1.2.0.md",
  "PHASE-MANIFEST.json",
];

for (const file of required) await access(file);
const manifest = JSON.parse(await readFile("PHASE-MANIFEST.json", "utf8"));
if (manifest.version !== "1.2.0" || manifest.progress_percent !== 100 || manifest.current_phase !== "TQ-12") throw new Error("Manifest rilis belum final.");
const compose = await readFile("docker-compose.coolify.yml", "utf8");
for (const service of ["app:", "render-worker:", "transcriber:", "postgres:", "redis:", "minio:"]) if (!compose.includes(service)) throw new Error(`Service ${service} belum ada.`);
if (!compose.includes("RELEASE.2025-09-07T16-13-09Z-cpuv1")) throw new Error("Image MinIO cpuv1 untuk VPS lama harus dipertahankan.");
if (!compose.includes("healthcheck:\n      disable: true")) throw new Error("Healthcheck render-worker harus dinonaktifkan karena worker tidak membuka port HTTP.");
const requirements = await readFile("services/transcriber/requirements.txt", "utf8");
if (!requirements.includes("numpy==1.26.4")) throw new Error("Pin NumPy cpu-compatible hilang.");
const platform = await readFile("server/platform-api.mjs", "utf8");
if (!platform.includes("/api/v1/assets/deduplicate") || !platform.includes("getDownload(")) throw new Error("Media streaming/deduplikasi TQ-12 belum aktif.");
const quranStore = await readFile("server/quran-store.mjs", "utf8");
if (!quranStore.includes("translations/list") || !quranStore.includes("getContentEntries")) throw new Error("Katalog konten QuranEnc TQ-12 belum aktif.");
const page = await readFile("app/page.tsx", "utf8");
if (!page.includes("quranenc:indonesian_affairs") || !page.includes("quranenc:indonesian_mokhtasar") || !page.includes("readOnly={translationSource !== \"Teks manual\"}")) throw new Error("UI terjemahan/tafsir TQ-12 belum lengkap.");
const ignored = await readFile(".gitignore", "utf8");
for (const pattern of [".env", "data/", "*.mp4"]) if (!ignored.includes(pattern)) throw new Error(`Pola rahasia/media belum diabaikan: ${pattern}`);
console.log("Preflight 100%: TQ-12 single-deploy, media, konten multibahasa, layanan, dan pagar berkas sensitif siap.");
