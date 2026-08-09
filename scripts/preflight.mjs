// @phase TQ-06 — deterministic release preflight without printing secrets.

import { access, readFile } from "node:fs/promises";

const required = [
  "Dockerfile",
  "docker-compose.coolify.yml",
  "server/index.mjs",
  "server/render-worker.mjs",
  "server/migrations/001-production.sql",
  "services/transcriber/Dockerfile",
  "docs/COOLIFY.md",
  "docs/SECURITY.md",
  "PHASE-MANIFEST.json",
];

for (const file of required) await access(file);
const manifest = JSON.parse(await readFile("PHASE-MANIFEST.json", "utf8"));
if (manifest.version !== "1.0.0" || manifest.progress_percent !== 100 || manifest.current_phase !== "TQ-06") throw new Error("Manifest rilis belum final.");
const compose = await readFile("docker-compose.coolify.yml", "utf8");
for (const service of ["app:", "render-worker:", "transcriber:", "postgres:", "redis:", "minio:"]) if (!compose.includes(service)) throw new Error(`Service ${service} belum ada.`);
const ignored = await readFile(".gitignore", "utf8");
for (const pattern of [".env", "data/", "*.mp4"]) if (!ignored.includes(pattern)) throw new Error(`Pola rahasia/media belum diabaikan: ${pattern}`);
console.log("Preflight 100%: struktur rilis, fase, layanan, dan pagar berkas sensitif siap.");
