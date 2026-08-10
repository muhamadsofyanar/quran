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

## Operasi v1.1.0 — TQ-07 sampai TQ-11

### Pustaka Media

`GET /api/v1/assets` menampilkan aset workspace. Filter yang tersedia: `kind`, `projectId`, `scope`, `surah`, `ayah`, dan `q`. Aset yang diarsipkan disembunyikan dari daftar tetapi tetap dapat dibaca oleh proyek yang masih merujuknya.

`PATCH /api/v1/assets/:id` mengubah metadata non-biner seperti nama, qari, cakupan surah/ayat, durasi, dan status analisis. `DELETE` mengarsipkan; `?hard=1` hanya untuk owner dan ditolak bila aset masih direferensikan proyek/render.

### Konvensi audio Qur'an

- `0001.mp3` → Surah 1 penuh.
- `001001.mp3` atau `1-1.mp3` → QS 1:1.
- Setelah alignment, metadata server menjadi sumber utama dan tidak lagi bergantung pada nama file.

### Render

`POST /api/v1/render-jobs/:id/retry` mengulang job BullMQ yang gagal dan masih tersimpan. `DELETE /api/v1/render-jobs/:id` membatalkan queued job; untuk processing job server menandai `cancel_requested` dan worker mengirim SIGTERM ke FFmpeg pada polling checkpoint.

### Status sistem

Owner dapat membaca `GET /api/v1/system/status` untuk jumlah proyek, media, total byte media, status render, anggota, audit event, dan migration terbaru.

### Migration

Startup menjalankan semua file `server/migrations/*.sql` secara berurutan. Database lama yang sudah memiliki `001-production` hanya menjalankan `002-media-library` satu kali.

## Operasi v1.2.0 — TQ-12

- Media browser harus diambil melalui `/api/v1/assets/:id/download`; jangan expose port MinIO ke internet hanya untuk playback.
- Migration `003-content-and-dedupe` otomatis mengarsipkan upload checksum-identik. Gunakan **Rapikan duplikat** bila operator ingin menjalankan dedupe lagi secara manual.
- QuranEnc diambil on-demand per surah. Gangguan upstream tidak merusak korpus Arab atau media; konten yang sudah dicache tetap dapat digunakan selama cache valid.
- Default cache konten 7 hari dan discovery katalog 6 jam. Perubahan katalog tidak memerlukan redeploy.
- Setelah source translation/tafsir otomatis dipilih, textarea dibuat read-only. Untuk koreksi editorial lokal gunakan `Teks manual`, bukan mengubah teks sumber.

## Operasi v1.3.0 — TQ-13

- Service `audio-worker` memproses antrean `tq-quran-audio` dan tidak membuka port publik.
- Cache MP3 per ayat berada di volume `tq-data`; hasil gabungan berada di MinIO; status pekerjaan berada di PostgreSQL.
- Jika katalog langsung gagal, aplikasi memakai katalog disk atau fallback tanpa menjatuhkan health aplikasi utama.
- Migration `004-quran-audio-jobs` berjalan otomatis. Jangan menghapus volume `tq-data` bila ingin mempertahankan cache unduhan.
- Pekerjaan dapat dipulihkan saat proyek dibuka kembali melalui status pekerjaan terbaru untuk proyek tersebut.
