# Checklist Rilis v1.3.1

## Mesin dasar

- [x] Studio responsif.
- [x] Upload dan playback audio.
- [x] Korpus tervalidasi dan checksum.
- [x] Subtitle SRT/VTT/ASS termasuk layer tafsir.
- [x] FFmpeg MP4 H.264 + AAC.

## Data produksi

- [x] Akun, sesi, workspace, peran.
- [x] PostgreSQL dan migration runner 001–003.
- [x] Autosave dengan conflict protection.
- [x] MinIO/S3/local object storage.
- [x] Media stream same-origin melalui aplikasi.
- [x] Checksum deduplication + arsip duplikat lama.
- [x] Backup/restore metadata.

## Qur'an, AI, terjemahan, tafsir

- [x] Timestamp kata.
- [x] Alignment berurutan, repeat handling, invalid-ayah guard.
- [x] 114 surah / 6.236 ayat / 30 juz / 604 halaman / 240 rubu.
- [x] Kemenag RI default melalui QuranEnc.
- [x] PT. Sabiq sebagai alternatif Indonesia.
- [x] Tafsir Al-Mukhtasar Indonesia.
- [x] Katalog bahasa QuranEnc dinamis.
- [x] Cache konten per-surah.
- [x] Atribusi + versi sumber.
- [x] Teks sumber read-only; mode manual tetap tersedia.

## Render & hardening

- [x] Redis/BullMQ, progress, retry, cancel, worker.
- [x] Render per ayat/per surah dan batch 3 rasio.
- [x] Hasil MP4 permanen kembali ke Pustaka Media.
- [x] Komentar waktu dan persetujuan.
- [x] Audit append-only dan security headers.
- [x] File signature, size guard, dan rate limit upload.
- [x] Dokumentasi GitHub/Coolify/operasi.
- [x] Preflight TQ-13.

## Validasi setelah satu deploy

- [ ] Migration terbaru menunjukkan `003-content-and-dedupe`.
- [ ] Pustaka Media hanya menampilkan satu salinan aktif `0001.mp3` setelah dedupe.
- [ ] `0001.mp3` dapat diputar/digunakan dari Pustaka tanpa upload ulang.
- [ ] Al-Fatihah terpetakan 1→7 tanpa 0/-1.
- [ ] Terjemahan Kemenag otomatis muncul untuk semua potongan.
- [ ] Tafsir Al-Mukhtasar dapat diaktifkan sebagai layer terpisah.
- [ ] Render 1080p berhasil dan MP4 masuk Pustaka Media.
- [ ] Batch 16:9/9:16/1:1 diuji bila kapasitas VPS cukup.
- [ ] Backup PostgreSQL dan object storage dijadwalkan.
