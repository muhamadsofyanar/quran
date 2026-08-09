# Matriks Fungsi v1.0

| Tahap VIDEO QURAN | Implementasi v1.0 | Status |
|---|---|---|
| 1. Transkripsi murottal | faster-whisper lokal, VAD, timestamp segmen/kata | Siap runtime |
| 2. Konfirmasi surah/ayat | alignment urut, pengulangan, alternatif, confidence, human review | Nyata |
| 3. Subtitle Arab | SRT, VTT, ASS | Nyata |
| 4. Subtitle terjemahan | terjemahan atau gabungan; sumber berlisensi | Nyata setelah sumber aktif |
| 5. Latar | gambar/video, rasio, resolusi, pratinjau | Nyata |
| 6. Render | WebM browser, antrean Redis, worker MP4 H.264/AAC | Nyata |
| 7. Penyimpanan | PostgreSQL + S3/local + autosave versi | Nyata |
| 8. Kolaborasi | peran, komentar waktu, persetujuan, audit | Nyata |
| 9. Pemulihan | backup metadata, restore proyek, panduan pg_dump/S3 | Nyata |

“Siap runtime” berarti kode dan konfigurasi selesai tetapi membutuhkan container, model, dan data eksternal pada deployment.
