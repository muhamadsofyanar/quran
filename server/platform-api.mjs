// @phase TQ-03/TQ-06 — authenticated projects, media, review, and recovery APIs.

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
import { cancelQueuedRender, enqueueRender, queueConfigured } from "./render-queue.mjs";
import { getDownload, putBuffer, storageKey } from "./storage.mjs";

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
  if (url.pathname === "/api/v1/assets" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const projectId = String(url.searchParams.get("projectId") || "");
    const kind = String(url.searchParams.get("kind") || "other");
    if (!projectId || !["audio", "background", "logo", "other"].includes(kind)) throw Object.assign(new Error("Proyek atau jenis media tidak valid."), { statusCode: 400 });
    const ownsProject = await query("SELECT 1 FROM tq_projects WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [projectId, workspaceId]);
    if (!ownsProject.rowCount) throw Object.assign(new Error("Proyek tidak ditemukan."), { statusCode: 404 });
    const contentType = String(request.headers["content-type"] || "application/octet-stream").split(";")[0].toLowerCase();
    const allowed = kind === "audio" ? /^(audio|video)\// : kind === "background" ? /^(image|video)\// : /^(audio|video|image)\//;
    if (!allowed.test(contentType)) throw Object.assign(new Error("Jenis media tidak diizinkan."), { statusCode: 415 });
    const body = await readBody(request, maxUpload);
    if (!body.length) throw Object.assign(new Error("Berkas kosong."), { statusCode: 400 });
    const originalName = String(request.headers["x-file-name"] || `${kind}.bin`).replace(/[\r\n]/g, "").slice(0, 255);
    const extension = path.extname(originalName).slice(1) || contentType.split("/")[1] || "bin";
    const key = storageKey(workspaceId, projectId, kind, extension);
    const stored = await putBuffer(key, body, contentType);
    const id = randomUUID();
    await query(
      `INSERT INTO tq_media_assets(id,workspace_id,project_id,uploaded_by,kind,storage_key,original_name,content_type,size_bytes,checksum)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, workspaceId, projectId, session.user.id, kind, stored.key, originalName, contentType, stored.sizeBytes, stored.checksum],
    );
    await audit(workspaceId, session.user.id, "asset.uploaded", "asset", id, { kind, sizeBytes: stored.sizeBytes, checksum: stored.checksum });
    return sendJson(response, 201, { asset: { id, kind, originalName, contentType, sizeBytes: stored.sizeBytes, checksum: stored.checksum } });
  }
  if (downloadMatch && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query("SELECT * FROM tq_media_assets WHERE id=$1 AND workspace_id=$2", [downloadMatch[1], workspaceId]);
    const asset = result.rows[0];
    if (!asset) return sendJson(response, 404, { error: "Media tidak ditemukan." });
    const download = await getDownload(asset.storage_key, asset.original_name, asset.content_type);
    if (download.redirect) {
      response.writeHead(302, { location: download.redirect, "cache-control": "private, no-store" });
      return response.end();
    }
    response.writeHead(200, {
      "content-type": asset.content_type,
      "content-length": String(download.sizeBytes),
      "content-disposition": `attachment; filename="${asset.original_name.replace(/["\r\n]/g, "")}"`,
      "cache-control": "private, no-store",
    });
    return download.stream.pipe(response);
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
  if (url.pathname === "/api/v1/render-jobs" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId);
    const result = await query(
      `SELECT id,project_id,status,progress,preset,attempts,error,output_asset_id,created_at,started_at,finished_at
       FROM tq_render_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [workspaceId],
    );
    return sendJson(response, 200, { jobs: result.rows });
  }
  if (url.pathname === "/api/v1/render-jobs" && request.method === "POST") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    if (!queueConfigured()) throw Object.assign(new Error("Antrean Redis belum dikonfigurasi."), { statusCode: 503 });
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
    };
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tq_media_assets(id,workspace_id,project_id,uploaded_by,kind,storage_key,original_name,content_type,size_bytes,checksum)
         VALUES($1,$2,$3,$4,'render-input',$5,$6,$7,$8,$9)`,
        [inputId, workspaceId, projectId, session.user.id, stored.key, `${preset.title}.webm`, contentType, stored.sizeBytes, stored.checksum],
      );
      await client.query(
        `INSERT INTO tq_render_jobs(id,workspace_id,project_id,requested_by,input_asset_id,status,progress,preset)
         VALUES($1,$2,$3,$4,$5,'queued',0,$6)`,
        [jobId, workspaceId, projectId, session.user.id, inputId, preset],
      );
      await client.query("INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'render.queued','render',$3,$4)", [workspaceId, session.user.id, jobId, preset]);
    });
    try {
      await enqueueRender(jobId);
    } catch (error) {
      await query("UPDATE tq_render_jobs SET status='failed',error=$1,finished_at=now() WHERE id=$2", [error.message, jobId]);
      throw error;
    }
    return sendJson(response, 202, { job: { id: jobId, projectId, status: "queued", progress: 0, preset } });
  }
  if (jobMatch && request.method === "DELETE") {
    await requireWorkspaceRole(session, workspaceId, ["owner", "editor"]);
    const result = await query("SELECT status FROM tq_render_jobs WHERE id=$1 AND workspace_id=$2", [jobMatch[1], workspaceId]);
    if (!result.rowCount) return sendJson(response, 404, { error: "Render tidak ditemukan." });
    if (result.rows[0].status === "processing") return sendJson(response, 409, { error: "Render sedang diproses dan tidak dapat dihentikan secara aman." });
    await cancelQueuedRender(jobMatch[1]);
    await query("UPDATE tq_render_jobs SET status='cancelled',finished_at=now() WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','failed')", [jobMatch[1], workspaceId]);
    await audit(workspaceId, session.user.id, "render.cancelled", "render", jobMatch[1]);
    return sendJson(response, 200, { cancelled: true });
  }
  return false;
}

async function handleRecovery(request, response, url, helpers, session, workspaceId) {
  const { readBody, sendJson } = helpers;
  if (url.pathname === "/api/v1/backup" && request.method === "GET") {
    await requireWorkspaceRole(session, workspaceId, ["owner"]);
    const [workspace, projects, comments, approvals, assets] = await Promise.all([
      query("SELECT id,name,slug,created_at,updated_at FROM tq_workspaces WHERE id=$1", [workspaceId]),
      query("SELECT id,title,state,version,created_at,updated_at FROM tq_projects WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,user_id,at_seconds,body,resolved_at,created_at FROM tq_comments WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,reviewer_id,project_version,decision,note,created_at FROM tq_approvals WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
      query("SELECT id,project_id,kind,original_name,content_type,size_bytes,checksum,created_at FROM tq_media_assets WHERE workspace_id=$1 ORDER BY created_at", [workspaceId]),
    ]);
    const data = { workspace: workspace.rows[0], projects: projects.rows, comments: comments.rows, approvals: approvals.rows, assetManifest: assets.rows };
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
