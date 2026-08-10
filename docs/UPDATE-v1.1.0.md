# Update v1.1.0 — TQ-07 sampai TQ-11

Paket ini merupakan update terintegrasi untuk deployment produksi Taysriul Qur'ani.

## TQ-07 — Pustaka Media Qur'an

- Media server persisten di PostgreSQL + MinIO/S3.
- Audio dapat ditandai `surah`, `ayah`, atau `generic`.
- Konvensi nama otomatis: `0001.mp3` = Surah 1 penuh, `001001.mp3` = QS 1:1.
- Unggah banyak berkas sekaligus dari Pustaka Media.
- Cari/filter media, edit nama/qari/referensi Qur'an, arsipkan media.
- Audio/latar yang sudah tersimpan dimuat ulang otomatis saat proyek dibuka.
- Hasil render MP4 kembali masuk ke Pustaka Media.
- Aset internal `render-input` disembunyikan dari pustaka pengguna.

## TQ-08 — Alignment Engine v2

- Guardrail nomor surah 1–114 dan ayat >= 1.
- Urutan maju secara default; backtracking tidak diizinkan tanpa opsi eksplisit.
- Threshold score dan similarity minimum.
- Penggabungan pecahan Whisper yang masih merupakan ayat yang sama.
- Confidence per ayat dan metadata timestamp tersimpan pada aset audio.
- Audio confidence rendah ditandai `needs-review`.

## TQ-09 — Studio Profesional

- Waveform berdasarkan audio aktual dan playhead sinkron.
- Klik cue/segmen melakukan seek ke waktu ayat.
- Undo/redo perubahan segmen.
- Fullscreen preview dan zoom kanvas.
- Template Klasik, Minimal, Sinematik serta watermark.
- Duplikasi proyek tanpa mengunggah ulang media.
- Rasio 16:9, 9:16, dan 1:1.

## TQ-10 — Render & Produksi Massal

- Render seluruh surah/proyek atau ayat terpilih.
- Batch tiga rasio: 16:9, 9:16, 1:1.
- Redis/BullMQ queue dengan retry dan cancel.
- Worker memeriksa permintaan pembatalan saat FFmpeg berjalan.
- 1080p, 1440p, 2160p (4K), MP4 H.264 + AAC.
- SRT/VTT/ASS tetap tersedia.

## TQ-11 — Hardening

- Migration runner berurutan dan migration `002-media-library`.
- Validasi magic-byte upload media.
- Rate limiting upload/render/auth.
- Archive/hard-delete guard pada aset yang masih direferensikan.
- Endpoint status sistem untuk owner.
- Backup workspace memuat manifest media dan render job.
- Test alignment/deployment dan preflight rilis.

## Deploy

1. Push seluruh isi paket ke branch `main`.
2. Jangan mengubah secret Coolify yang sudah bekerja.
3. Deploy ulang resource Compose.
4. Migration `002-media-library` berjalan otomatis saat `app` dan `render-worker` mulai.
5. Setelah `New container started`, lakukan `Ctrl+F5` dan uji Pustaka Media dengan `0001.mp3`.

Data PostgreSQL dan bucket MinIO yang sudah ada tidak dihapus oleh update ini.
