# Operasi, Backup, dan Pemulihan

## Pemeriksaan harian

- `/media-api/health` mengembalikan `ok: true`.
- PostgreSQL, Redis, storage, transcriber, dan render-worker berstatus sehat.
- Antrean tidak menumpuk dan ruang disk cukup.
- Kegagalan render berulang diperiksa sebelum retry manual.

## Backup penuh

Backup penuh terdiri dari tiga bagian:

1. PostgreSQL: akun, workspace, proyek, audit, komentar, aset, dan job.
2. Bucket S3/MinIO: audio, latar, input render, dan MP4.
3. Volume model/korpus: dapat diunduh ulang, tetapi backup mempercepat pemulihan.

Gunakan mekanisme backup volume/database Coolify atau `pg_dump` dari jaringan internal. Jangan menyimpan hasil backup di repository GitHub.

## Backup dari aplikasi

Menu Pengaturan → **Unduh backup** menghasilkan JSON dengan checksum. Isinya cocok untuk pemulihan metadata proyek ke workspace, bukan pengganti backup PostgreSQL dan bucket.

## Pemulihan

1. Pulihkan PostgreSQL ke instance kosong dengan versi kompatibel.
2. Pulihkan bucket menggunakan key yang sama.
3. Pastikan environment mengarah ke database, Redis, dan bucket yang benar.
4. Deploy aplikasi versi yang sama dengan backup.
5. Jalankan health check, login, buka proyek, dan unduh satu aset.
6. Render satu proyek pendek sebelum membuka akses pengguna.

## Penskalaan

- Tambah `TQ_RENDER_CONCURRENCY` hanya setelah CPU/RAM mencukupi.
- Untuk banyak render, jalankan beberapa replica worker; jangan menambah replica app tanpa shared PostgreSQL/Redis/S3.
- GPU transcriber menggunakan konfigurasi perangkat dan compute type yang sesuai image/host.
- 4K jauh lebih berat daripada 1080p; jadikan 1080p preset default.
