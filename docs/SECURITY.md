# Keamanan Produksi

## Sudah diterapkan

- Scrypt dengan salt unik untuk kata sandi.
- Token sesi acak disimpan sebagai hash; cookie `HttpOnly`, `SameSite=Strict`, dan `Secure` pada produksi.
- Pemeriksaan origin untuk request yang mengubah data.
- Rate limit login dan pendaftaran.
- Role workspace: owner, editor, reviewer, viewer.
- Optimistic locking agar autosave tidak menimpa perubahan lain.
- Audit PostgreSQL append-only.
- Batas ukuran, kategori MIME, dan object key buatan server untuk upload.
- Signed URL S3 berumur pendek.
- Security headers untuk UI dan API.
- Rahasia hanya melalui environment dan `.env*` diabaikan Git.

## Tindakan operator

1. Gunakan rahasia acak minimal 32 byte.
2. Matikan pendaftaran umum setelah akun pemilik dibuat bila belum diperlukan.
3. Jangan expose PostgreSQL, Redis, MinIO, transcriber, dan worker.
4. Pasang pembaruan image dan dependensi melalui rilis teruji, bukan perubahan otomatis tanpa tes.
5. Batasi ukuran upload sesuai kapasitas disk dan reverse proxy.
6. Simpan backup terenkripsi di lokasi terpisah.
7. Periksa audit log dan kegagalan login secara berkala.
8. Rotasi token admin dan kredensial storage bila bocor.

## Batas penting

- Validasi MIME berbasis header mengurangi risiko, tetapi antivirus/malware scanner eksternal tetap disarankan untuk layanan publik.
- API backup aplikasi mencakup metadata proyek; backup penuh memerlukan PostgreSQL dan object storage.
- Kebenaran ayat tetap membutuhkan pemeriksaan manusia sebelum publikasi.

## v1.1.0 media hardening

- Upload media diverifikasi menggunakan signature/magic bytes selain `Content-Type`.
- Nama file dibersihkan dari karakter CR/LF dan dibatasi panjangnya.
- Media dihapus secara lunak (archive) secara default. Hapus permanen hanya untuk owner dan ditolak ketika aset masih direferensikan proyek/render.
- Signed/local download tetap memerlukan session + workspace access.
- Endpoint upload dan render memiliki rate limit per alamat klien.
- Metadata Qur'an dibatasi pada nomor surah 1–114 dan rentang ayat positif.

## v1.2.0 — media dan konten eksternal

- URL object storage internal tidak diberikan ke browser; aplikasi melakukan stream same-origin setelah pemeriksaan sesi/workspace.
- Provider key QuranEnc disanitasi dan URL upstream selalu dibangun dari base URL QuranEnc, bukan URL arbitrer dari request pengguna.
- Konten QuranEnc yang tampil sebagai sumber resmi dikunci read-only untuk mencegah modifikasi yang kemudian tetap diberi atribusi sumber.
- Upload checksum-identik digunakan kembali sehingga mengurangi duplikasi storage; hard delete tetap diblokir bila aset direferensikan proyek/render.
