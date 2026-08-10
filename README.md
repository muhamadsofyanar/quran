# Taysriul Qur'ani v1.2.0

Studio produksi VIDEO QURAN mandiri untuk alur audio → transkripsi Arab → alignment ayat → terjemahan/tafsir → pemeriksaan manusia → desain → subtitle → render MP4. Repository, akun, database, media, domain, deployment, dan roadmap berdiri sendiri dari Sullamul Hifz.

## Status rilis

TQ-01 sampai TQ-12 sudah terintegrasi pada source. v1.2.0 menggabungkan seluruh update agar cukup satu redeploy setelah repository diganti:

- **TQ-07 Pustaka Media Qur'an**: media permanen di MinIO/S3, dipakai ulang tanpa unggah ulang, audio per-surah/per-ayat, pencarian/filter, metadata qari, arsip, dan hasil render.
- **TQ-08 Alignment Engine v2**: nomor ayat ilegal ditolak, urutan maju, confidence, pengulangan, timestamp kata, dan guardrail hasil lemah.
- **TQ-09 Studio Profesional**: waveform, playhead, seek cue, zoom/fullscreen, undo/redo, template, watermark, 16:9/9:16/1:1, dan desain per proyek.
- **TQ-10 Produksi Massal**: render per ayat/per surah, batch tiga rasio, Redis queue, retry/cancel, 1080p/1440p/4K, subtitle SRT/VTT/ASS, hasil kembali ke pustaka.
- **TQ-11 Hardening**: role, review/approval, audit, backup/restore, file signature checks, rate limiting, health status, migration runner, dan regression tests.
- **TQ-12 Multilingual Content & Media Stability**: streaming media same-origin dari MinIO, deduplikasi upload, migrasi metadata audio lama, terjemahan/tafsir QuranEnc on-demand, katalog bahasa dinamis, cache per-surah, atribusi+versi, dan teks sumber dikunci dari modifikasi.

## Pustaka Media Qur'an

Media disimpan pada object storage dan metadata pada PostgreSQL. Browser tidak menerima hostname internal MinIO; media di-stream melalui domain aplikasi sendiri.

Konvensi nama audio yang dikenali otomatis:

```text
0001.mp3    → Surah 1 penuh
0114.mp3    → Surah 114 penuh
001001.mp3  → QS 1:1
002255.mp3  → QS 2:255
1-1.mp3     → QS 1:1
```

Audio satu surah tetap satu file fisik. Marker ayat, waktu, confidence, dan metadata alignment disimpan tanpa memotong file asli. Migration `003-content-and-dedupe` mengarsipkan duplikat lama dan upload baru dengan checksum yang sama akan memakai aset yang sudah ada.

## Terjemahan dan tafsir

Default produksi:

- Indonesia — Kementerian Agama RI (`quranenc:indonesian_affairs`)
- Indonesia — PT. Sabiq (`quranenc:indonesian_sabiq`)
- Tafsir Al-Mukhtasar — Indonesia (`quranenc:indonesian_mokhtasar`)

Aplikasi juga membaca katalog QuranEnc secara dinamis sehingga terjemahan bahasa lain dapat muncul tanpa perubahan kode/redeploy. Konten diambil per surah saat dibutuhkan dan disimpan pada cache lokal. Versi sumber dan atribusi dipertahankan pada UI/render. Konten otomatis bersifat read-only; pilih `Teks manual` bila ingin menulis teks sendiri.

## Integritas Al-Qur'an

- Korpus ditolak bila jumlahnya bukan tepat 114 surah, 6.236 ayat, 30 juz, 604 halaman, dan 240 rubu'.
- Matcher menolak nomor surah/ayat ilegal dan secara default tidak bergerak mundur.
- Confidence rendah tetap memerlukan pemeriksaan manusia.
- Render diblokir sampai potongan yang dirender ditandai sudah diperiksa manusia.
- Terjemahan/tafsir sumber tidak dimodifikasi; atribusi dan versi ditampilkan.

## Deployment Coolify

Gunakan `docker-compose.coolify.yml` yang ada. Rilis ini mempertahankan konfigurasi kompatibilitas VPS:

- MinIO `RELEASE.2025-09-07T16-13-09Z-cpuv1`
- NumPy `1.26.4`
- render-worker tanpa HTTP healthcheck

Setelah source v1.2.0 menggantikan repository `main`, cukup lakukan **satu deploy**. Migration `003-content-and-dedupe` berjalan otomatis dan mempertahankan data produksi. Environment Variables yang sudah bekerja tidak perlu diubah; dua opsi TQ-12 memiliki default aman di compose.

## Pemeriksaan source

```bash
npm ci
npm run lint
npm test
npm run preflight
```

Pemeriksaan yang tidak membutuhkan dependency frontend:

```bash
node --test tests/media-core.test.mjs
node --test tests/deployment.test.mjs
```

Lihat `docs/UPDATE-v1.2.0.md`, `docs/COOLIFY.md`, `docs/SOURCES.md`, `docs/OPERATIONS.md`, dan `docs/RELEASE-CHECKLIST.md`.
