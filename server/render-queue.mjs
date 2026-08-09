// @phase TQ-05 — Redis/BullMQ render queue with retry and cancellation.

import { Queue } from "bullmq";
import IORedis from "ioredis";

let redis;
let queue;

export function queueConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function redisConnection() {
  if (!queueConfigured()) return null;
  if (!redis) redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
  return redis;
}

export function renderQueue() {
  if (!queueConfigured()) return null;
  if (!queue) queue = new Queue("tq-render", { connection: redisConnection(), defaultJobOptions: {
    attempts: Math.max(1, Number(process.env.TQ_RENDER_ATTEMPTS || 3)),
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 2_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  } });
  return queue;
}

export async function enqueueRender(jobId) {
  const active = renderQueue();
  if (!active) throw Object.assign(new Error("Redis belum dikonfigurasi."), { statusCode: 503, code: "QUEUE_NOT_CONFIGURED" });
  return active.add("render", { jobId }, { jobId });
}

export async function cancelQueuedRender(jobId) {
  const active = renderQueue();
  if (!active) return false;
  const job = await active.getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (["waiting", "delayed", "prioritized", "paused"].includes(state)) {
    await job.remove();
    return true;
  }
  return false;
}

export async function queueStatus() {
  if (!queueConfigured()) return { configured: false, healthy: false };
  try {
    const pong = await redisConnection().ping();
    return { configured: true, healthy: pong === "PONG" };
  } catch (error) {
    return { configured: true, healthy: false, error: error.message };
  }
}
