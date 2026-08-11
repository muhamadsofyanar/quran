# Update v1.3.1 — Pemulihan Teks Arab

Hotfix ini memperbaiki proyek lama dan potongan manual yang memiliki nomor surah/ayat, tetapi kolom teks Arabnya kosong.

## Perbaikan

- Teks Arab yang kosong otomatis diambil dari korpus Utsmani lokal berdasarkan nomor surah dan ayat.
- Pemulihan berlaku untuk proyek tersimpan, potongan manual, dan aset audio cache lama.
- Teks Arab yang sudah disunting pengguna tidak ditimpa.
- Pratinjau menampilkan status pemuatan ketika teks Arab belum tersedia, bukan ruang kosong.
- Artefak catatan kaki kosong seperti `[]` dibersihkan dari terjemahan dan tafsir, termasuk cache lama.
- Hasil Sumber Qur'an tetap memakai marker deterministik dan wajib diperiksa manusia sebelum render.

## Setelah deploy

Lakukan hard refresh (`Ctrl+F5`), lalu buka kembali proyek. Potongan yang kosong akan dipulihkan otomatis dan disimpan kembali ke proyek.
