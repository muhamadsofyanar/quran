import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hashPassword, verifyPassword } from "../server/auth.mjs";
import { contentStatus, listContentSources, syncContentEdition } from "../server/quran-store.mjs";

test("password hashing is salted and rejects the wrong password", async () => {
  const first = await hashPassword("KataSandi-Uji-123");
  const second = await hashPassword("KataSandi-Uji-123");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("KataSandi-Uji-123", first), true);
  assert.equal(await verifyPassword("salah", first), false);
});

test("local media storage preserves content and checksum", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-storage-test-"));
  const before = { data: process.env.TQ_DATA_DIR, driver: process.env.TQ_STORAGE_DRIVER };
  process.env.TQ_DATA_DIR = root;
  process.env.TQ_STORAGE_DRIVER = "local";
  const storageUrl = new URL("../server/storage.mjs", import.meta.url);
  storageUrl.searchParams.set("test", `${Date.now()}`);
  const { getBuffer, putBuffer, storageStatus } = await import(storageUrl.href);
  try {
    const stored = await putBuffer("workspace/project/audio/sample.bin", Buffer.from("ayat"), "application/octet-stream");
    assert.match(stored.checksum, /^sha256:/);
    assert.equal((await getBuffer(stored.key)).toString(), "ayat");
    assert.equal((await storageStatus()).healthy, true);
  } finally {
    if (before.data === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before.data;
    if (before.driver === undefined) delete process.env.TQ_STORAGE_DRIVER; else process.env.TQ_STORAGE_DRIVER = before.driver;
    await rm(root, { recursive: true, force: true });
  }
});

test("unverified translation sources are registered but blocked from synchronization", async () => {
  const sources = await listContentSources();
  assert.ok(sources.some((source) => source.edition === "id.indonesian"));
  assert.ok((await contentStatus()).every((source) => source.available === false));
  await assert.rejects(() => syncContentEdition("id.indonesian"), /lisensi sumber diverifikasi/);
});
