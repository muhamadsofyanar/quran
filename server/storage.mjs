// @phase TQ-03/TQ-07/TQ-11/TQ-12 — local or S3-compatible media storage with checksums, same-origin streaming support, and protected deletion.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

export async function getDownload(key, filename, contentType, disposition = "attachment") {
  const resolved = safeKey(key);
  if (driver() === "s3") {
    // MinIO is addressed by the private Docker hostname (for example http://minio:9000).
    // Never redirect a browser to a presigned URL created from that private endpoint: the
    // hostname is not resolvable outside Docker and HTTPS pages would also hit mixed-content
    // restrictions. Stream the object through the authenticated application gateway instead.
    const object = await s3Client().send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: resolved,
    }));
    if (!object.Body || typeof object.Body.pipe !== "function") {
      throw new Error("Objek media tidak menyediakan stream yang dapat dibaca.");
    }
    return {
      stream: object.Body,
      sizeBytes: Number(object.ContentLength || 0),
      contentType: object.ContentType || contentType,
      disposition,
      filename,
    };
  }
  const target = path.join(localRoot(), resolved);
  const info = await stat(target);
  return { stream: createReadStream(target), sizeBytes: info.size, contentType, disposition, filename };
}

export async function deleteObject(key) {
  const resolved = safeKey(key);
  if (driver() === "s3") {
    await s3Client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: resolved }));
    return true;
  }
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(localRoot(), resolved)).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  return true;
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
