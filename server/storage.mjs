// @phase TQ-03 — local or S3-compatible media storage with checksums.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const localRoot = () => path.join(process.env.TQ_DATA_DIR || path.join(process.cwd(), "data"), "media");
const driver = () => process.env.TQ_STORAGE_DRIVER || (process.env.S3_ENDPOINT ? "s3" : "local");
let client;

function s3Client() {
  if (!client) client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "auto",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    } : undefined,
  });
  return client;
}

function safeKey(value) {
  const normalized = path.posix.normalize(`/${String(value || "")}`).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) throw Object.assign(new Error("Kunci penyimpanan tidak valid."), { statusCode: 400 });
  return normalized;
}

export function storageKey(workspaceId, projectId, kind, extension = "bin") {
  return safeKey(`${workspaceId}/${projectId || "shared"}/${kind}/${randomUUID()}.${String(extension).replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin"}`);
}

export async function putBuffer(key, buffer, contentType = "application/octet-stream") {
  const resolved = safeKey(key);
  const body = Buffer.from(buffer);
  const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (driver() === "s3") {
    await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: resolved, Body: body, ContentType: contentType, Metadata: { checksum } }));
  } else {
    const target = path.join(localRoot(), resolved);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { mode: 0o640 });
  }
  return { key: resolved, sizeBytes: body.length, checksum, contentType };
}

export async function getBuffer(key) {
  const resolved = safeKey(key);
  if (driver() === "s3") {
    const response = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: resolved }));
    return Buffer.from(await response.Body.transformToByteArray());
  }
  return readFile(path.join(localRoot(), resolved));
}

export async function getDownload(key, filename, contentType) {
  const resolved = safeKey(key);
  if (driver() === "s3") {
    const url = await getSignedUrl(s3Client(), new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: resolved,
      ResponseContentDisposition: `attachment; filename="${String(filename).replace(/["\r\n]/g, "")}"`,
      ResponseContentType: contentType,
    }), { expiresIn: Math.min(3600, Math.max(60, Number(process.env.TQ_SIGNED_URL_SECONDS || 600))) });
    return { redirect: url };
  }
  const target = path.join(localRoot(), resolved);
  const info = await stat(target);
  return { stream: createReadStream(target), sizeBytes: info.size };
}

export async function storageStatus() {
  if (driver() === "s3") {
    try {
      await s3Client().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
      return { driver: "s3", configured: true, healthy: true };
    } catch (error) {
      if (process.env.TQ_S3_AUTO_CREATE_BUCKET === "true" && process.env.S3_BUCKET) {
        try {
          await s3Client().send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
          return { driver: "s3", configured: true, healthy: true, created: true };
        } catch (createError) {
          return { driver: "s3", configured: true, healthy: false, error: createError.message };
        }
      }
      return { driver: "s3", configured: Boolean(process.env.S3_BUCKET), healthy: false, error: error.message };
    }
  }
  try {
    await mkdir(localRoot(), { recursive: true });
    return { driver: "local", configured: true, healthy: true };
  } catch (error) {
    return { driver: "local", configured: true, healthy: false, error: error.message };
  }
}
