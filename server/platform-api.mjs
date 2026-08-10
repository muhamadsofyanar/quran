// @phase TQ-03/TQ-06/TQ-07/TQ-10/TQ-11/TQ-12 — authenticated projects, media library, dedupe, render, review, and recovery APIs.

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  assertSameOrigin,
  clearSessionCookie,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  requireSession,
  requireWorkspaceRole,
} from "./auth.mjs";
import { databaseConfigured, query, withTransaction } from "./database.mjs";
import { cancelQueuedRender, enqueueRender, queueConfigured, retryRender } from "./render-queue.mjs";
import { deleteObject, getDownload, putBuffer, storageKey } from "./storage.mjs";

const rateBuckets = new Map();

function clientKey(request) {
  return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimit(request, name, limit, windowMs) {
  const now = Date.now();
  const key = `${name}:${clientKey(request)}`;
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw Object.assign(new Error("Terlalu banyak permintaan. Coba kembali beberapa saat lagi."), { statusCode: 429 });
  if (rateBuckets.size > 10_000) for (const [bucketKey, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(bucketKey);
}

async function jsonBody(request, readBody, limit = 2_000_000) {
  try {
    return JSON.parse((await readBody(request, limit)).toString("utf8") || "{}");
  } catch (error) {
    if (error instanceof SyntaxError) throw Object.assign(new Error("JSON tidak valid."), { statusCode: 400 });
    throw error;
  }
}

function projectRow(row) {
  return {
    ...row.state,
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function workspaceFor(session, request, url) {
  return String(request.headers["x-tq-workspace"] || url.searchParams.get("workspace") || session.workspaces[0]?.id || "");
}

async function audit(workspaceId, actorId, action, entityType, entityId, detail = {}) {
  await query(
    "INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5,$6)",
    [workspaceId || null, actorId || null, action, entityType, entityId || null, detail],
  );
}

function backupChecksum(data) {
  return `sha256:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
}

function sniffMediaFamily(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const head = buffer.subarray(0, 16);
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "audio"; // ID3 / MP3
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio"; // MP3/AAC frame sync
  if (head.toString("ascii", 0, 4) === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio";
  if (head.toString("ascii", 0, 4) === "OggS") return "audio";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "video"; // MP4/M4A; accepted for audio source too
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video"; // WebM/Matroska
  if (head[0] === 0x89 && head.subarray(1, 4).toString("ascii") === "PNG") return "image";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
  if (head.toString("ascii", 0, 4) === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image";
  return null;
}

export function inferQuranAudioMetadata(filename) {
  const stem = path.basename(String(filename || ""), path.extname(String(filename || ""))).trim();
  let match = stem.match(/^(\d{4})$/);
  if (match) {
    const surahNumber = Number(match[1]);
    if (surahNumber >= 1 && surahNumber <= 114) return { scope: "surah", surahNumber, ayahStart: 1, ayahEnd: null };
  }
  match = stem.match(/^(\d{3})[-_ ]?(\d{3})$/);
  if (match) {
    const surahNumber = Number(match[1]);
    const ayah = Number(match[2]);
    if (surahNumber >= 1 && surahNumber <= 114 && ayah >= 1) return { scope: "ayah", surahNumber, ayahStart: ayah, ayahEnd: ayah };
  }
  match = stem.match(/^(\d{1,3})[-_ ](\d{1,3})$/);
  if (match) {
    const surahNumber = Number(match[1]);
    const ayah = Number(match[2]);
    if (surahNumber >= 1 && surahNumber <= 114 && ayah >= 1) return { scope: "ayah", surahNumber, ayahStart: ayah, ayahEnd: ayah };
  }
  return { scope: "generic", surahNumber: null, ayahStart: null, ayahEnd: null };
}

async function sessionPayload(request) {
  const session = await getSession(request);
  return session ? { authenticated: true, user: session.user, workspaces: session.workspaces, expiresAt: session.expiresAt } : { authenticated: false };
}

async function handleAuth(request, response, url, helpers) {
  const { readBody, sendJson } = helpers;
  if (url.pathname === "/api/v1/auth/session" && request.method === "GET") return sendJson(response, 200, await sessionPayload(request));
  if (url.pathname === "/api/v1/auth/register" && request.method === "POST") {
    rateLimit(request, "register", 5, 15 * 60_000);
    const result = await registerAccount(await jsonBody(request, readBody), request);
    response.setHeader("set-cookie", result.session.cookie);
    return sendJson(response, 201, { authenticated: true, user: result.user, workspaces: [result.workspace], expiresAt: result.session.expiresAt });
  }
  if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
    rateLimit(request, "login", 10, 15 * 60_000);
    const result = await loginAccount(await jsonBody(request, readBody), request);
    response.setHeader("set-cookie", result.session.cookie);
    return sendJson(response, 200, { authenticated: true, user: result.user, workspaces: result.workspaces, expiresAt: result.session.expiresAt });
  }
  if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
    await logoutAccount(await getSession(request));
    response.setHeader("set-cookie", clearSessionCookie());
    return sendJson(response, 200, { authenticated: false });
  }
  return false;
}

async function handleProjects(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson } = helpers;
  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-f0-9-]+)$/i);
  if (url.pathname === "/api/v1/projects" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query("SELECT * FROM tq_projects WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC", [workspaceId]);
    return sendJson(response, 200, { projects: result.rows.map(projectRow) });
  }
  if (url.pathname === "/api/v1/projects" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const payload = await jsonBody(request, readBody);
    const id = randomUUID();
    const title = String(payload.title || "Proyek Qur'an Baru").trim().slice(0, 180);
    const state = typeof payload.state === "object" && payload.state ? payload.state : {};
    const result = await query(
      "INSERT INTO tq_projects(id,workspace_id,owner_id,title,state) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, workspaceId, session.user.id, title, state],
    );
    await audit(workspaceId, session.user.id, "project.created", "project", id, { title });
    return sendJson(response, 201, { project: projectRow(result.rows[0]) });
  }
  if (projectMatch && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query("SELECT * FROM tq_projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [projectMatch[1], workspaceId]);
    return result.rowCount ? sendJson(response, 200, { project: projectRow(result.rows[0]) }) : sendJson(response, 404, { error: "Proyek tidak ditemukan." });
  }
  if (projectMatch && ["PUT", "PATCH"].includes(request.method)) {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const payload = await jsonBody(request, readBody, 8_000_000);
    const expectedVersion = Number(request.headers["if-match"] || payload.version || 0);
    if (!expectedVersion) throw Object.assign(new Error("Versi proyek wajib dikirim untuk mencegah data tertimpa."), { statusCode: 428 });
    const title = String(payload.title || "Proyek Qur'an").trim().slice(0, 180);
    const state = typeof payload.state === "object" && payload.state ? payload.state : {};
    const result = await query(
      `UPDATE tq_projects SET title=$1,state=$2,version=version+1,updated_at=now()
       WHERE id=$3 AND workspace_id=$4 AND version=$5 AND deleted_at IS NULL RETURNING *`,
      [title, state, projectMatch[1], workspaceId, expectedVersion],
    );
    if (!result.rowCount) return sendJson(response, 409, { error: "Proyek berubah di perangkat lain. Muat ulang sebelum menyimpan." });
    await audit(workspaceId, session.user.id, "project.saved", "project", projectMatch[1], { version: result.rows[0].version });
    return sendJson(response, 200, { project: projectRow(result.rows[0]) });
  }
  if (projectMatch && request.method === "DELETE") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const result = await query("UPDATE tq_projects SET deleted_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING id", [projectMatch[1], workspaceId]);
    if (!result.rowCount) return sendJson(response, 404, { error: "Proyek tidak ditemukan." });
    await audit(workspaceId, session.user.id, "project.deleted", "project", projectMatch[1]);
    return sendJson(response, 200, { deleted: true });
  }
  return false;
}

async function handleAssets(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson, maxUpload } = helpers;
  const downloadMatch = url.pathname.match(/^\/api\/v1\/assets\/([a-f0-9-]+)\/download$/i);
  const assetMatch = url.pathname.match(/^\/api\/v1\/assets\/([a-f0-9-]+)$/i);

  if (url.pathname === "/api/v1/assets" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const values = [workspaceId];
    const clauses = ["workspace_id=$1"];
    const push = (value) => { values.push(value); return `$${values.length}`; };
    const kind = String(url.searchParams.get("kind") || "").trim();
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const scope = String(url.searchParams.get("scope") || "").trim();
    const surah = Number(url.searchParams.get("surah") || 0);
    const ayah = Number(url.searchParams.get("ayah") || 0);
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    if (url.searchParams.get("archived") !== "1") clauses.push("archived_at IS NULL");
    if (url.searchParams.get("includeInternal") !== "1" && kind !== "render-input") clauses.push("kind <> 'render-input'");
    if (kind) clauses.push(`kind=${push(kind)}`);
    if (projectId) clauses.push(`project_id=${push(projectId)}`);
    if (["generic", "surah", "ayah"].includes(scope)) clauses.push(`scope=${push(scope)}`);
    if (surah >= 1 && surah <= 114) clauses.push(`surah_number=${push(surah)}`);
    if (ayah >= 1) clauses.push(`(${push(ayah)} BETWEEN COALESCE(ayah_start,1) AND COALESCE(ayah_end,ayah_start,1))`);
    if (q) clauses.push(`(original_name ILIKE ${push(`%${q}%`)} OR COALESCE(qari,'') ILIKE $${values.length})`);
    const result = await query(
      `SELECT id,project_id,kind,original_name,content_type,size_bytes,checksum,scope,surah_number,ayah_start,ayah_end,qari,duration_seconds,analysis_status,metadata,archived_at,last_used_at,parent_asset_id,created_at
       FROM tq_media_assets WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 500`,
      values,
    );
    return sendJson(response, 200, { assets: result.rows.map((asset) => ({
      id: asset.id,
      projectId: asset.project_id,
      kind: asset.kind,
      originalName: asset.original_name,
      contentType: asset.content_type,
      sizeBytes: Number(asset.size_bytes || 0),
      checksum: asset.checksum,
      scope: asset.scope || "generic",
      surahNumber: asset.surah_number,
      ayahStart: asset.ayah_start,
      ayahEnd: asset.ayah_end,
      qari: asset.qari,
      durationSeconds: asset.duration_seconds == null ? null : Number(asset.duration_seconds),
      analysisStatus: asset.analysis_status || "pending",
      metadata: asset.metadata || {},
      archivedAt: asset.archived_at,
      lastUsedAt: asset.last_used_at,
      parentAssetId: asset.parent_asset_id,
      createdAt: asset.created_at,
      downloadUrl: `/api/v1/assets/${asset.id}/download?workspace=${encodeURIComponent(workspaceId)}`,
      streamUrl: `/api/v1/assets/${asset.id}/download?workspace=${encodeURIComponent(workspaceId)}&disposition=inline`,
    })) });
  }

  if (url.pathname === "/api/v1/assets/deduplicate" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const result = await withTransaction(async (client) => {
      const rows = await client.query(
        `SELECT id,kind,checksum,analysis_status,last_used_at,created_at
         FROM tq_media_assets
         WHERE workspace_id=$1 AND archived_at IS NULL
         ORDER BY checksum,kind,(analysis_status='analyzed') DESC,last_used_at DESC NULLS LAST,created_at ASC`,
        [workspaceId],
      );
      const canonical = new Map();
      const archived = [];
      for (const row of rows.rows) {
        const key = `${row.kind}:${row.checksum}`;
        if (!canonical.has(key)) {
          canonical.set(key, row.id);
          continue;
        }
        const keepId = canonical.get(key);
        await client.query(
          `UPDATE tq_media_assets
           SET archived_at=now(),metadata=COALESCE(metadata,'{}'::jsonb) || $1::jsonb
           WHERE id=$2 AND workspace_id=$3`,
          [JSON.stringify({ duplicateOf: keepId, deduplicatedAt: new Date().toISOString() }), row.id, workspaceId],
        );
        archived.push({ id: row.id, canonicalId: keepId });
      }
      return archived;
    });
    await audit(workspaceId, session.user.id, "asset.deduplicated", "workspace", workspaceId, { archived: result.length });
    return sendJson(response, 200, { archived: result.length, duplicates: result });
  }

  if (url.pathname === "/api/v1/assets" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const projectId = String(url.searchParams.get("projectId") || "").trim() || null;
    const kind = String(url.searchParams.get("kind") || "other");
    if (!["audio", "background", "logo", "other"].includes(kind)) throw Object.assign(new Error("Jenis media tidak valid."), { statusCode: 400 });
    if (projectId) {
      const ownsProject = await query("SELECT 1 FROM tq_projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [projectId, workspaceId]);
      if (!ownsProject.rowCount) throw Object.assign(new Error("Proyek tidak ditemukan."), { statusCode: 404 });
    }
    const contentType = String(request.headers["content-type"] || "application/octet-stream").split(";")[0].toLowerCase();
    const allowed = kind === "audio" ? /^(audio|video)\// : kind === "background" ? /^(image|video)\// : /^(audio|video|image)\//;
    if (!allowed.test(contentType)) throw Object.assign(new Error("Jenis media tidak diizinkan."), { statusCode: 415 });
    rateLimit(request, "asset-upload", 60, 60_000);
    const body = await readBody(request, maxUpload);
    if (!body.length) throw Object.assign(new Error("Berkas kosong."), { statusCode: 400 });
    const detectedFamily = sniffMediaFamily(body);
    if (!detectedFamily) throw Object.assign(new Error("Format berkas tidak dikenali dari isi berkas."), { statusCode: 415 });
    const uploadChecksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    if (kind === "audio" && !["audio", "video"].includes(detectedFamily)) throw Object.assign(new Error("Isi berkas bukan audio/video yang valid."), { statusCode: 415 });
    if (kind === "background" && !["image", "video"].includes(detectedFamily)) throw Object.assign(new Error("Isi berkas bukan gambar/video yang valid."), { statusCode: 415 });
    const originalName = String(request.headers["x-file-name"] || `${kind}.bin`).replace(/[\r\n]/g, "").slice(0, 255);
    const extension = path.extname(originalName).slice(1) || contentType.split("/")[1] || "bin";
    const inferred = kind === "audio" ? inferQuranAudioMetadata(originalName) : { scope: "generic", surahNumber: null, ayahStart: null, ayahEnd: null };
    const scopeHeader = String(request.headers["x-media-scope"] || "");
    const scope = ["generic", "surah", "ayah"].includes(scopeHeader) ? scopeHeader : inferred.scope;
    const surahNumber = Math.max(0, Math.min(114, Number(request.headers["x-surah-number"] || inferred.surahNumber || 0))) || null;
    const ayahStart = Math.max(0, Number(request.headers["x-ayah-start"] || inferred.ayahStart || 0)) || null;
    const ayahEnd = Math.max(0, Number(request.headers["x-ayah-end"] || inferred.ayahEnd || 0)) || ayahStart;
    const qari = String(request.headers["x-qari"] || "").trim().slice(0, 160) || null;
    const durationSeconds = Math.max(0, Number(request.headers["x-duration-seconds"] || 0)) || null;

    const duplicate = await query(
      `SELECT * FROM tq_media_assets
       WHERE workspace_id=$1 AND kind=$2 AND checksum=$3 AND archived_at IS NULL
       ORDER BY (analysis_status='analyzed') DESC,last_used_at DESC NULLS LAST,created_at ASC LIMIT 1`,
      [workspaceId, kind, uploadChecksum],
    );
    if (duplicate.rowCount) {
      const asset = duplicate.rows[0];
      const derivedScope = asset.scope === "generic" && scope !== "generic" ? scope : asset.scope;
      const derivedSurah = asset.surah_number || surahNumber;
      const derivedAyahStart = asset.ayah_start || ayahStart;
      const derivedAyahEnd = asset.ayah_end || ayahEnd;
      await query(
        `UPDATE tq_media_assets SET scope=$1,surah_number=$2,ayah_start=$3,ayah_end=$4,qari=COALESCE(qari,$5),duration_seconds=COALESCE(duration_seconds,$6),last_used_at=now() WHERE id=$7`,
        [derivedScope, derivedSurah, derivedAyahStart, derivedAyahEnd, qari, durationSeconds, asset.id],
      );
      await audit(workspaceId, session.user.id, "asset.reused", "asset", asset.id, { checksum: uploadChecksum, originalName, projectId });
      return sendJson(response, 200, {
        deduplicated: true,
        asset: {
          id: asset.id, projectId: asset.project_id, kind: asset.kind, originalName: asset.original_name, contentType: asset.content_type,
          sizeBytes: Number(asset.size_bytes || body.length), checksum: asset.checksum, scope: derivedScope, surahNumber: derivedSurah,
          ayahStart: derivedAyahStart, ayahEnd: derivedAyahEnd, qari: asset.qari || qari,
          durationSeconds: asset.duration_seconds == null ? durationSeconds : Number(asset.duration_seconds), analysisStatus: asset.analysis_status || "pending",
        },
      });
    }

    const key = storageKey(workspaceId, projectId || "shared", kind, extension);
    const stored = await putBuffer(key, body, contentType);
    const id = randomUUID();
    await query(
      `INSERT INTO tq_media_assets(id,workspace_id,project_id,uploaded_by,kind,storage_key,original_name,content_type,size_bytes,checksum,scope,surah_number,ayah_start,ayah_end,qari,duration_seconds)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, workspaceId, projectId, session.user.id, kind, stored.key, originalName, contentType, stored.sizeBytes, stored.checksum, scope, surahNumber, ayahStart, ayahEnd, qari, durationSeconds],
    );
    await audit(workspaceId, session.user.id, "asset.uploaded", "asset", id, { kind, scope, surahNumber, ayahStart, ayahEnd, sizeBytes: stored.sizeBytes, checksum: stored.checksum });
    return sendJson(response, 201, { asset: { id, projectId, kind, originalName, contentType, sizeBytes: stored.sizeBytes, checksum: stored.checksum, scope, surahNumber, ayahStart, ayahEnd, qari, durationSeconds, analysisStatus: "pending" } });
  }

  if (downloadMatch && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query("SELECT * FROM tq_media_assets WHERE id=$1 AND workspace_id=$2", [downloadMatch[1], workspaceId]);
    const asset = result.rows[0];
    if (!asset) return sendJson(response, 404, { error: "Media tidak ditemukan." });
    const disposition = url.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    const download = await getDownload(asset.storage_key, asset.original_name, asset.content_type, disposition);
    await query("UPDATE tq_media_assets SET last_used_at=now() WHERE id=$1", [asset.id]).catch(() => {});
    const originalName = String(asset.original_name || "media.bin").replace(/["\r\n]/g, "");
    const asciiName = originalName.replace(/[^\x20-\x7E]/g, "_") || "media.bin";
    const encodedName = encodeURIComponent(originalName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const headers = {
      "content-type": download.contentType || asset.content_type,
      "content-disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "cache-control": "private, no-store",
      "accept-ranges": "none",
      "x-content-type-options": "nosniff",
    };
    if (Number.isFinite(download.sizeBytes) && download.sizeBytes > 0) headers["content-length"] = String(download.sizeBytes);
    response.writeHead(200, headers);
    return download.stream.pipe(response);
  }

  if (assetMatch && request.method === "PATCH") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const payload = await jsonBody(request, readBody, 1_000_000);
    const current = await query("SELECT * FROM tq_media_assets WHERE id=$1 AND workspace_id=$2", [assetMatch[1], workspaceId]);
    if (!current.rowCount) return sendJson(response, 404, { error: "Media tidak ditemukan." });
    const row = current.rows[0];
    const scope = ["generic", "surah", "ayah"].includes(payload.scope) ? payload.scope : row.scope;
    const surahNumber = payload.surahNumber === null ? null : payload.surahNumber === undefined ? row.surah_number : Math.max(1, Math.min(114, Number(payload.surahNumber) || 1));
    const ayahStart = payload.ayahStart === null ? null : payload.ayahStart === undefined ? row.ayah_start : Math.max(1, Number(payload.ayahStart) || 1);
    const ayahEnd = payload.ayahEnd === null ? null : payload.ayahEnd === undefined ? row.ayah_end : Math.max(ayahStart || 1, Number(payload.ayahEnd) || ayahStart || 1);
    const analysisStatus = ["pending", "analyzing", "analyzed", "needs-review", "failed"].includes(payload.analysisStatus) ? payload.analysisStatus : row.analysis_status;
    const originalName = payload.originalName === undefined ? row.original_name : String(payload.originalName || row.original_name).replace(/[\r\n]/g, "").slice(0, 255);
    const qari = payload.qari === undefined ? row.qari : String(payload.qari || "").trim().slice(0, 160) || null;
    const durationSeconds = payload.durationSeconds === undefined ? row.duration_seconds : Math.max(0, Number(payload.durationSeconds) || 0) || null;
    const metadata = payload.metadata && typeof payload.metadata === "object" ? { ...(row.metadata || {}), ...payload.metadata } : row.metadata || {};
    const result = await query(
      `UPDATE tq_media_assets SET original_name=$1,scope=$2,surah_number=$3,ayah_start=$4,ayah_end=$5,qari=$6,duration_seconds=$7,analysis_status=$8,metadata=$9,last_used_at=now()
       WHERE id=$10 AND workspace_id=$11 RETURNING *`,
      [originalName, scope, surahNumber, ayahStart, ayahEnd, qari, durationSeconds, analysisStatus, metadata, assetMatch[1], workspaceId],
    );
    await audit(workspaceId, session.user.id, "asset.updated", "asset", assetMatch[1], { scope, surahNumber, ayahStart, ayahEnd, analysisStatus });
    const asset = result.rows[0];
    return sendJson(response, 200, { asset: { id: asset.id, projectId: asset.project_id, kind: asset.kind, originalName: asset.original_name, contentType: asset.content_type, sizeBytes: Number(asset.size_bytes || 0), checksum: asset.checksum, scope: asset.scope, surahNumber: asset.surah_number, ayahStart: asset.ayah_start, ayahEnd: asset.ayah_end, qari: asset.qari, durationSeconds: asset.duration_seconds == null ? null : Number(asset.duration_seconds), analysisStatus: asset.analysis_status, metadata: asset.metadata || {}, createdAt: asset.created_at } });
  }

  if (assetMatch && request.method === "DELETE") {
    const role = await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const current = await query("SELECT * FROM tq_media_assets WHERE id=$1 AND workspace_id=$2", [assetMatch[1], workspaceId]);
    if (!current.rowCount) return sendJson(response, 404, { error: "Media tidak ditemukan." });
    const asset = current.rows[0];
    const hard = url.searchParams.get("hard") === "1";
    if (!hard) {
      await query("UPDATE tq_media_assets SET archived_at=now() WHERE id=$1 AND workspace_id=$2", [asset.id, workspaceId]);
      await audit(workspaceId, session.user.id, "asset.archived", "asset", asset.id);
      return sendJson(response, 200, { archived: true });
    }
    if (role.role !== "owner") throw Object.assign(new Error("Hapus permanen hanya dapat dilakukan pemilik workspace."), { statusCode: 403 });
    const refs = await query(
      `SELECT EXISTS(SELECT 1 FROM tq_render_jobs WHERE input_asset_id=$1 OR output_asset_id=$1) AS render_ref,
              EXISTS(SELECT 1 FROM tq_projects WHERE workspace_id=$2 AND deleted_at IS NULL AND (state->>'audioAssetId'=$1 OR state->>'backgroundAssetId'=$1)) AS project_ref`,
      [asset.id, workspaceId],
    );
    if (refs.rows[0]?.render_ref || refs.rows[0]?.project_ref) return sendJson(response, 409, { error: "Media masih digunakan proyek atau render. Arsipkan saja atau lepaskan dari proyek terlebih dahulu." });
    await deleteObject(asset.storage_key);
    await query("DELETE FROM tq_media_assets WHERE id=$1 AND workspace_id=$2", [asset.id, workspaceId]);
    await audit(workspaceId, session.user.id, "asset.deleted", "asset", asset.id, { permanent: true });
    return sendJson(response, 200, { deleted: true });
  }

  return false;
}

async function handleCollaboration(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson } = helpers;
  if (url.pathname === "/api/v1/members" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query(
      "SELECT u.id,u.email,u.display_name,m.role,m.created_at FROM tq_memberships m JOIN tq_users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.created_at",
      [workspaceId],
    );
    return sendJson(response, 200, { members: result.rows });
  }
  if (url.pathname === "/api/v1/members" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const payload = await jsonBody(request, readBody);
    const role = String(payload.role || "viewer");
    if (!["editor", "reviewer", "viewer"].includes(role)) throw Object.assign(new Error("Peran tidak valid."), { statusCode: 400 });
    const user = await query("SELECT id,email,display_name FROM tq_users WHERE email=$1 AND status='active'", [String(payload.email || "").trim().toLowerCase()]);
    if (!user.rowCount) throw Object.assign(new Error("Pengguna belum memiliki akun Taysriul Qur'ani."), { statusCode: 404 });
    await query("INSERT INTO tq_memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role", [workspaceId, user.rows[0].id, role]);
    await audit(workspaceId, session.user.id, "member.upserted", "user", user.rows[0].id, { role });
    return sendJson(response, 200, { member: { ...user.rows[0], role } });
  }
  if (url.pathname === "/api/v1/comments" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const projectId = String(url.searchParams.get("projectId") || "");
    const result = await query(
      "SELECT c.*,u.display_name FROM tq_comments c JOIN tq_users u ON u.id=c.user_id WHERE c.workspace_id=$1 AND c.project_id=$2 ORDER BY c.created_at",
      [workspaceId, projectId],
    );
    return sendJson(response, 200, { comments: result.rows });
  }
  if (url.pathname === "/api/v1/comments" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor", "reviewer"]);
    const payload = await jsonBody(request, readBody);
    const body = String(payload.body || "").trim().slice(0, 4000);
    if (!body) throw Object.assign(new Error("Komentar tidak boleh kosong."), { statusCode: 400 });
    const id = randomUUID();
    const result = await query(
      "INSERT INTO tq_comments(id,workspace_id,project_id,user_id,at_seconds,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [id, workspaceId, payload.projectId, session.user.id, Math.max(0, Number(payload.atSeconds || 0)), body],
    );
    await audit(workspaceId, session.user.id, "comment.created", "comment", id, { projectId: payload.projectId });
    return sendJson(response, 201, { comment: result.rows[0] });
  }
  if (url.pathname === "/api/v1/approvals" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "reviewer"]);
    const payload = await jsonBody(request, readBody);
    const decision = String(payload.decision || "");
    if (!["approved", "changes-requested"].includes(decision)) throw Object.assign(new Error("Keputusan pemeriksaan tidak valid."), { statusCode: 400 });
    const project = await query("SELECT version FROM tq_projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [payload.projectId, workspaceId]);
    if (!project.rowCount) throw Object.assign(new Error("Proyek tidak ditemukan."), { statusCode: 404 });
    const id = randomUUID();
    const result = await query(
      "INSERT INTO tq_approvals(id,workspace_id,project_id,reviewer_id,project_version,decision,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [id, workspaceId, payload.projectId, session.user.id, project.rows[0].version, decision, String(payload.note || "").slice(0, 4000) || null],
    );
    await audit(workspaceId, session.user.id, `project.${decision}`, "project", payload.projectId, { version: project.rows[0].version });
    return sendJson(response, 201, { approval: result.rows[0] });
  }
  return false;
}

async function handleRenderJobs(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson, maxUpload } = helpers;
  const jobMatch = url.pathname.match(/^\/api\/v1\/render-jobs\/([a-f0-9-]+)$/i);
  const retryMatch = url.pathname.match(/^\/api\/v1\/render-jobs\/([a-f0-9-]+)\/retry$/i);
  if (url.pathname === "/api/v1/render-jobs" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query(
      `SELECT id,project_id,status,progress,preset,attempts,error,output_asset_id,created_at,started_at,finished_at,batch_id,cancel_requested
       FROM tq_render_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [workspaceId],
    );
    return sendJson(response, 200, { jobs: result.rows });
  }
  if (url.pathname === "/api/v1/render-jobs" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    if (!queueConfigured()) throw Object.assign(new Error("Antrean Redis belum dikonfigurasi."), { statusCode: 503 });
    rateLimit(request, "render-create", 30, 60 * 60_000);
    const projectId = String(url.searchParams.get("projectId") || "");
    const project = await query("SELECT id,title FROM tq_projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [projectId, workspaceId]);
    if (!project.rowCount) throw Object.assign(new Error("Proyek tidak ditemukan."), { statusCode: 404 });
    const contentType = String(request.headers["content-type"] || "").split(";")[0];
    if (!/^video\/webm$/i.test(contentType)) throw Object.assign(new Error("Input antrean harus berupa WebM hasil komposisi studio."), { statusCode: 415 });
    const body = await readBody(request, maxUpload);
    const inputKey = storageKey(workspaceId, projectId, "render-input", "webm");
    const stored = await putBuffer(inputKey, body, contentType);
    const inputId = randomUUID();
    const jobId = randomUUID();
    const preset = {
      title: String(request.headers["x-project-name"] || project.rows[0].title).slice(0, 180),
      ratio: String(request.headers["x-render-ratio"] || "16:9"),
      resolution: String(request.headers["x-render-resolution"] || "1080p"),
      duration: Math.max(1, Number(request.headers["x-render-duration"] || 1)),
      scope: String(request.headers["x-render-scope"] || "project"),
    };
    const batchId = String(request.headers["x-render-batch"] || "").slice(0, 80) || null;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tq_media_assets(id,workspace_id,project_id,uploaded_by,kind,storage_key,original_name,content_type,size_bytes,checksum,analysis_status)
         VALUES($1,$2,$3,$4,'render-input',$5,$6,$7,$8,$9,'analyzed')`,
        [inputId, workspaceId, projectId, session.user.id, stored.key, `${preset.title}.webm`, contentType, stored.sizeBytes, stored.checksum],
      );
      await client.query(
        `INSERT INTO tq_render_jobs(id,workspace_id,project_id,requested_by,input_asset_id,status,progress,preset,batch_id)
         VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7)`,
        [jobId, workspaceId, projectId, session.user.id, inputId, preset, batchId],
      );
      await client.query("INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'render.queued','render',$3,$4)", [workspaceId, session.user.id, jobId, { ...preset, batchId }]);
    });
    try {
      await enqueueRender(jobId);
    } catch (error) {
      await query("UPDATE tq_render_jobs SET status='failed',error=$1,finished_at=now() WHERE id=$2", [error.message, jobId]);
      throw error;
    }
    return sendJson(response, 202, { job: { id: jobId, projectId, status: "queued", progress: 0, preset, batchId } });
  }
  if (retryMatch && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const result = await query("SELECT status FROM tq_render_jobs WHERE id=$1 AND workspace_id=$2", [retryMatch[1], workspaceId]);
    if (!result.rowCount) return sendJson(response, 404, { error: "Render tidak ditemukan." });
    if (result.rows[0].status !== "failed") return sendJson(response, 409, { error: "Hanya render gagal yang dapat dicoba ulang." });
    const queued = await retryRender(retryMatch[1]);
    if (!queued) return sendJson(response, 409, { error: "Job Redis tidak lagi tersedia untuk retry. Buat render baru." });
    await query("UPDATE tq_render_jobs SET status='queued',progress=0,error=NULL,finished_at=NULL,cancel_requested=false WHERE id=$1", [retryMatch[1]]);
    await audit(workspaceId, session.user.id, "render.retried", "render", retryMatch[1]);
    return sendJson(response, 202, { retried: true });
  }
  if (jobMatch && request.method === "DELETE") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const result = await query("SELECT status FROM tq_render_jobs WHERE id=$1 AND workspace_id=$2", [jobMatch[1], workspaceId]);
    if (!result.rowCount) return sendJson(response, 404, { error: "Render tidak ditemukan." });
    if (result.rows[0].status === "processing") {
      await query("UPDATE tq_render_jobs SET cancel_requested=true WHERE id=$1 AND workspace_id=$2", [jobMatch[1], workspaceId]);
      await audit(workspaceId, session.user.id, "render.cancel-requested", "render", jobMatch[1]);
      return sendJson(response, 202, { cancelRequested: true, note: "Worker akan menghentikan job pada checkpoint aman berikutnya." });
    }
    await cancelQueuedRender(jobMatch[1]);
    await query("UPDATE tq_render_jobs SET status='cancelled',finished_at=now() WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','failed')", [jobMatch[1], workspaceId]);
    await audit(workspaceId, session.user.id, "render.cancelled", "render", jobMatch[1]);
    return sendJson(response, 200, { cancelled: true });
  }
  return false;
}

async function handleRecovery(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson } = helpers;
  if (url.pathname === "/api/v1/system/status" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const [projects, assets, renders, members, auditEvents, migration] = await Promise.all([
      query("SELECT count(*)::int AS count FROM tq_projects WHERE workspace_id=$1 AND deleted_at IS NULL", [workspaceId]),
      query("SELECT count(*)::int AS count,COALESCE(sum(size_bytes),0)::bigint AS bytes FROM tq_media_assets WHERE workspace_id=$1 AND archived_at IS NULL", [workspaceId]),
      query("SELECT status,count(*)::int AS count FROM tq_render_jobs WHERE workspace_id=$1 GROUP BY status", [workspaceId]),
      query("SELECT count(*)::int AS count FROM tq_memberships WHERE workspace_id=$1", [workspaceId]),
      query("SELECT count(*)::int AS count FROM tq_audit_log WHERE workspace_id=$1", [workspaceId]),
      query("SELECT version,applied_at FROM tq_schema_migrations ORDER BY applied_at DESC,version DESC LIMIT 1"),
    ]);
    return sendJson(response, 200, {
      workspaceId,
      projects: projects.rows[0]?.count || 0,
      media: { count: assets.rows[0]?.count || 0, bytes: Number(assets.rows[0]?.bytes || 0) },
      renders: Object.fromEntries(renders.rows.map((item) => [item.status, item.count])),
      members: members.rows[0]?.count || 0,
      auditEvents: auditEvents.rows[0]?.count || 0,
      migration: migration.rows[0] || null,
      checkedAt: new Date().toISOString(),
    });
  }
  if (url.pathname === "/api/v1/backup" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const [workspace, projects, comments, approvals, assets, renderJobs] = await Promise.all([
      query("SELECT id,name,slug,created_at,updated_at FROM tq_workspaces WHERE id=$1", [workspaceId]),
      query("SELECT id,title,state,version,created_at,updated_at FROM tq_projects WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,user_id,at_seconds,body,resolved_at,created_at FROM tq_comments WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,reviewer_id,project_version,decision,note,created_at FROM tq_approvals WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,kind,original_name,content_type,size_bytes,checksum,scope,surah_number,ayah_start,ayah_end,qari,duration_seconds,analysis_status,metadata,archived_at,parent_asset_id,created_at FROM tq_media_assets WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,status,progress,preset,attempts,error,output_asset_id,batch_id,created_at,started_at,finished_at FROM tq_render_jobs WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
    ]);
    const data = { workspace: workspace.rows[0], projects: projects.rows, comments: comments.rows, approvals: approvals.rows, assetManifest: assets.rows, renderJobs: renderJobs.rows };
    const backup = { schema: "taysriul-qurani-backup", version: 1, exportedAt: new Date().toISOString(), data, checksum: backupChecksum(data) };
    await audit(workspaceId, session.user.id, "backup.exported", "workspace", workspaceId, { projects: projects.rowCount });
    response.setHeader("content-disposition", `attachment; filename="taysriul-qurani-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return sendJson(response, 200, backup);
  }
  if (url.pathname === "/api/v1/restore" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const backup = await jsonBody(request, readBody, 50_000_000);
    if (backup.schema !== "taysriul-qurani-backup" || backup.version !== 1 || !backup.data || backup.checksum !== backupChecksum(backup.data)) {
      throw Object.assign(new Error("Berkas backup tidak valid atau berubah."), { statusCode: 400 });
    }
    const restored = await withTransaction(async (client) => {
      let count = 0;
      for (const item of Array.isArray(backup.data.projects) ? backup.data.projects : []) {
        const id = randomUUID();
        await client.query(
          "INSERT INTO tq_projects(id,workspace_id,owner_id,title,state) VALUES($1,$2,$3,$4,$5)",
          [id, workspaceId, session.user.id, `${String(item.title || "Proyek dipulihkan").slice(0, 160)} (Pulih)`, item.state || {}],
        );
        count += 1;
      }
      await client.query("INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'backup.restored','workspace',$1,$3)", [workspaceId, session.user.id, { projects: count }]);
      return count;
    });
    return sendJson(response, 200, { restored: true, projects: restored, note: "Metadata media dipertahankan dalam manifest; berkas media harus dipulihkan dari object-storage backup." });
  }
  if (url.pathname === "/api/v1/audit" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const result = await query("SELECT id,actor_id,action,entity_type,entity_id,detail,created_at FROM tq_audit_log WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 500", [workspaceId]);
    return sendJson(response, 200, { events: result.rows });
  }
  return false;
}

export async function handlePlatformApi(request, response, url, helpers) {
  if (!url.pathname.startsWith("/api/v1/")) return false;
  if (!databaseConfigured()) return helpers.sendJson(response, 503, { error: "Mode akun membutuhkan PostgreSQL.", code: "DATABASE_NOT_CONFIGURED" });
  assertSameOrigin(request);
  const authResult = await handleAuth(request, response, url, helpers);
  if (authResult !== false) return authResult;
  const session = await requireSession(request);
  const workspaceId = workspaceFor(session, request, url);
  if (!workspaceId) throw Object.assign(new Error("Workspace belum tersedia."), { statusCode: 400 });
  for (const handler of [handleProjects, handleAssets, handleRenderJobs, handleCollaboration, handleRecovery]) {
    const result = await handler(request, response, url, helpers, session, workspaceId);
    if (result !== false) return result;
  }
  return helpers.sendJson(response, 404, { error: "Endpoint platform tidak ditemukan." });
}
