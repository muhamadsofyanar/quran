# v1.1.1 media stream hotfix

Fixes Pustaka Media audio/background playback when MinIO runs on the private Docker hostname `minio:9000`.

Previously `/api/v1/assets/:id/download` redirected the browser to a presigned URL generated from the internal S3 endpoint. Browsers cannot resolve `minio` and an HTTPS page must not fetch an `http://minio:9000` resource, resulting in `Failed to fetch`.

The application now streams S3/MinIO objects through the authenticated same-origin API route. This also fixes stored render downloads that use the same route.
