# Taysriul Qur'ani v1.1.0

Studio produksi VIDEO QURAN mandiri untuk alur audio → transkripsi Arab → alignment ayat → pemeriksaan manusia → desain → subtitle → render MP4. Repository, akun, database, media, domain, deployment, dan roadmap berdiri sendiri dari Sullamul Hifz.

## Status fase

TQ-01 sampai TQ-11 sudah terintegrasi pada source. Paket v1.1.0 menambahkan lima fase produksi lanjutan:

- **TQ-07 Pustaka Media Qur'an**: media server dapat didaftar, dicari, diunggah massal, dipakai ulang, diarsipkan, dan dimuat kembali dari MinIO/S3. Audio mendukung cakupan `surah`, `ayah`, atau `generic`. Nama `0001.mp3` dikenali sebagai Surah 1 penuh dan `001001.mp3` sebagai QS 1:1.
- **TQ-08 Alignment Engine v2**: guardrail nomor ayat, urutan maju, threshold minimum, penanganan segmen berulang, confidence, dan metadata alignment per audio.
- **TQ-09 Studio Profesional**: waveform audio aktual, playhead sinkron, klik cue untuk seek, undo/redo, duplikasi proyek, fullscreen preview, zoom, template desain, watermark, format 16:9/9:16/1:1, dan render per ayat atau seluruh proyek.
- **TQ-10 Produksi Massal**: batch tiga rasio, antrean Redis, retry render gagal, cancel queued/processing pada checkpoint aman, progress, hasil MP4 otomatis masuk Pustaka Media.
- **TQ-11 Production Hardening**: migration runner berurutan, metadata media tervalidasi, file signature checks, rate limiting, audit, backup manifest, status sistem, smoke/unit tests, dan operasi Coolify.

## Pustaka Media Qur'an

Media disimpan pada object storage dan metadata pada PostgreSQL. File audio tidak perlu diunggah ulang setelah refresh/login ulang.

Contoh konvensi nama:

```text
0001.mp3    → Surah 1 penuh
0114.mp3    → Surah 114 penuh
001001.mp3  → QS 1:1
002255.mp3  → QS 2:255
1-1.mp3     → QS 1:1
```

Setelah transkripsi/alignment, metadata aset diperbarui dengan nomor surah, rentang ayat, durasi, status analisis, dan ringkasan timestamp ayat. Audio satu surah tetap satu file fisik; potongan ayat adalah marker waktu non-destruktif.

## Integritas Al-Qur'an

- Korpus ditolak bila jumlahnya bukan tepat 114 surah, 6.236 ayat, 30 juz, 604 halaman, dan 240 rubu'.
- Matcher menolak nomor surah/ayat ilegal dan, secara default, tidak bergerak mundur.
- Hasil confidence rendah tetap memerlukan pemeriksaan manusia.
- Render diblokir sampai potongan yang dirender ditandai sudah diperiksa manusia.
- Terjemahan/tafsir pihak ketiga tetap diblokir sampai lisensi redistribusinya diverifikasi.

## Render

- MP4 H.264 + AAC melalui FFmpeg worker.
- 1080p, 1440p, 2160p (4K).
- Rasio 16:9, 9:16, 1:1.
- Render seluruh surah/proyek atau ayat terpilih.
- Batch tiga rasio berjalan berurutan agar browser stabil.
- Job gagal dapat dicoba ulang; job queued atau processing dapat diminta dibatalkan.
- Hasil server disimpan sebagai `render-output` pada Pustaka Media.

## Pemeriksaan lokal

```bash
npm ci
npm run lint
npm test
npm run preflight
```

Pemeriksaan yang tidak membutuhkan dependency frontend dapat dijalankan langsung:

```bash
node --test tests/media-core.test.mjs
node --test tests/deployment.test.mjs
```

## Deployment Coolify

Gunakan `docker-compose.coolify.yml` yang ada pada repository. Setelah update v1.1.0 di-push ke `main`, lakukan redeploy. Migration `002-media-library` dijalankan otomatis saat app/worker mulai dan mempertahankan data produksi yang sudah ada.

Lihat `docs/COOLIFY.md`, `docs/OPERATIONS.md`, `docs/SECURITY.md`, dan `docs/RELEASE-CHECKLIST.md`.
