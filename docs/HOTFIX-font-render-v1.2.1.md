# v1.2.1 — Font Render Consistency Hotfix

This hotfix keeps Qur'an Arabic typography consistent between Studio preview and browser canvas video rendering.

Changes:
- Preview and canvas render use the same Arabic font stack in the same order.
- Canvas Arabic weight is aligned to the preview (`400`), avoiding a synthetic heavier face during render.
- Video rendering waits for the browser font set before recording the first frame.
- ASS subtitle export requests `Traditional Arabic` instead of generic Arial for the Qur'an style.
- No font binaries are bundled; the application uses locally available fonts and deterministic fallback order.

If the preferred Arabic font is unavailable on a client device, preview and render still use the same fallback stack on that device.
