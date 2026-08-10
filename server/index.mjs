// @phase TQ-03/TQ-05 — production gateway, platform API, and media engine.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { databaseStatus, migrateDatabase } from "./database.mjs";
import { handlePlatformApi } from "./platform-api.mjs";
import { queueStatus } from "./render-queue.mjs";
import {
  alignAgainstCorpus,
  contentStatus,
  corpusStatus,
  getContentEntries,
  getContentEntry,
  getSurah,
  listContentSources,
  listSurahs,
  matchAgainstCorpus,
  syncContentEdition,
  syncCorpus,
} from "./quran-store.mjs";
import { storageStatus } from "./storage.mjs";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const maxUpload = Number(
  process.env.TQ_MAX_UPLOAD_BYTES || 536_870_912
);

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], {
    stdio: "ignore",
  }).status === 0;

/*
 * ============================================================
 * FRONTEND STATIC ASSETS
 * ============================================================
 *
 * Vinext menghasilkan file browser di:
 *
 *   /app/dist/client
 *
 * Contoh:
 *   /app/dist/client/assets/index-xxxx.css
 *   /app/dist/client/assets/page-xxxx.js
 *
 * File-file ini harus dilayani langsung oleh Node server.
 */

const clientRoot = path.resolve(
  process.cwd(),
  "dist",
  "client"
);

const workerModule = await import(
  pathToFileURL(
    path.join(
      process.cwd(),
      "dist",
      "server",
      "index.js"
    )
  ).href
);

const worker = workerModule.default;

if (!worker || typeof worker.fetch !== "function") {
  throw new Error(
    "Vinext worker entry is unavailable."
  );
}

/*
 * ============================================================
 * COMMON HELPERS
 * ============================================================
 */

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type":
      "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders(),
  });

  response.end(JSON.stringify(payload));
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy":
      "strict-origin-when-cross-origin",
    "permissions-policy":
      "camera=(), geolocation=(), microphone=(self)",
    "cross-origin-opener-policy":
      "same-origin",
  };
}

/*
 * ============================================================
 * MIME TYPES
 * ============================================================
 */

function contentTypeFor(filePath) {
  switch (
    path.extname(filePath).toLowerCase()
  ) {
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";

    case ".css":
      return "text/css; charset=utf-8";

    case ".json":
      return "application/json; charset=utf-8";

    case ".svg":
      return "image/svg+xml";

    case ".png":
      return "image/png";

    case ".jpg":
    case ".jpeg":
      return "image/jpeg";

    case ".webp":
      return "image/webp";

    case ".ico":
      return "image/x-icon";

    case ".woff":
      return "font/woff";

    case ".woff2":
      return "font/woff2";

    case ".ttf":
      return "font/ttf";

    case ".otf":
      return "font/otf";

    case ".map":
      return "application/json; charset=utf-8";

    case ".txt":
      return "text/plain; charset=utf-8";

    default:
      return "application/octet-stream";
  }
}

/*
 * ============================================================
 * STATIC CLIENT ASSET SERVER
 * ============================================================
 */

async function serveClientAsset(
  request,
  response,
  url
) {
  if (
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    return false;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(
      url.pathname
    );
  } catch {
    return false;
  }

  if (
    !pathname ||
    pathname === "/" ||
    pathname.includes("\0")
  ) {
    return false;
  }

  /*
   * Resolve request di dalam dist/client.
   *
   * Contoh:
   *
   * /assets/index.css
   *
   * menjadi:
   *
   * /app/dist/client/assets/index.css
   */

  const filePath = path.resolve(
    clientRoot,
    `.${pathname}`
  );

  /*
   * Proteksi path traversal.
   */

  if (
    filePath !== clientRoot &&
    !filePath.startsWith(
      `${clientRoot}${path.sep}`
    )
  ) {
    return false;
  }

  let info;

  try {
    info = await stat(filePath);
  } catch {
    return false;
  }

  if (!info.isFile()) {
    return false;
  }

  /*
   * File di /assets menggunakan nama hash,
   * sehingga aman menggunakan cache panjang.
   */

  const isHashedAsset =
    pathname.startsWith("/assets/");

  response.writeHead(200, {
    "content-type":
      contentTypeFor(filePath),

    "content-length":
      String(info.size),

    "cache-control": isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",

    ...securityHeaders(),
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }

  await pipeline(
    createReadStream(filePath),
    response
  );

  return true;
}

/*
 * ============================================================
 * REQUEST BODY
 * ============================================================
 */

function readBody(
  request,
  limit = maxUpload
) {
  return new Promise(
    (resolve, reject) => {
      const chunks = [];
      let size = 0;

      request.on("data", (chunk) => {
        size += chunk.length;

        if (size > limit) {
          reject(
            Object.assign(
              new Error(
                "Berkas melampaui batas unggah."
              ),
              {
                statusCode: 413,
              }
            )
          );

          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on("end", () =>
        resolve(Buffer.concat(chunks))
      );

      request.on(
        "error",
        reject
      );
    }
  );
}

/*
 * ============================================================
 * TRANSCODE
 * ============================================================
 */

async function transcode(
  request,
  response
) {
  if (!ffmpegAvailable) {
    return sendJson(
      response,
      503,
      {
        error:
          "FFmpeg tidak tersedia pada container ini.",
      }
    );
  }

  const contentLength = Number(
    request.headers[
      "content-length"
    ] || 0
  );

  if (contentLength > maxUpload) {
    return sendJson(
      response,
      413,
      {
        error:
          "Berkas melampaui batas unggah.",
      }
    );
  }

  const work = await mkdtemp(
    path.join(
      tmpdir(),
      "tq-render-"
    )
  );

  const input = path.join(
    work,
    "input.webm"
  );

  const output = path.join(
    work,
    "output.mp4"
  );

  try {
    await pipeline(
      request,
      createWriteStream(
        input,
        {
          mode: 0o600,
        }
      )
    );

    if (
      (await stat(input)).size >
      maxUpload
    ) {
      throw Object.assign(
        new Error(
          "Berkas melampaui batas unggah."
        ),
        {
          statusCode: 413,
        }
      );
    }

    await new Promise(
      (resolve, reject) => {
        const child = spawn(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",

            "-y",

            "-i",
            input,

            "-c:v",
            "libx264",

            "-preset",
            process.env
              .TQ_FFMPEG_PRESET ||
              "medium",

            "-crf",
            process.env
              .TQ_FFMPEG_CRF ||
              "20",

            "-pix_fmt",
            "yuv420p",

            "-c:a",
            "aac",

            "-b:a",
            "192k",

            "-movflags",
            "+faststart",

            output,
          ],
          {
            stdio: [
              "ignore",
              "ignore",
              "pipe",
            ],
          }
        );

        let error = "";

        child.stderr.on(
          "data",
          (chunk) => {
            error =
              `${error}${chunk}`.slice(
                -6000
              );
          }
        );

        child.on(
          "error",
          reject
        );

        child.on(
          "exit",
          (code) =>
            code === 0
              ? resolve()
              : reject(
                  new Error(
                    error ||
                      `FFmpeg keluar dengan kode ${code}`
                  )
                )
        );
      }
    );

    response.writeHead(200, {
      "content-type":
        "video/mp4",

      "content-length":
        String(
          (await stat(output)).size
        ),

      "content-disposition":
        `attachment; filename="${encodeURIComponent(
          request.headers[
            "x-project-name"
          ] ||
            "taysriul-qurani"
        )}.mp4"`,

      "cache-control":
        "no-store",
    });

    const stream =
      createReadStream(output);

    stream.on(
      "close",
      () =>
        void rm(work, {
          recursive: true,
          force: true,
        })
    );

    stream.pipe(response);
  } catch (error) {
    await rm(work, {
      recursive: true,
      force: true,
    });

    if (!response.headersSent) {
      sendJson(
        response,
        error.statusCode || 500,
        {
          error:
            error.message ||
            "Transkode gagal.",
        }
      );
    } else {
      response.destroy(error);
    }
  }
}

/*
 * ============================================================
 * TRANSCRIBE
 * ============================================================
 */

async function transcribe(
  request,
  response
) {
  const endpoint =
    process.env.TQ_TRANSCRIBE_URL;

  if (!endpoint) {
    return sendJson(
      response,
      503,
      {
        error:
          "Adaptor transkripsi belum dikonfigurasi.",

        code:
          "TRANSCRIBE_NOT_CONFIGURED",
      }
    );
  }

  const body =
    await readBody(request);

  const headers = {
    "content-type":
      request.headers[
        "content-type"
      ] ||
      "application/octet-stream",

    accept:
      "application/json",
  };

  if (
    process.env
      .TQ_TRANSCRIBE_TOKEN
  ) {
    headers.authorization =
      `Bearer ${process.env.TQ_TRANSCRIBE_TOKEN}`;
  }

  const upstream = await fetch(
    endpoint,
    {
      method: "POST",
      headers,
      body,
    }
  );

  const payload =
    await upstream.text();

  response.writeHead(
    upstream.status,
    {
      "content-type":
        upstream.headers.get(
          "content-type"
        ) ||
        "application/json",

      "cache-control":
        "no-store",
    }
  );

  response.end(payload);
}

/*
 * ============================================================
 * MEDIA API
 * ============================================================
 */

async function handleMediaApi(
  request,
  response,
  url
) {
  if (
    url.pathname ===
    "/media-api/health"
  ) {
    const [
      database,
      storage,
      queue,
    ] =
      await Promise.all([
        databaseStatus(),
        storageStatus(),
        queueStatus(),
      ]);

    const ok =
      ffmpegAvailable &&
      (
        !database.configured ||
        database.healthy
      ) &&
      storage.healthy;

    return sendJson(
      response,
      ok ? 200 : 503,
      {
        ok,

        service:
          "taysriul-qurani",

        version:
          "1.2.0",

        ffmpeg:
          ffmpegAvailable,

        database,

        storage,

        queue,
      }
    );
  }

  if (
    url.pathname ===
    "/media-api/capabilities"
  ) {
    const [
      database,
      storage,
      queue,
    ] =
      await Promise.all([
        databaseStatus(),
        storageStatus(),
        queueStatus(),
      ]);

    return sendJson(
      response,
      200,
      {
        ffmpeg:
          ffmpegAvailable,

        transcription:
          Boolean(
            process.env
              .TQ_TRANSCRIBE_URL
          ),

        transcriptionModel:
          process.env
            .TQ_TRANSCRIBE_MODEL ||
          null,

        quran:
          await corpusStatus(),

        maxUploadBytes:
          maxUpload,

        persistence:
          database,

        storage,

        queue,

        collaboration:
          database.healthy,

        version:
          "1.2.0",
      }
    );
  }

  if (
    url.pathname ===
      "/media-api/transcribe" &&
    request.method === "POST"
  ) {
    return transcribe(
      request,
      response
    );
  }

  if (
    url.pathname ===
      "/media-api/transcode" &&
    request.method === "POST"
  ) {
    return transcode(
      request,
      response
    );
  }

  if (
    url.pathname ===
    "/media-api/quran/status"
  ) {
    return sendJson(
      response,
      200,
      await corpusStatus()
    );
  }

  if (
    url.pathname ===
    "/media-api/quran/surahs"
  ) {
    try {
      return sendJson(
        response,
        200,
        { surahs: await listSurahs() }
      );
    } catch {
      return sendJson(
        response,
        503,
        { error: "Korpus belum tersedia." }
      );
    }
  }

  if (
    url.pathname ===
    "/media-api/quran/surah"
  ) {
    try {
      const surah =
        await getSurah(
          url.searchParams.get(
            "number"
          )
        );

      return surah
        ? sendJson(
            response,
            200,
            surah
          )
        : sendJson(
            response,
            404,
            {
              error:
                "Surah tidak ditemukan.",
            }
          );
    } catch {
      return sendJson(
        response,
        503,
        {
          error:
            "Korpus belum tersedia. Jalankan sinkronisasi korpus pada container.",
        }
      );
    }
  }

  if (
    url.pathname ===
      "/media-api/quran/match" &&
    request.method === "POST"
  ) {
    try {
      const payload =
        JSON.parse(
          (
            await readBody(
              request,
              1_000_000
            )
          ).toString("utf8")
        );

      const matches =
        await matchAgainstCorpus(
          payload.transcript,
          payload.limit
        );

      return sendJson(
        response,
        200,
        {
          matches,
        }
      );
    } catch (error) {
      return sendJson(
        response,
        error instanceof SyntaxError
          ? 400
          : 503,
        {
          error:
            error.message ||
            "Pencocokan gagal.",
        }
      );
    }
  }

  if (
    url.pathname ===
      "/media-api/quran/align" &&
    request.method === "POST"
  ) {
    try {
      const payload =
        JSON.parse(
          (
            await readBody(
              request,
              4_000_000
            )
          ).toString("utf8")
        );

      const aligned =
        await alignAgainstCorpus(
          payload.parts,
          payload.options
        );

      return sendJson(
        response,
        200,
        {
          aligned,
        }
      );
    } catch (error) {
      return sendJson(
        response,
        error instanceof SyntaxError
          ? 400
          : 503,
        {
          error:
            error.message ||
            "Alignment gagal.",
        }
      );
    }
  }

  if (
    url.pathname ===
      "/media-api/quran/content/sources" &&
    request.method === "GET"
  ) {
    const language = url.searchParams.get("language") || "";
    const kind = url.searchParams.get("kind") || "";
    return sendJson(
      response,
      200,
      {
        sources: await listContentSources({ language, kind, discover: true }),
        status: await contentStatus(),
      }
    );
  }

  if (
    url.pathname ===
      "/media-api/quran/content" &&
    request.method === "GET"
  ) {
    try {
      const entry = await getContentEntry(
        url.searchParams.get("edition"),
        url.searchParams.get("surah"),
        url.searchParams.get("ayah"),
      );
      return entry
        ? sendJson(response, 200, { entry })
        : sendJson(response, 404, { error: "Terjemahan/tafsir tidak ditemukan." });
    } catch (error) {
      return sendJson(response, error?.statusCode || 503, {
        error: error?.message || "Sumber terjemahan/tafsir sementara tidak dapat diakses.",
      });
    }
  }

  if (
    url.pathname ===
      "/media-api/quran/content/batch" &&
    request.method === "POST"
  ) {
    try {
      const payload = JSON.parse((await readBody(request, 500_000)).toString("utf8") || "{}");
      const result = await getContentEntries(payload.edition, payload.refs);
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, error instanceof SyntaxError ? 400 : error?.statusCode || 503, {
        error: error?.message || "Terjemahan/tafsir tidak dapat dimuat.",
      });
    }
  }

  if (
    url.pathname ===
      "/media-api/quran/content/sync" &&
    request.method === "POST"
  ) {
    const expected =
      process.env
        .TQ_ADMIN_TOKEN;

    if (
      !expected ||
      request.headers
        .authorization !==
        `Bearer ${expected}`
    ) {
      return sendJson(
        response,
        403,
        {
          error:
            "Token admin tidak valid.",
        }
      );
    }

    const payload =
      JSON.parse(
        (
          await readBody(
            request,
            100_000
          )
        ).toString("utf8")
      );

    return sendJson(
      response,
      200,
      await syncContentEdition(
        payload.edition
      )
    );
  }

  return sendJson(
    response,
    404,
    {
      error:
        "Endpoint media tidak ditemukan.",
    }
  );
}

/*
 * ============================================================
 * VINEXT APPLICATION
 * ============================================================
 */

async function handleApplication(
  request,
  response,
  url
) {
  const headers =
    new Headers();

  for (
    const [key, value]
    of Object.entries(
      request.headers
    )
  ) {
    if (
      Array.isArray(value)
    ) {
      value.forEach(
        (item) =>
          headers.append(
            key,
            item
          )
      );
    } else if (
      value !== undefined
    ) {
      headers.set(
        key,
        value
      );
    }
  }

  const init = {
    method:
      request.method,

    headers,
  };

  if (
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    init.body =
      await readBody(
        request
      );
  }

  const appResponse =
    await worker.fetch(
      new Request(
        url,
        init
      ),

      process.env,

      {
        waitUntil() {},

        passThroughOnException() {},
      }
    );

  const outgoing = {};

  appResponse.headers.forEach(
    (value, key) => {
      outgoing[key] =
        value;
    }
  );

  Object.assign(
    outgoing,
    securityHeaders()
  );

  response.writeHead(
    appResponse.status,
    outgoing
  );

  if (!appResponse.body) {
    return response.end();
  }

  await pipeline(
    Readable.fromWeb(
      appResponse.body
    ),

    response
  );
}

/*
 * ============================================================
 * STARTUP
 * ============================================================
 */

await mkdir(
  process.env.TQ_DATA_DIR ||
    path.join(
      process.cwd(),
      "data"
    ),
  {
    recursive: true,
  }
);

await migrateDatabase().catch(
  (error) => {
    console.error(
      "Database migration failed:",
      error.message
    );

    if (
      process.env
        .TQ_REQUIRE_DATABASE ===
      "true"
    ) {
      throw error;
    }
  }
);

if (
  process.env
    .TQ_QURAN_AUTO_SYNC ===
  "true"
) {
  corpusStatus()
    .then(
      (status) =>
        status.available
          ? null
          : syncCorpus()
    )
    .catch(
      (error) =>
        console.error(
          "Qur'an corpus sync failed:",
          error.message
        )
    );
}

/*
 * ============================================================
 * HTTP SERVER
 * ============================================================
 */

createServer(
  async (
    request,
    response
  ) => {
    const protocol =
      request.headers[
        "x-forwarded-proto"
      ] || "http";

    const authority =
      request.headers.host ||
      `127.0.0.1:${port}`;

    const url =
      new URL(
        request.url || "/",
        `${protocol}://${authority}`
      );

    try {
      /*
       * Platform API
       */

      if (
        url.pathname.startsWith(
          "/api/v1/"
        )
      ) {
        await handlePlatformApi(
          request,
          response,
          url,
          {
            readBody,
            sendJson,
            maxUpload,
          }
        );

        return;
      }

      /*
       * Media API
       */

      if (
        url.pathname.startsWith(
          "/media-api/"
        )
      ) {
        await handleMediaApi(
          request,
          response,
          url
        );

        return;
      }

      /*
       * STATIC FRONTEND FILES
       *
       * Ini adalah perbaikan utama.
       *
       * /assets/*.js
       * /assets/*.css
       * /favicon.svg
       * /file.svg
       * /window.svg
       * /globe.svg
       *
       * akan dicari di:
       *
       * /app/dist/client
       */

      if (
        await serveClientAsset(
          request,
          response,
          url
        )
      ) {
        return;
      }

      /*
       * Semua route aplikasi lainnya
       * diteruskan ke Vinext.
       */

      await handleApplication(
        request,
        response,
        url
      );
    } catch (error) {
      if (
        !response.headersSent
      ) {
        sendJson(
          response,
          error.statusCode ||
            500,
          {
            error:
              error.message ||
              "Kesalahan server.",
          }
        );
      } else {
        response.destroy(
          error
        );
      }
    }
  }
).listen(
  port,
  host,
  () =>
    console.log(
      `Taysriul Qur'ani listening on ${host}:${port}`
    )
);
