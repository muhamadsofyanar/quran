# Checklist Rilis v1.1.0

## 0–40% — Mesin dasar

- [x] Studio responsif.
- [x] Upload dan playback audio.
- [x] Korpus tervalidasi dan checksum.
- [x] Subtitle SRT/VTT/ASS.
- [x] WebM dan FFmpeg MP4.

## 40–65% — Data produksi

- [x] Akun, sesi, workspace, peran.
- [x] PostgreSQL dan migrasi.
- [x] Autosave dengan conflict protection.
- [x] Storage lokal/S3.
- [x] Backup/restore metadata.

## 65–90% — AI dan antrean

- [x] Timestamp kata.
- [x] Alignment berurutan, pengulangan, alternatif.
- [x] Registri terjemahan/tafsir berlisensi.
- [x] Redis/BullMQ, retry, progress, worker.
- [x] Hasil MP4 permanen dan signed download.

## 90–100% — Rilis

- [x] Komentar waktu dan persetujuan.
- [x] Audit immutable dan security headers.
- [x] Dokumentasi GitHub/Coolify/operasi.
- [x] Lint, build, test, dan preflight.
- [x] Paket bersih siap GitHub.

## Gerbang eksternal setelah paket

- [ ] Diunggah manual ke GitHub.
- [ ] Dideploy di Coolify.
- [ ] DNS/TLS aktif.
- [ ] Benchmark murottal nyata selesai.
- [ ] Lisensi setiap sumber konten disetujui.

Kotak eksternal tidak mengurangi status 100% pra-deployment; kotak tersebut menentukan kapan layanan produksi boleh diumumkan kepada pengguna umum.

## Tambahan v1.1.0

- [ ] Migration terbaru menunjukkan `002-media-library`.
- [ ] Pustaka Media menampilkan audio lama setelah refresh/login ulang.
- [ ] `0001.mp3` dikenali sebagai Surah 1 atau metadata hasil alignment memperbaruinya.
- [ ] Audio proyek dapat dimuat tanpa upload ulang.
- [ ] Daftar Pustaka Al-Qur'an memuat 114 surah.
- [ ] Matcher tidak menghasilkan ayat 0/-1 dan tidak mundur pada mode default.
- [ ] Render ayat terpilih berhasil.
- [ ] Render seluruh proyek berhasil.
- [ ] Batch 16:9, 9:16, 1:1 masuk antrean.
- [ ] Retry job gagal dan pembatalan job diuji.
- [ ] Output MP4 muncul di Pustaka Media.
- [ ] Backup manifest mencakup metadata media dan render.
