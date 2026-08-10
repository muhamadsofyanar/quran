# Roadmap Taysriul Qur'ani

## Selesai pada v1.1.0

| Fase | Fokus | Status |
|---|---|---|
| TQ-07 | Pustaka Media Qur'an per surah/per ayat | Selesai |
| TQ-08 | Alignment Engine v2 + guardrail | Selesai |
| TQ-09 | Studio profesional | Selesai |
| TQ-10 | Render/batch/retry/cancel | Selesai |
| TQ-11 | Hardening, migration, observability, test | Selesai |

## Gerbang runtime yang tetap perlu diuji setelah deploy

1. Benchmark beberapa qari dan surah panjang pada CPU VPS aktual.
2. Verifikasi hasil timestamp ayat pada audio dengan isti'adzah, basmalah, pengulangan, dan jeda panjang.
3. Uji render 4K dan batch tiga rasio terhadap RAM/CPU aktual.
4. Verifikasi lisensi setiap sumber terjemahan/tafsir sebelum diaktifkan.
5. Jadwalkan backup PostgreSQL dan bucket MinIO di level infrastruktur.

Gerbang runtime tidak mengubah kelengkapan source; hasilnya menentukan tuning operasional server.
