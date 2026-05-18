// Helpers for building JSON / SSE responses with consistent shape and headers.

import {
  ApiError,
  ERROR_CODES,
  ErrorCode,
  SSE,
  SseTokenPayload,
  SseUsagePayload,
  SseErrorPayload,
} from "@inkwell/shared";
import { buildCorsHeaders } from "./cors";

const json = (
  body: unknown,
  init: { status?: number; origin: string | null; headers?: HeadersInit } = {
    origin: null,
  },
): Response => {
  const headers = new Headers(init.headers);
  for (const [k, v] of buildCorsHeaders(init.origin).entries()) headers.set(k, v);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
};

export const jsonOk = (body: unknown, origin: string | null): Response =>
  json(body, { origin });

export const jsonError = (
  error: ApiError,
  origin: string | null,
  status?: number,
): Response =>
  json(
    { error },
    {
      origin,
      status: status ?? statusForCode(error.code),
    },
  );

export const statusForCode = (code: ErrorCode): number => {
  switch (code) {
    case ERROR_CODES.FORBIDDEN:
    case ERROR_CODES.ORIGIN_NOT_ALLOWED:
    case ERROR_CODES.SITE_BLOCKED:
      return 403;
    case ERROR_CODES.VALIDATION_FAILED:
      return 400;
    case ERROR_CODES.PAYLOAD_TOO_LARGE:
      return 413;
    case ERROR_CODES.RATE_LIMITED:
    case ERROR_CODES.QUOTA_EXCEEDED:
      return 429;
    case ERROR_CODES.UPSTREAM_ERROR:
      return 502;
    case ERROR_CODES.TIMEOUT:
      return 504;
    case ERROR_CODES.STREAM_ABORTED:
      return 499; // client-closed-request, nginx convention
    case ERROR_CODES.NETWORK_ERROR:
      return 503;
    case ERROR_CODES.INTERNAL_ERROR:
    default:
      return 500;
  }
};

// ---------------------------------------------------------------------------
// SSE writer. Each event is `event: <name>\ndata: <json>\n\n`.
// ---------------------------------------------------------------------------

export const sseHeaders = (origin: string | null): Headers => {
  const headers = new Headers();
  for (const [k, v] of buildCorsHeaders(origin).entries()) headers.set(k, v);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  // Disable proxy buffering. Nginx in front of self-hosted setups respects this;
  // Vercel's Edge already streams without buffering.
  headers.set("X-Accel-Buffering", "no");
  headers.set("Connection", "keep-alive");
  return headers;
};

const enc = new TextEncoder();

const sseEvent = (event: string, data: unknown): Uint8Array =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const sseToken = (controller: ReadableStreamDefaultController, payload: SseTokenPayload): void => {
  controller.enqueue(sseEvent(SSE.EVENT_TOKEN, payload));
};

export const sseUsage = (controller: ReadableStreamDefaultController, payload: SseUsagePayload): void => {
  controller.enqueue(sseEvent(SSE.EVENT_USAGE, payload));
};

export const sseError = (controller: ReadableStreamDefaultController, payload: SseErrorPayload): void => {
  controller.enqueue(sseEvent(SSE.EVENT_ERROR, payload));
};

export const sseDone = (controller: ReadableStreamDefaultController): void => {
  controller.enqueue(sseEvent(SSE.EVENT_DONE, { ok: true }));
};
