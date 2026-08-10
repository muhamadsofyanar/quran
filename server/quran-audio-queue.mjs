// @phase TQ-13 — durable BullMQ queue for long Qur'an audio preparation jobs.

import { Queue } from "bullmq";
import { redisConnection } from "./render-queue.mjs";

let queue;

export function quranAudioQueue() {
  if (!process.env.REDIS_URL) return null;
  if (!queue) {
    queue = new Queue("tq-quran-audio", {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: Math.max(1, Number(process.env.TQ_QURAN_AUDIO_JOB_ATTEMPTS || 3)),
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 2_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    });
  }
  return queue;
}

export async function enqueueQuranAudio(jobId) {
  const active = quranAudioQueue();
  if (!active) throw Object.assign(new Error("Redis belum dikonfigurasi."), { statusCode: 503, code: "QUEUE_NOT_CONFIGURED" });
  return active.add("prepare-quran-audio", { jobId }, { jobId });
}
