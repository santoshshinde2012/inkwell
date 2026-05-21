import { HealthSchema } from "@inkwell/shared";
import { jsonOk } from "@/lib/responses";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  // Validate against the shared contract so a drift in this shape fails
  // loudly here rather than silently shipping a malformed health payload.
  const body = HealthSchema.parse({
    ok: true as const,
    version: "1.1.0",
    runtime: "edge",
    timestamp: new Date().toISOString(),
  });
  return jsonOk(body, request.headers.get("origin"));
}

export async function OPTIONS(_request: Request): Promise<Response> {
  // Preflight is handled in middleware; this stub silences the
  // "no method handler" warning Next emits in some setups.
  return new Response(null, { status: 204 });
}
