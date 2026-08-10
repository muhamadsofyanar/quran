# Update v1.2.0 — TQ-12 Single-Deploy Consolidation

Rilis ini menggabungkan hotfix media stream dengan Pustaka Media, Alignment v2, Studio, Render, Hardening, dan sumber terjemahan/tafsir agar operator tidak perlu melakukan beberapa redeploy berturut-turut.

## Media

- Download/stream MinIO lewat `/api/v1/assets/:id/download`; browser tidak diarahkan ke `http://minio:9000`.
- `0001.mp3` dapat dipakai ulang dari Pustaka Media setelah refresh/login.
- Upload baru dideduplikasi berdasarkan checksum per workspace+jenis.
- Migration `003-content-and-dedupe` mengarsipkan duplikat lama.
- Nama audio lama empat digit dan enam digit dibackfill sebagai per-surah/per-ayat.
- Tombol **Rapikan duplikat** tersedia di Pustaka Media.

## Terjemahan & tafsir

- Kementerian Agama RI menjadi sumber terjemahan Indonesia default.
- PT. Sabiq tersedia sebagai alternatif Indonesia.
- Tafsir Al-Mukhtasar Indonesia tersedia sebagai layer tafsir.
- Katalog terjemahan QuranEnc ditemukan secara dinamis untuk pilihan bahasa lain.
- Data diambil per surah saat diperlukan, lalu dicache; tidak perlu mengunduh seluruh dunia saat startup.
- Alignment baru otomatis dapat mengisi terjemahan seluruh potongan sekaligus.
- Proyek lama dengan ayat yang sudah tersinkron akan di-hydrate otomatis ketika dibuka.
- Teks sumber otomatis read-only untuk menjaga ketentuan sumber; mode manual tetap tersedia.
- Atribusi dan versi sumber dibawa ke preview/render.

## Subtitle & render

Mode subtitle: Arab, terjemahan, tafsir, gabungan Arab+terjemahan, atau semua layer. Render tetap memakai worker FFmpeg MP4 H.264 + AAC dan hasil masuk ke Pustaka Media.

## Deployment

Tidak diperlukan Environment Variable baru untuk deployment yang sudah sehat. Compose memiliki default:

```dotenv
TQ_QURANENC_DISCOVERY=true
TQ_CONTENT_CACHE_SECONDS=604800
```

Migration 003 dijalankan otomatis oleh migration runner saat app/worker mulai. Volume PostgreSQL, MinIO, Redis, data Qur'an, dan model Whisper tetap digunakan; jangan dihapus.
