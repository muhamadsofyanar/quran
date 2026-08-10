import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hashPassword, verifyPassword } from "../server/auth.mjs";
import { contentStatus, getContentEntry, listContentSources, normalizeQuranEncCatalog } from "../server/quran-store.mjs";

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

test("preferred Indonesian translation and tafsir sources are enabled with republication metadata", async () => {
  const before = process.env.TQ_QURANENC_DISCOVERY;
  process.env.TQ_QURANENC_DISCOVERY = "false";
  try {
    const sources = await listContentSources({ discover: false });
    const kemenag = sources.find((source) => source.edition === "quranenc:indonesian_affairs");
    const tafsir = sources.find((source) => source.edition === "quranenc:indonesian_mokhtasar");
    assert.equal(kemenag?.enabled, true);
    assert.equal(kemenag?.redistributionAllowed, true);
    assert.equal(kemenag?.kind, "translation");
    assert.equal(tafsir?.kind, "tafsir");
    assert.match(kemenag?.licenseName || "", /QuranEnc/);
    const statuses = await contentStatus();
    assert.equal(statuses.find((item) => item.edition === "quranenc:indonesian_affairs")?.available, true);
  } finally {
    if (before === undefined) delete process.env.TQ_QURANENC_DISCOVERY; else process.env.TQ_QURANENC_DISCOVERY = before;
  }
});

test("QuranEnc catalog parser accepts current translation-list response shape", () => {
  const parsed = normalizeQuranEncCatalog([{ key: "demo_id", language_iso_code: "id", version: "1.2.3", title: "Demo Indonesia", description: "Terjemahan uji" }]);
  assert.equal(parsed[0].edition, "quranenc:demo_id");
  assert.equal(parsed[0].language, "id");
  assert.equal(parsed[0].version, "1.2.3");
  assert.equal(parsed[0].redistributionAllowed, true);
});

test("QuranEnc content is fetched per-surah on demand and cached locally", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-content-test-"));
  const before = { data: process.env.TQ_DATA_DIR, discovery: process.env.TQ_QURANENC_DISCOVERY, fetch: globalThis.fetch };
  process.env.TQ_DATA_DIR = root;
  process.env.TQ_QURANENC_DISCOVERY = "false";
  await mkdir(path.join(root, "quran"), { recursive: true });
  await writeFile(path.join(root, "quran", "quran-uthmani.json"), JSON.stringify({
    schemaVersion: 1,
    edition: "test",
    surahs: [{ number: 1, nameLatin: "Al-Fatihah", ayahCount: 2 }],
    ayahs: [
      { globalNumber: 1, surahNumber: 1, surah: "Al-Fatihah", ayah: 1, arabic: "بسم الله" },
      { globalNumber: 2, surahNumber: 1, surah: "Al-Fatihah", ayah: 2, arabic: "الحمد لله" },
    ],
  }));
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify([
      { sura: "1", aya: "1", translation: "Dengan nama Allah", footnotes: "" },
      { sura: "1", aya: "2", translation: "Segala puji bagi Allah", footnotes: "" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const first = await getContentEntry("quranenc:indonesian_affairs", 1, 1);
    const second = await getContentEntry("quranenc:indonesian_affairs", 1, 2);
    assert.equal(first.text, "Dengan nama Allah");
    assert.equal(second.text, "Segala puji bagi Allah");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = before.fetch;
    if (before.data === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before.data;
    if (before.discovery === undefined) delete process.env.TQ_QURANENC_DISCOVERY; else process.env.TQ_QURANENC_DISCOVERY = before.discovery;
    await rm(root, { recursive: true, force: true });
  }
});


test("studio preview and canvas render use the same Arabic font stack", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const ARABIC_FONT_STACK =/);
  assert.match(page, /await prepareArabicFont\(arabicRenderFontSize\)/);
  assert.match(page, /context\.font = `400 \${arabicSize}px \${ARABIC_FONT_STACK}`/);
  assert.match(page, /fontFamily: ARABIC_FONT_STACK/);
});
