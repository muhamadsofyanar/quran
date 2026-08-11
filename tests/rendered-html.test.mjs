import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// @phase TQ-06/TQ-11/TQ-12/TQ-13 — production artifact smoke tests.

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker;
}

const workerEnvironment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const workerContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders the independent production identity without preview markers", async () => {
  const worker = await loadWorker();

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    workerEnvironment,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, /codex-preview/i);
  assert.match(html, /Taysriul Qur(?:&#x27;|')ani/);
  assert.match(html, /Studio Video Al-Qur(?:&#x27;|')an/);
});

test("health endpoint identifies the independent service", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    workerEnvironment,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "taysriul-qurani");
  assert.equal(body.version, "1.3.1");
});

test("phase manifest tracks the deployment and product files", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../PHASE-MANIFEST.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.project, "Taysriul Qur'ani");
  assert.equal(manifest.current_phase, "TQ-13");
  assert.equal(manifest.version, "1.3.1");
  assert.equal(manifest.progress_percent, 100);
  assert.ok(manifest.phases["TQ-03"].files.includes("server/database.mjs"));
  assert.ok(manifest.phases["TQ-05"].files.includes("server/render-worker.mjs"));
  assert.ok(manifest.phases["TQ-13"].files.includes("server/quran-audio-worker.mjs"));
});
