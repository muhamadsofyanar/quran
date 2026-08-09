// @phase TQ-05 — isolated FFmpeg worker for durable MP4 jobs.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "bullmq";
import { migrateDatabase, query } from "./database.mjs";
import { redisConnection } from "./render-queue.mjs";
import { getBuffer, putBuffer, storageKey } from "./storage.mjs";

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error("Render worker membutuhkan DATABASE_URL dan REDIS_URL.");
await migrateDatabase();

function safePreset(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function targetDimensions(ratio, resolution) {
  const edge = resolution === "2160p (4K)" ? 2160 : resolution === "1440p" ? 1440 : 1080;
  if (ratio === "9:16") return [edge, Math.round(edge * 16 / 9)];
  if (ratio === "1:1") return [edge, edge];
  return [Math.round(edge * 16 / 9), edge];
}

async function transcode(job, record, input, output) {
  const preset = record.preset || {};
  const ffmpegPreset = safePreset(process.env.TQ_FFMPEG_PRESET || "medium", ["veryfast", "faster", "fast", "medium", "slow"], "medium");
  const crf = String(Math.min(32, Math.max(14, Number(process.env.TQ_FFMPEG_CRF || 20))));
  const [width, height] = targetDimensions(preset.ratio, preset.resolution);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", ffmpegPreset, "-crf", crf,
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-progress", "pipe:1", output,
  ];
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let progressBuffer = "";
    child.stdout.on("data", async (chunk) => {
      progressBuffer += String(chunk);
      const blocks = progressBuffer.split("\n");
      progressBuffer = blocks.pop() || "";
      for (const line of blocks) {
        if (!line.startsWith("out_time_ms=")) continue;
        const current = Number(line.slice(12)) / 1_000_000;
        const duration = Math.max(1, Number(preset.duration || 1));
        const progress = Math.min(94, Math.max(5, Math.round((current / duration) * 90)));
        await job.updateProgress(progress);
        await query("UPDATE tq_render_jobs SET progress=$1 WHERE id=$2", [progress, record.id]);
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg keluar dengan kode ${code}`)));
  });
}

const worker = new Worker("tq-render", async (job) => {
  const result = await query(
    `SELECT j.*,a.storage_key,a.content_type,a.original_name
     FROM tq_render_jobs j JOIN tq_media_assets a ON a.id=j.input_asset_id WHERE j.id=$1`,
    [job.data.jobId],
  );
  const record = result.rows[0];
  if (!record) throw new Error("Render job atau input tidak ditemukan.");
  if (record.status === "cancelled") return { cancelled: true };
  const work = await mkdtemp(path.join(tmpdir(), "tq-worker-"));
  const input = path.join(work, "input.webm");
  const output = path.join(work, "output.mp4");
  try {
    await query("UPDATE tq_render_jobs SET status='processing',attempts=attempts+1,started_at=COALESCE(started_at,now()),progress=2,error=NULL WHERE id=$1", [record.id]);
    await writeFile(input, await getBuffer(record.storage_key), { mode: 0o600 });
    await transcode(job, record, input, output);
    const outputBuffer = await readFile(output);
    const key = storageKey(record.workspace_id, record.project_id, "render-output", "mp4");
    const stored = await putBuffer(key, outputBuffer, "video/mp4");
    const outputId = randomUUID();
    await query(
      `INSERT INTO tq_media_assets(id,workspace_id,project_id,uploaded_by,kind,storage_key,original_name,content_type,size_bytes,checksum)
       VALUES($1,$2,$3,$4,'render-output',$5,$6,'video/mp4',$7,$8)`,
      [outputId, record.workspace_id, record.project_id, record.requested_by, stored.key, `${record.preset?.title || "taysriul-qurani"}.mp4`, stored.sizeBytes, stored.checksum],
    );
    await query("UPDATE tq_render_jobs SET status='complete',progress=100,output_asset_id=$1,finished_at=now() WHERE id=$2", [outputId, record.id]);
    await query("INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'render.completed','render',$3,$4)", [record.workspace_id, record.requested_by, record.id, { outputAssetId: outputId, sizeBytes: stored.sizeBytes }]);
    return { outputAssetId: outputId, sizeBytes: (await stat(output)).size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}, { connection: redisConnection(), concurrency: Math.max(1, Number(process.env.TQ_RENDER_CONCURRENCY || 1)), lockDuration: 600_000 });

worker.on("failed", async (job, error) => {
  if (!job?.data?.jobId) return;
  await query("UPDATE tq_render_jobs SET status='failed',error=$1,finished_at=now() WHERE id=$2", [String(error.message || error).slice(0, 8_000), job.data.jobId]).catch(() => {});
});

worker.on("error", (error) => console.error("Render worker error:", error.message));
console.log("Taysriul Qur'ani render worker is ready.");
