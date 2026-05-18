// Edge middleware. Runs before every /api/v1/* request.
//
// There is no authentication. The middleware's only job is CORS:
//   1. Answer OPTIONS preflight.
//   2. Reject requests from origins that aren't the configured extension
//      ID(s) or same-origin.
//   3. Attach CORS headers to the forwarded response.
//
// Rate limiting is NOT done here — the /api/v1/complete handler rate-limits
// by client IP before opening the stream (Edge middleware can't easily
// participate in SSE).

import { NextRequest, NextResponse } from "next/server";
import { ERROR_CODES, apiError } from "@inkwell/shared";
import {
  buildCorsHeaders,
  buildPreflightResponse,
  isOriginAllowed,
} from "./lib/cors";
import { jsonError } from "./lib/responses";

export const config = {
  matcher: ["/api/v1/:path*"],
};

export default function middleware(request: NextRequest): Response {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return buildPreflightResponse(origin);
  }

  if (!isOriginAllowed(origin)) {
    return jsonError(
      apiError(ERROR_CODES.ORIGIN_NOT_ALLOWED, "Origin not allowed"),
      origin,
    );
  }

  const res = NextResponse.next();
  for (const [k, v] of buildCorsHeaders(origin).entries()) {
    res.headers.set(k, v);
  }
  return res;
}
