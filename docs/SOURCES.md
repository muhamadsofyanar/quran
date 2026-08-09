# Sumber Qur'an, Terjemahan, dan Tafsir

## Korpus utama

Korpus Utsmani disinkronkan dari URL yang ditentukan `TQ_QURAN_SOURCE_URL`, lalu divalidasi menjadi tepat:

- 114 surah;
- 6.236 ayat;
- 30 juz;
- 604 halaman;
- 240 rubu.

Hasil disimpan bersama checksum SHA-256. Sinkronisasi dibatalkan bila hitungan atau baris wajib tidak sesuai.

## Registri edisi

`server/sources/quran-content-sources.json` adalah daftar contoh, bukan izin penggunaan. Secara bawaan semua edisi pihak ketiga dinonaktifkan.

Operator dapat menambahkan sumber melalui `TQ_QURAN_CONTENT_SOURCES_JSON`. Setiap sumber wajib memuat:

- `edition`, `kind`, `language`, `name`, dan `author`;
- `sourceUrl`;
- `licenseName` dan `licenseUrl`;
- `redistributionAllowed: true`;
- `enabled: true`.

Sistem menolak sinkronisasi bila lisensi masih `verification-required` atau izin redistribusi belum benar.

## Mushaf Madinah

Pilihan v1/v2 pada UI adalah preset tampilan. Font dan pemetaan halaman resmi hanya boleh dibundel setelah lisensi font/asetnya diperiksa. Jangan mengganti teks korpus dengan gambar atau font yang belum tervalidasi.
