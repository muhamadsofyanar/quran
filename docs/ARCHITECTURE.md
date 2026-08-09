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
