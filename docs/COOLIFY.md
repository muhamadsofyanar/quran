# Panduan GitHub Manual dan Coolify

Ikuti urutan ini setelah ZIP v1.2.0 diterima.

## 0–20% — Siapkan GitHub

1. Ekstrak ZIP. Pastikan isi repository langsung menampilkan `package.json`, `Dockerfile`, dan `docker-compose.coolify.yml`, bukan folder ganda.
2. Buat repository GitHub baru dan kosong, misalnya `taysriul-qurani`.
3. Unggah seluruh isi folder melalui GitHub atau Git di komputer.
4. Pastikan `.env` dan berkas audio/video tidak ikut terunggah.

## 20–40% — Buat resource Coolify

1. Pilih **New Resource → Public/Private Repository**.
2. Pilih repository dan branch utama.
3. Pilih tipe **Docker Compose**.
4. Isi compose file: `docker-compose.coolify.yml`.
5. Jangan mengubah Dockerfile atau command bawaan.

## 40–60% — Isi environment

Buat nilai acak berbeda untuk setiap rahasia. Contoh membuat nilai acak di terminal komputer/server:

```bash
openssl rand -hex 32
```

Environment wajib:

```dotenv
APP_URL=https://taysriulqurani.id
TQ_ALLOWED_ORIGINS=https://taysriulqurani.id
POSTGRES_PASSWORD=nilai-acak-panjang
REDIS_PASSWORD=nilai-acak-panjang
MINIO_ROOT_USER=taysriul-storage
MINIO_ROOT_PASSWORD=nilai-acak-panjang
TQ_IP_HASH_SALT=nilai-acak-panjang
TQ_ADMIN_TOKEN=nilai-acak-panjang
TQ_ALLOW_SIGNUP=true
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
TQ_RENDER_CONCURRENCY=1
```

Jangan menyalin contoh `replace-with...` dari `.env.example` sebagai nilai produksi.

## 60–75% — Domain dan resource

1. Arahkan domain aplikasi ke service `app` port `3000`.
2. Gunakan `https://taysriulqurani.id`.
3. Aktifkan health check.
4. Minimum awal yang disarankan untuk CPU-only: 4 vCPU, RAM 8 GB, ruang kosong 30 GB. Model dan render 4K memerlukan sumber daya lebih besar.
5. Jangan membuka PostgreSQL, Redis, MinIO, transcriber, atau render-worker ke internet.

## 75–90% — Deploy pertama

1. Tekan **Deploy**.
2. Tunggu semua service sehat. Unduhan model AI pertama dapat membuat transcriber lebih lama siap.
3. Buka `/media-api/health`. Hasil harus `ok: true`, versi `1.2.0`, `ffmpeg: true`, database sehat, storage sehat, dan queue sehat.
4. Buka aplikasi, buat akun pemilik pertama, lalu ubah `TQ_ALLOW_SIGNUP=false` bila aplikasi belum dibuka untuk umum.

## 90–100% — Uji nyata

1. Buat satu proyek uji pendek.
2. Unggah murottal 20–60 detik.
3. Jalankan transkripsi dan periksa surah, ayat, pengulangan, dan timing.
4. Verifikasi seluruh potongan secara manual.
5. Ekspor SRT, VTT, dan ASS.
6. Render 1080p dan pastikan job mencapai 100% serta MP4 dapat diunduh.
7. Unduh backup metadata dari Pengaturan.
8. Jalankan backup PostgreSQL dan bucket sesuai `OPERATIONS.md`.

## Catatan storage

Compose menggunakan image MinIO `cpuv1` yang kompatibel dengan CPU VPS saat ini. Jangan mengganti tag tersebut tanpa pengujian CPU terlebih dahulu. Aplikasi juga dapat memakai endpoint S3-compatible lain melalui environment yang sama.

Sumber QuranEnc bawaan TQ-12 sudah dikonfigurasi dengan atribusi, versi, dan kebijakan read-only. Sumber pihak ketiga lain tetap wajib diverifikasi lisensinya sebelum diaktifkan.
