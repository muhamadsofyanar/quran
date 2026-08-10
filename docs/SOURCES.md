# Sumber Qur'an, Terjemahan, dan Tafsir

## Korpus utama

Korpus Utsmani disinkronkan dari `TQ_QURAN_SOURCE_URL`, lalu divalidasi menjadi tepat 114 surah, 6.236 ayat, 30 juz, 604 halaman, dan 240 rubu. Hasil disimpan bersama checksum SHA-256; sinkronisasi dibatalkan bila struktur wajib tidak sesuai.

## QuranEnc — terjemahan dan tafsir

TQ-12 menggunakan API QuranEnc untuk katalog terjemahan dan pengambilan konten per-surah. Katalog menyertakan key, bahasa, versi, tanggal pembaruan, judul, dan deskripsi. Konten surah berisi pasangan surah/ayat, terjemahan, serta footnote.

Sumber pilihan awal:

- `quranenc:indonesian_affairs` — Terjemahan Kementerian Agama RI.
- `quranenc:indonesian_sabiq` — Terjemahan Indonesia PT. Sabiq/Pusat Terjemah Ruwwad.
- `quranenc:indonesian_mokhtasar` — Tafsir Al-Mukhtasar Indonesia.

Katalog global ditemukan secara dinamis saat aplikasi berjalan. Artinya bahasa/sumber baru dari katalog tidak memerlukan perubahan source Taysriul Qur'ani.

Konten sumber tidak boleh dimodifikasi ketika digunakan sebagai edisi QuranEnc. Aplikasi karena itu:

1. menyimpan teks persis sebagaimana dikembalikan sumber;
2. menampilkan atribusi publisher dan QuranEnc;
3. menyimpan/menampilkan versi sumber;
4. menggunakan cache terbatas dan menemukan versi katalog terbaru kembali;
5. membuat textarea sumber read-only; penyuntingan hanya melalui `Teks manual`.

## Cache

Konten QuranEnc disimpan per edisi/per surah di `TQ_DATA_DIR/quran/content`. Default TTL adalah tujuh hari (`TQ_CONTENT_CACHE_SECONDS=604800`). Katalog di-cache di memory selama enam jam.

## Sumber tambahan khusus operator

`TQ_QURAN_CONTENT_SOURCES_JSON` tetap dapat dipakai untuk menambah/override registri. Sumber non-QuranEnc wajib memiliki metadata lisensi dan `redistributionAllowed: true` + `enabled: true` sebelum disinkronkan.

## Mushaf Madinah

Pilihan v1/v2 adalah preset tampilan studio. Teks Qur'an tetap berasal dari korpus produksi tervalidasi. Font/aset pihak ketiga hanya boleh dibundel setelah hak penggunaan diverifikasi.
