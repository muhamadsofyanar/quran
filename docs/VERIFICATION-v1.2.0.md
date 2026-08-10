# Verifikasi source v1.2.0

Pemeriksaan dilakukan pada source final TQ-12 sebelum ZIP dibuat.

## Lulus

- `node --check` seluruh file `.js/.mjs`: lulus.
- `python -m py_compile services/transcriber/app.py`: lulus.
- `node --test tests/media-core.test.mjs tests/content-core.test.mjs tests/deployment.test.mjs`: **14/14 lulus**.
- `node scripts/preflight.mjs`: **Preflight 100%**.
- parser TypeScript membaca `app/page.tsx` tanpa error syntax; diagnostic yang tersisa hanya karena package React/types belum terpasang pada sandbox pemeriksaan.
- scan marker merge conflict `<<<<<<<`, `=======`, `>>>>>>>`: bersih.
- regression coverage mencakup invalid ayah, urutan alignment, ASS newline, katalog QuranEnc, cache per-surah, media same-origin, dedupe route, pin MinIO cpuv1, dan NumPy 1.26.4.

## Full dependency/build

`npm ci` dicoba pada sandbox pemeriksaan, tetapi registry npm internal sandbox mengembalikan HTTP 404 untuk tarball `zod-validation-error-4.0.2`. Karena dependency tidak dapat dipasang di sandbox tersebut, `npm run build` penuh tidak dapat dijalankan di sini.

Build Docker Coolify menjadi integration gate terakhir. Dockerfile sendiri sudah memakai alur build+artifact validation yang sebelumnya berhasil pada VPS produksi.
