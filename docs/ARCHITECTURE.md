# Arsitektur Taysriul Qur'ani v1.0

## Alur pengguna

1. Pengguna masuk ke workspace mandiri.
2. Audio dan latar diunggah ke object storage.
3. faster-whisper menghasilkan teks, segmen, dan timestamp kata.
4. alignment berurutan mencocokkan potongan dengan korpus tervalidasi.
5. Pengguna mengoreksi ayat, waktu, terjemahan, dan desain.
6. Pemeriksa memberi komentar berbasis waktu dan keputusan.
7. Browser menyusun kanvas WebM; Redis menyerahkan pekerjaan ke worker FFmpeg.
8. Worker menghasilkan MP4 H.264/AAC dan menyimpannya sebagai aset permanen.

## Komponen

| Komponen | Tanggung jawab |
|---|---|
| Vinext/React | UI responsif dan komposisi video browser |
| Node gateway | API, keamanan upload, korpus, adaptor AI, health check |
| PostgreSQL | akun, sesi, workspace, proyek, aset, komentar, persetujuan, audit |
| S3-compatible | audio, latar, input dan output render |
| Redis/BullMQ | antrean, retry, progress, pembatalan sebelum proses |
| Render worker | FFmpeg H.264/AAC 1080p–4K |
| faster-whisper | transkripsi Arab lokal dan timestamp kata |

## Pagar data

- Cookie sesi opaque, `HttpOnly`, `SameSite=Strict`, dan `Secure` pada produksi.
- Kata sandi disimpan dengan scrypt dan salt unik.
- Workspace mempunyai peran owner, editor, reviewer, dan viewer.
- Autosave memakai nomor versi; perubahan perangkat lain menghasilkan konflik 409, bukan menimpa diam-diam.
- Audit bersifat append-only melalui trigger PostgreSQL.
- Object key dibuat server dan tidak menerima path mentah pengguna.
- Semua rahasia hanya melalui environment.

## Mode degradasi aman

- Tanpa PostgreSQL: UI berjalan sebagai mode lokal untuk pemeriksaan, bukan produksi multi-user.
- Tanpa Redis: render langsung browser/FFmpeg masih tersedia, tetapi tidak tahan penutupan halaman.
- Tanpa S3: storage lokal dapat dipakai untuk pengembangan satu server.
- Tanpa model AI: pengguna tetap dapat menambah segmen secara manual.

## v1.1.0 — Media Library and production pipeline

`TQ-07` menambahkan metadata Pustaka Media pada `tq_media_assets` tanpa memindahkan objek yang sudah ada. Project menyimpan `audioAssetId`/`backgroundAssetId`; browser memuat ulang objek melalui endpoint download/inline sehingga refresh tidak meminta unggah ulang.

Audio Qur'an dapat berupa satu file per surah atau satu file per ayat. Alignment tidak memotong audio secara destruktif: marker ayat disimpan pada state proyek dan metadata aset. Render ayat menggunakan rentang marker tersebut, sedangkan render surah memakai sumber utuh.

`TQ-10` mempertahankan pemisahan komposisi browser dan transkode server. WebM komposisi masuk Redis/BullMQ, worker FFmpeg menghasilkan MP4, lalu output dicatat sebagai aset `render-output` sehingga dapat dipakai sebagai arsip produksi.

## v1.2.0 — content gateway and same-origin media

Alur media browser:

`Browser → app /api/v1/assets/:id/download → authorization workspace → storage.mjs → MinIO/S3 stream → Browser`

Alur konten:

`Studio → media-api content/batch → source registry → QuranEnc catalog/source → per-surah cache → project segments → render/subtitle`

Katalog QuranEnc ditemukan saat runtime, sedangkan tiga sumber Indonesia dipin sebagai preferred fallback. Teks sumber, versi, dan atribusi dibawa sampai layer preview/render.
