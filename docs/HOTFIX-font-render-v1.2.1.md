# v1.2.1 — Font Render + CI Verify Hotfix

Hotfix ini mempertahankan konsistensi font Arab antara preview Studio dan hasil render, sekaligus memperbaiki regresi CI pada `app/page.tsx`.

## Font/render
- Preview dan canvas render memakai urutan font Arab yang sama.
- Canvas memakai weight `400`, sama dengan preview.
- Render menunggu `document.fonts.ready` sebelum merekam frame pertama.
- ASS subtitle meminta `Traditional Arabic` lebih dahulu, bukan Arial generik.
- Tidak ada binary font yang dibundel.

## CI/lint
- Handler media diubah dari `useMediaAsset` menjadi `applyMediaAsset` agar tidak salah diperlakukan sebagai React Hook.
- Dua teks JSX `Qur'an` yang memicu `react/no-unescaped-entities` diganti dengan apostrof tipografis `Qur’an`.
- Setter `setWaveformPeaks` yang tidak digunakan dihapus.
- Enam efek lifecycle yang sengaja memakai helper lokal diberi pengecualian `react-hooks/exhaustive-deps` terarah pada dependency array masing-masing, tanpa menonaktifkan aturan secara global.

## Verifikasi lokal sandbox
- `node --check` seluruh `.mjs`: PASS.
- `node scripts/preflight.mjs`: 100%.
- 14/14 test dependency-free (`media-core`, `content-core`, `deployment`): PASS.
- Parser TypeScript menemukan tidak ada syntax error pada `app/page.tsx`; diagnostic modul React muncul karena `node_modules` tidak tersedia di sandbox.
- `npm ci`/ESLint penuh tidak dapat dijalankan di sandbox karena registry internal mengembalikan HTTP 404 untuk `zod-validation-error-4.0.2`; GitHub Actions/Coolify menjadi integration gate untuk dependency penuh.
