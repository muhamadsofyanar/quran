import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getContentEntries, getContentEntry, listContentSources, normalizeQuranEncCatalog } from "../server/quran-store.mjs";
import { cleanQuranContentText, mergeArabicIntoSegments } from "../lib/quran-content.mjs";

test("missing Arabic text is restored from the canonical surah corpus", () => {
  const segments = [
    { id: "one", surah: "Al-Fatihah", surahNumber: 1, ayah: 4, arabic: "", confidence: 0 },
    { id: "two", surah: "Al-Fatihah", surahNumber: 1, ayah: 5, arabic: "teks manual", confidence: 20 },
  ];
  const hydrated = mergeArabicIntoSegments(segments, [{
    number: 1,
    nameLatin: "Al-Fatihah",
    ayahs: [
      { ayah: 4, arabic: "مَٰلِكِ يَوْمِ ٱلدِّينِ" },
      { ayah: 5, arabic: "إِيَّاكَ نَعْبُدُ" },
    ],
  }]);
  assert.equal(hydrated[0].arabic, "مَٰلِكِ يَوْمِ ٱلدِّينِ");
  assert.equal(hydrated[0].confidence, 100);
  assert.equal(hydrated[1].arabic, "teks manual");
  assert.equal(hydrated[1].confidence, 20);
});

test("Quran content cleanup removes empty footnote artifacts without changing prose", () => {
  assert.equal(cleanQuranContentText("Pemilik hari pembalasan.[]"), "Pemilik hari pembalasan.");
  assert.equal(cleanQuranContentText("Ayat <sup foot_note=1>[1]</sup> pilihan"), "Ayat pilihan");
});

test("preferred Indonesian translation and tafsir sources are enabled", async () => {
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
  } finally {
    if (before === undefined) delete process.env.TQ_QURANENC_DISCOVERY; else process.env.TQ_QURANENC_DISCOVERY = before;
  }
});

test("QuranEnc catalog parser preserves language and source version", () => {
  const parsed = normalizeQuranEncCatalog([{ key: "demo_id", language_iso_code: "id", version: "1.2.3", title: "Demo Indonesia", description: "Terjemahan uji" }]);
  assert.equal(parsed[0].edition, "quranenc:demo_id");
  assert.equal(parsed[0].language, "id");
  assert.equal(parsed[0].version, "1.2.3");
  assert.equal(parsed[0].redistributionAllowed, true);
});

test("QuranEnc surah is fetched once, cached, and returned in batch", async () => {
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
      { globalNumber: 2, surahNumber: 1, surah: "Al-Fatihah", ayah: 2, arabic: "الحمد لله" }
    ]
  }));
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify([
      { sura: "1", aya: "1", translation: "Dengan nama Allah", footnotes: "" },
      { sura: "1", aya: "2", translation: "Segala puji bagi Allah", footnotes: "" }
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const first = await getContentEntry("quranenc:indonesian_affairs", 1, 1);
    const batch = await getContentEntries("quranenc:indonesian_affairs", [{ surahNumber: 1, ayah: 1 }, { surahNumber: 1, ayah: 2 }]);
    assert.equal(first.text, "Dengan nama Allah");
    assert.deepEqual(batch.entries.map((entry) => entry.text), ["Dengan nama Allah", "Segala puji bagi Allah"]);
    assert.equal(calls, 1);
    assert.match(batch.attribution || "", /QuranEnc/);
  } finally {
    globalThis.fetch = before.fetch;
    if (before.data === undefined) delete process.env.TQ_DATA_DIR; else process.env.TQ_DATA_DIR = before.data;
    if (before.discovery === undefined) delete process.env.TQ_QURANENC_DISCOVERY; else process.env.TQ_QURANENC_DISCOVERY = before.discovery;
    await rm(root, { recursive: true, force: true });
  }
});
