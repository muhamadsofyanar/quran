// @phase TQ-11 — PostgreSQL connection, ordered migrations, and transaction boundary.

import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
let pool;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!databaseConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Math.max(2, Number(process.env.TQ_DB_POOL_SIZE || 10)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.TQ_DB_SSL === "require" ? { rejectUnauthorized: process.env.TQ_DB_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
    });
    pool.on("error", (error) => console.error("PostgreSQL pool error:", error.message));
  }
  return pool;
}

export async function query(text, values = []) {
  const active = getPool();
  if (!active) throw Object.assign(new Error("PostgreSQL belum dikonfigurasi."), { statusCode: 503, code: "DATABASE_NOT_CONFIGURED" });
  return active.query(text, values);
}

export async function withTransaction(callback) {
  const active = getPool();
  if (!active) throw Object.assign(new Error("PostgreSQL belum dikonfigurasi."), { statusCode: 503, code: "DATABASE_NOT_CONFIGURED" });
  const client = await active.connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateDatabase() {
  if (!databaseConfigured()) return { configured: false, migrated: false, applied: [] };
  const client = await getPool().connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [1_905_202_610]);
    await client.query("CREATE TABLE IF NOT EXISTS tq_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = new URL("./migrations/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/i.test(name)).sort();
    for (const filename of files) {
      const version = filename.replace(/\.sql$/i, "");
      const existing = await client.query("SELECT 1 FROM tq_schema_migrations WHERE version=$1", [version]);
      if (existing.rowCount) continue;
      const sql = await readFile(new URL(filename, directory), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO tq_schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING", [version]);
      applied.push(version);
    }
    return { configured: true, migrated: true, applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [1_905_202_610]).catch(() => {});
    client.release();
  }
}

export async function databaseStatus() {
  if (!databaseConfigured()) return { configured: false, healthy: false };
  try {
    const result = await query("SELECT current_database() AS name, now() AS time");
    const migrations = await query("SELECT version FROM tq_schema_migrations ORDER BY version DESC LIMIT 1").catch(() => ({ rows: [] }));
    return { configured: true, healthy: true, database: result.rows[0].name, migration: migrations.rows[0]?.version || null };
  } catch (error) {
    return { configured: true, healthy: false, error: error.message };
  }
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
}
