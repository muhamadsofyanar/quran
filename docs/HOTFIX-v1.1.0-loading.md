# Hotfix v1.1.0 — startup loading screen

Hotfix ini memperbaiki regresi pada `app/page.tsx` yang menyebabkan aplikasi berhenti pada layar **Menyiapkan Taysriul Qur'ani…** walaupun seluruh container sehat.

Penyebabnya adalah lifecycle `useEffect` untuk bootstrap runtime tidak ikut terbawa saat integrasi TQ-07 sampai TQ-11. Akibatnya `sessionMode` tetap bernilai `checking` dan browser tidak pernah meminta `/media-api/capabilities` maupun `/api/v1/auth/session`.

Perbaikan:

- mengembalikan bootstrap capabilities dan sesi;
- menambahkan timeout 12 detik agar startup tidak bisa menggantung permanen;
- mengembalikan pemuatan proyek, autosave lokal/server, polling render, komentar, anggota workspace, dan timer toast;
- mengaktifkan refresh Pustaka Media setelah login;
- memuat ulang audio/background proyek dari MinIO berdasarkan `audioAssetId`/`backgroundAssetId`;
- memuat indeks 114 surah dari endpoint produksi;
- menambahkan regression test yang memastikan bootstrap runtime tetap ada.

Tidak ada perubahan pada Environment Variables atau volume produksi.
