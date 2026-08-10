# Update v1.3.0 — Katalog Audio Qur'an

## Hasil

Studio sekarang memakai **Sumber Qur'an** sebagai pilihan utama. Pengguna memilih qari, surah, dan seluruh surah atau rentang ayat. Sistem menyiapkan satu MP3 beserta marker setiap ayat tanpa membuka Explorer dan tanpa menjalankan Whisper.

## Komponen baru

- `server/quran-audio.mjs`: katalog qari, cache, validasi, unduhan, FFprobe, FFmpeg, dan marker.
- `server/quran-audio-queue.mjs`: antrean BullMQ `tq-quran-audio`.
- `server/quran-audio-worker.mjs`: worker audio terpisah.
- `server/migrations/004-quran-audio-jobs.sql`: status pekerjaan persisten dan indeks cache.
- `audio-worker` pada `docker-compose.coolify.yml`.

## Deployment

Unggah seluruh isi rilis ke root repository, lalu deploy ulang dengan compose yang sama. Coolify membuat service `audio-worker` dan aplikasi menjalankan migration 004 secara otomatis. Tidak ada API key atau environment baru yang wajib diisi.

Setelah deploy, buka Studio dan pastikan tab **Sumber Qur'an** menampilkan banyak qari. Uji pertama yang disarankan adalah Al-Fatihah; setelah status selesai, audio harus muncul di Pustaka Media dan tujuh segmen ayat harus berstatus belum diperiksa.
