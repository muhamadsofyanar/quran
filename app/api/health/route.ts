// @phase TQ-06 — application health endpoint.
export async function GET() {
  return Response.json({
    status: "ok",
    service: "taysriul-qurani",
    version: "1.3.1",
    timestamp: new Date().toISOString(),
  });
}
