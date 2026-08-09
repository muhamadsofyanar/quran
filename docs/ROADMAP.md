# Roadmap Taysriul Qur'ani

| Fase | Cakupan | Status kode | Persentase kumulatif |
|---|---|---:|---:|
| TQ-01 | Fondasi produk dan studio | Selesai | 20% |
| TQ-02 | Subtitle, korpus, transkripsi, render dasar | Selesai | 40% |
| TQ-03 | Akun, PostgreSQL, storage, autosave, backup | Selesai | 65% |
| TQ-04 | Alignment tingkat lanjut dan registri sumber | Selesai | 78% |
| TQ-05 | Redis, worker, retry, progress, MP4 permanen | Selesai | 90% |
| TQ-06 | Kolaborasi, keamanan, operasi, rilis | Selesai | 100% |

## Setelah 100% pra-deployment

Gerbang berikut bukan pengembangan fitur baru:

1. Unggah manual ke GitHub.
2. Deploy Docker Compose di Coolify.
3. Hubungkan domain `taysriulqurani.id` dan pastikan TLS aktif.
4. Tunggu unduhan model faster-whisper pertama.
5. Jalankan benchmark audio murottal nyata dan catat akurasinya.
6. Aktifkan hanya sumber terjemahan/tafsir yang lisensinya telah diverifikasi.

Perubahan setelah rilis dicatat sebagai v1.0.x untuk perbaikan atau v1.1 untuk kemampuan baru.
