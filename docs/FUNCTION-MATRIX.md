# Matriks Fungsi v1.2.0

| Fungsi produksi | Implementasi | Status source |
|---|---|---|
| Audio satu surah | Pustaka Media + marker ayat non-destruktif | Siap |
| Audio per ayat | `scope=ayah`, konvensi nama, reuse asset | Siap |
| Pustaka Media | list/search/filter/reuse/archive/stream/dedupe | Siap |
| Persistensi media | PostgreSQL metadata + MinIO/S3/local object | Siap |
| Reload media proyek | `audioAssetId`/`backgroundAssetId` dimuat kembali via same-origin | Siap |
| Transkripsi | faster-whisper lokal, Arabic, word timestamps | Siap runtime |
| Alignment | urutan, invalid-ayah guard, confidence, repeat handling | Siap |
| Korpus | 114/6236/30/604/240 + SHA-256 | Siap runtime |
| Terjemahan Indonesia | Kemenag RI default + PT. Sabiq | Siap on-demand |
| Tafsir Indonesia | Al-Mukhtasar sebagai layer terpisah | Siap on-demand |
| Terjemahan global | Discovery katalog QuranEnc + versi terbaru | Siap on-demand |
| Proteksi sumber | atribusi, versi, source text read-only | Siap |
| Studio | waveform, playhead, seek cue, zoom, fullscreen | Siap |
| Edit | time fields, undo/redo, verifikasi manusia | Siap |
| Desain | Mushaf v1/v2 UI, preset, watermark, latar | Siap |
| Subtitle | SRT/VTT/ASS Arab/terjemahan/tafsir/all | Siap |
| Render per ayat | rentang ayat terpilih | Siap |
| Render per surah | seluruh timeline proyek | Siap |
| Batch rasio | 16:9 + 9:16 + 1:1 | Siap |
| Queue | Redis/BullMQ, progress, retry | Siap |
| Cancel | queued langsung; processing checkpoint | Siap |
| Output | MP4 H.264/AAC kembali ke Pustaka Media | Siap |
| Kolaborasi | owner/editor/reviewer/viewer | Siap |
| Audit/approval | komentar waktu, approval, append-only audit | Siap |
| Backup | project/review/media/render manifest | Siap |
| Migration | 001 + 002 + 003 berurutan dan idempotent | Siap |
| Hardening upload | MIME + magic signature + size + rate limit + dedupe | Siap |
