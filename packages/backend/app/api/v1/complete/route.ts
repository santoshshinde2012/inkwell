// HTTP wrapper around the completion pipeline. Stays thin — pure HTTP
// concerns (read headers, parse JSON, choose response shape). All
// validation / sanitization / streaming lives in lib/completion-pipeline.ts.
//
// No authentication: the request is anonymous. CORS (handled in
// middleware.ts) restricts browser callers to the extension origin, and
// the pipeline rate-limits by client IP.
//
// Node runtime is chosen so the in-memory IP rate limiter retains state
// across requests while the function is warm; Edge isolates are too
// short-lived for that. Node functions on Vercel stream natively.

import { ERROR_CODES, apiError } from "@inkwell/shared";
import { runCompletion } from "@/lib/completion-pipeline";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { jsonError, sseHeaders } from "@/lib/responses";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const contentBytes = Number(request.headers.get("content-length") ?? "0");

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(
      apiError(ERROR_CODES.VALIDATION_FAILED, "Body is not valid JSON"),
      origin,
    );
  }

  const result = runCompletion({
    clientKey: clientKeyFromRequest(request),
    rawBody,
    contentBytes,
    signal: request.signal,
  });

  if (!result.ok) {
    return jsonError(result.error, origin);
  }

  return new Response(result.stream, {
    status: 200,
    headers: sseHeaders(origin),
  });
}

export async function OPTIONS(_request: Request): Promise<Response> {
  return new Response(null, { status: 204 });
}
