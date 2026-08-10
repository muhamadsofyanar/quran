# Roadmap Taysriul Qur'ani

## Selesai pada v1.2.0

| Fase | Fokus | Status |
|---|---|---|
| TQ-07 | Pustaka Media Qur'an per surah/per ayat | Selesai |
| TQ-08 | Alignment Engine v2 + guardrail | Selesai |
| TQ-09 | Studio profesional | Selesai |
| TQ-10 | Render/batch/retry/cancel | Selesai |
| TQ-11 | Hardening, migration, observability, test | Selesai |
| TQ-12 | Terjemahan/tafsir multibahasa, media stream same-origin, dedupe | Selesai |
| TQ-13 | Katalog qari, audio otomatis, marker deterministik, dan cache | Selesai |

## Validasi runtime setelah satu deploy

1. Pastikan `0001.mp3` dapat diputar langsung dari Pustaka Media tanpa upload ulang.
2. Pastikan migration 003 menyisakan satu salinan aktif untuk file checksum yang sama.
3. Buka Al-Fatihah dan pastikan terjemahan Kemenag muncul untuk ayat 1–7.
4. Aktifkan Tafsir dan pastikan Al-Mukhtasar muncul sebagai layer terpisah.
5. Uji beberapa qari/surah panjang untuk benchmark alignment pada CPU VPS aktual.
6. Uji render 1080p, lalu 4K/batch sesuai kapasitas RAM/CPU aktual.
7. Jadwalkan backup PostgreSQL dan object storage di tingkat infrastruktur.
8. Pilih Al-Fatihah dari Sumber Qur'an dan pastikan audio-worker menghasilkan tujuh marker tanpa Whisper.
