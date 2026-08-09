# Taysriul Qur'ani v1.0.0

Studio produksi VIDEO QURAN mandiri untuk alur audio → transkripsi Arab → alignment ayat → subtitle → pemeriksaan manusia → render MP4. Proyek ini sepenuhnya terpisah dari Sullamul Hifz.

## Status 100%

`100%` pada paket ini berarti seluruh kode, konfigurasi, pengujian, dan dokumentasi **pra-deployment** telah selesai. GitHub, Coolify, DNS/TLS, unduhan model AI pertama, benchmark murottal nyata, serta aktivasi sumber terjemahan/tafsir pihak ketiga tetap merupakan gerbang eksternal yang dilakukan sesudah paket diunggah.

| Komponen | Status |
|---|---|
| Studio, audio, latar, timeline, Mushaf v1/v2 | Siap |
| Whisper lokal dengan timestamp kata | Siap dikonfigurasi |
| Alignment berurutan, pengulangan, confidence, alternatif ayat | Siap |
| SRT, VTT, ASS Arab/terjemahan/gabungan | Siap |
| PostgreSQL, akun, workspace, peran, autosave | Siap |
| Media lokal atau S3-compatible | Siap |
| Redis, retry, progress, worker FFmpeg | Siap |
| Komentar waktu, persetujuan, audit immutable | Siap |
| Backup/pemulihan metadata | Siap |
| Korpus 114 surah/6.236 ayat dengan checksum | Sinkron saat server aktif |
| Terjemahan/tafsir pihak ketiga | Mesin siap; tiap sumber diblokir sampai lisensi diverifikasi |

## Menjalankan pemeriksaan lokal

```bash
npm ci
npm run lint
npm test
npm run preflight
```

Mode tanpa `DATABASE_URL` tetap dapat dibuka untuk pemeriksaan antarmuka dengan penyimpanan perangkat. Mode produksi menggunakan `docker-compose.coolify.yml`.

## Struktur utama

- `app/`: antarmuka produksi, akun, studio, pustaka, render, dan pengaturan.
- `lib/media-core.mjs`: normalisasi Arab, alignment, dan generator subtitle.
- `server/`: API, akun, PostgreSQL, storage, korpus, antrean, dan worker render.
- `services/transcriber/`: faster-whisper lokal yang kompatibel dengan endpoint OpenAI Audio Transcriptions.
- `server/migrations/`: skema produksi.
- `docs/`: arsitektur, Coolify, keamanan, operasi, sumber, dan checklist rilis.

## Aturan integritas

- Render final diblokir sampai seluruh potongan ayat diperiksa manusia.
- Korpus ditolak bila jumlah 114 surah, 6.236 ayat, 30 juz, 604 halaman, atau 240 rubu tidak sesuai.
- Terjemahan/tafsir tidak dapat disinkronkan sebelum izin redistribusi dan metadata lisensinya dicatat.
- Tidak ada klaim “AI unlimited”; kapasitas mengikuti CPU/GPU, storage, dan kebijakan server.
- Repository, akun, database, media, domain, deployment, dan roadmap tidak berbagi dengan Sullamul Hifz.

Mulai deployment dari `docs/COOLIFY.md`.
