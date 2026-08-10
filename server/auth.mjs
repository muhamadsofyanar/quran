// @phase TQ-03 — independent accounts, opaque sessions, and workspace roles.

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query, withTransaction } from "./database.mjs";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "tq_session";
const SESSION_DAYS = Math.max(1, Number(process.env.TQ_SESSION_DAYS || 14));

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function slugify(value) {
  return String(value || "workspace").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 256) {
    throw Object.assign(new Error("Kata sandi minimal 10 karakter."), { statusCode: 400, code: "WEAK_PASSWORD" });
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltValue, hashValue] = String(encoded).split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [decodeURIComponent(index < 0 ? item : item.slice(0, index)), decodeURIComponent(index < 0 ? "" : item.slice(index + 1))];
  }));
}

function sessionCookie(token, expires) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires.toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

async function createSession(client, userId, request) {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const ip = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "").split(",")[0].trim();
  const ipHash = ip ? tokenHash(`${process.env.TQ_IP_HASH_SALT || "tq"}:${ip}`) : null;
  await client.query(
    "INSERT INTO tq_sessions(id,user_id,token_hash,expires_at,ip_hash,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
    [id, userId, tokenHash(token), expires, ipHash, String(request.headers["user-agent"] || "").slice(0, 500)],
  );
  return { token, cookie: sessionCookie(token, expires), expiresAt: expires.toISOString() };
}

export async function registerAccount(payload, request) {
  if (process.env.TQ_ALLOW_SIGNUP === "false") throw Object.assign(new Error("Pendaftaran akun baru dinonaktifkan."), { statusCode: 403 });
  const email = normalizeEmail(payload.email);
  const displayName = String(payload.displayName || "").trim().slice(0, 100);
  if (!validEmail(email) || displayName.length < 2) throw Object.assign(new Error("Nama dan email belum valid."), { statusCode: 400 });
  const passwordHash = await hashPassword(payload.password);
  return withTransaction(async (client) => {
    const duplicate = await client.query("SELECT 1 FROM tq_users WHERE email=$1", [email]);
    if (duplicate.rowCount) throw Object.assign(new Error("Email sudah terdaftar."), { statusCode: 409 });
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${randomBytes(3).toString("hex")}`;
    await client.query("INSERT INTO tq_users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)", [userId, email, displayName, passwordHash]);
    await client.query("INSERT INTO tq_workspaces(id,name,slug,created_by) VALUES($1,$2,$3,$4)", [workspaceId, `${displayName} Studio`, slug, userId]);
    await client.query("INSERT INTO tq_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspaceId, userId]);
    await client.query("INSERT INTO tq_audit_log(workspace_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'account.registered','user',$2)", [workspaceId, userId]);
    const session = await createSession(client, userId, request);
    return { session, user: { id: userId, email, displayName }, workspace: { id: workspaceId, name: `${displayName} Studio`, slug, role: "owner" } };
  });
}

export async function loginAccount(payload, request) {
  const email = normalizeEmail(payload.email);
  const result = await query("SELECT id,email,display_name,password_hash,status FROM tq_users WHERE email=$1", [email]);
  const user = result.rows[0];
  if (!user || user.status !== "active" || !(await verifyPassword(String(payload.password || ""), user.password_hash))) {
    throw Object.assign(new Error("Email atau kata sandi salah."), { statusCode: 401 });
  }
  return withTransaction(async (client) => {
    const session = await createSession(client, user.id, request);
    await client.query("INSERT INTO tq_audit_log(actor_id,action,entity_type,entity_id) VALUES($1,'account.login','user',$1)", [user.id]);
    const memberships = await client.query(
      "SELECT w.id,w.name,w.slug,m.role FROM tq_memberships m JOIN tq_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at",
      [user.id],
    );
    return { session, user: { id: user.id, email: user.email, displayName: user.display_name }, workspaces: memberships.rows };
  });
}

export async function getSession(request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const result = await query(
    `SELECT s.id AS session_id,s.expires_at,u.id,u.email,u.display_name,u.status
     FROM tq_sessions s JOIN tq_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (!row || row.status !== "active") return null;
  const memberships = await query(
    "SELECT w.id,w.name,w.slug,m.role FROM tq_memberships m JOIN tq_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at",
    [row.id],
  );
  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: { id: row.id, email: row.email, displayName: row.display_name },
    workspaces: memberships.rows,
  };
}

export async function requireSession(request) {
  const session = await getSession(request);
  if (!session) throw Object.assign(new Error("Silakan masuk terlebih dahulu."), { statusCode: 401, code: "AUTH_REQUIRED" });
  return session;
}

export async function requireWorkspaceRole(session, workspaceId, allowed = ["owner", "editor", "reviewer", "viewer"]) {
  const membership = session.workspaces.find((item) => item.id === workspaceId);
  if (!membership || !allowed.includes(membership.role)) throw Object.assign(new Error("Anda tidak memiliki akses untuk tindakan ini."), { statusCode: 403 });
  return membership;
}

export async function logoutAccount(session) {
  if (session?.sessionId) await query("DELETE FROM tq_sessions WHERE id=$1", [session.sessionId]);
}

export function assertSameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method || "GET")) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const allowed = new Set([process.env.APP_URL, ...(process.env.TQ_ALLOWED_ORIGINS || "").split(",")].filter(Boolean).map((item) => {
    try { return new URL(item.trim()).origin; } catch { return ""; }
  }));
  if (allowed.size && !allowed.has(origin)) throw Object.assign(new Error("Permintaan lintas situs ditolak."), { statusCode: 403 });
}
