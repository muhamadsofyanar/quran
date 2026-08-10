# Matriks Fungsi v1.1.0

| Fungsi produksi | Implementasi | Status source |
|---|---|---|
| Audio satu surah | Pustaka Media + marker ayat non-destruktif | Siap |
| Audio per ayat | Metadata `scope=ayah`, konvensi nama, reuse asset | Siap |
| Pustaka Media | list/search/filter/reuse/archive/download/stream | Siap |
| Persistensi media | PostgreSQL metadata + MinIO/S3/local object | Siap |
| Reload media proyek | `audioAssetId`/`backgroundAssetId` dimuat kembali | Siap |
| Transkripsi | faster-whisper lokal, Arabic, word timestamps | Siap runtime |
| Alignment | urutan, invalid-ayah guard, confidence, repeat coalescing | Siap |
| Korpus | 114/6236/30/604/240 + SHA-256 | Siap runtime |
| Pustaka 114 surah | endpoint indeks + pencarian UI | Siap |
| Studio | waveform nyata, playhead, seek cue, zoom, fullscreen | Siap |
| Edit | time fields, undo/redo, verifikasi manusia | Siap |
| Desain | Mushaf v1/v2 UI, 3 preset, watermark, latar | Siap |
| Subtitle | SRT/VTT/ASS Arab/terjemahan/gabungan | Siap |
| Render per ayat | capture rentang ayat terpilih | Siap |
| Render per surah | seluruh timeline proyek | Siap |
| Batch rasio | 16:9 + 9:16 + 1:1 berurutan | Siap |
| Queue | Redis/BullMQ, progress, retry | Siap |
| Cancel | queued langsung; processing checkpoint FFmpeg | Siap |
| Output | MP4 H.264/AAC kembali ke Pustaka Media | Siap |
| Kolaborasi | owner/editor/reviewer/viewer | Siap |
| Audit/approval | komentar waktu, approval, append-only audit | Siap |
| Backup | project/review/media manifest/render manifest | Siap |
| Migration | 001 + 002 berurutan dan idempotent | Siap |
| Hardening upload | MIME + magic signature + size + rate limit | Siap |
