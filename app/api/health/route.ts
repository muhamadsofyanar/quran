// @phase TQ-06 — application health endpoint.
export async function GET() {
  return Response.json({
    status: "ok",
    service: "taysriul-qurani",
    version: "1.1.0",
    timestamp: new Date().toISOString(),
  });
}
