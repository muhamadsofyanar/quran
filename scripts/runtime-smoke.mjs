// @phase TQ-06 — starts the built gateway and proves WebM -> MP4 end to end.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 39_100 + Math.floor(Math.random() * 500);
const work = await mkdtemp(path.join(tmpdir(), "tq-runtime-smoke-"));
const webmPath = path.join(work, "input.webm");
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TQ_DATA_DIR: work, TQ_QURAN_AUTO_SYNC: "false", TQ_STORAGE_DRIVER: "local", DATABASE_URL: "", REDIS_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += String(chunk); });
server.stderr.on("data", (chunk) => { serverLog += String(chunk); });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error = `${error}${chunk}`.slice(-8_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error || `${command} keluar dengan kode ${code}`)));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(serverLog || `Server berhenti dengan kode ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/media-api/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server tidak siap. ${serverLog}`);
}

try {
  const health = await waitForServer();
  if (health.version !== "1.3.0" || health.ffmpeg !== true) throw new Error(`Health tidak sesuai: ${JSON.stringify(health)}`);
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=#0b4338:s=320x180:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:v", "libvpx", "-c:a", "libvorbis", "-shortest", webmPath,
  ]);
  const response = await fetch(`http://127.0.0.1:${port}/media-api/transcode`, {
    method: "POST",
    headers: { "content-type": "video/webm", "x-project-name": "runtime-smoke" },
    body: await readFile(webmPath),
  });
  if (!response.ok) throw new Error(`Transcode HTTP ${response.status}: ${await response.text()}`);
  const output = Buffer.from(await response.arrayBuffer());
  if (output.length < 1_000 || output.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("Hasil bukan MP4 yang valid.");
  console.log(`Runtime smoke 100%: health v${health.version}, FFmpeg aktif, MP4 ${output.length} byte valid.`);
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (server.exitCode === null) server.kill("SIGKILL");
  await rm(work, { recursive: true, force: true });
}
