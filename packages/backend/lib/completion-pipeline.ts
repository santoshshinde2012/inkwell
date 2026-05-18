// Completion pipeline.
//
// Pure domain orchestration extracted from app/api/v1/complete/route.ts so
// the route handler stays HTTP-only and this can be unit-tested without an
// HTTP harness.
//
// There is no authentication and no database. The request is anonymous;
// rate limiting is keyed by client IP; personalization (if any) is carried
// on the request itself.
//
// Flow:
//
//     enforceSize → validate → rateLimit(IP)
//                                   ↓
//          sanitize → detectInjection → buildPrompt
//                                   ↓
//                       streamModel → emitSSE → logCompletion

import {
  ApiError,
  CompleteRequest,
  CompleteRequestSchema,
  DEFAULT_MODEL_ID,
  ERROR_CODES,
  LIMITS,
  apiError,
  SseUsagePayload,
} from "@inkwell/shared";
import { logCompletion } from "./audit-log";
import { buildPrompt } from "./prompt-builder";
import { getProviderForModel } from "./providers";
import { checkRateLimit } from "./rate-limit";
import { detectSuspicious, sanitizeContext } from "./sanitizer";
import { sseDone, sseError, sseToken, sseUsage } from "./responses";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PipelineInput {
  /** IP-derived rate-limit key — NOT a user account (there are none). */
  clientKey: string;
  rawBody: unknown;
  contentBytes: number;
  /** Aborted when the HTTP client disconnects. */
  signal: AbortSignal;
}

export type PipelineResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Stage helpers — each returns either a refined value or an ApiError.
// ---------------------------------------------------------------------------

const enforceSize = (bytes: number): ApiError | null => {
  if (bytes > LIMITS.MAX_REQUEST_BYTES) {
    return apiError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Request body exceeds ${LIMITS.MAX_REQUEST_BYTES} bytes`,
    );
  }
  return null;
};

const validate = (
  raw: unknown,
): { ok: true; value: CompleteRequest } | { ok: false; error: ApiError } => {
  const parsed = CompleteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: apiError(ERROR_CODES.VALIDATION_FAILED, "Request did not match schema", {
        issues: parsed.error.flatten(),
      }),
    };
  }
  return { ok: true, value: parsed.data };
};

const enforceInjection = (req: CompleteRequest): ApiError | null => {
  const reason = detectSuspicious(req.context);
  if (!reason) return null;
  return apiError(
    ERROR_CODES.FORBIDDEN,
    "Refused: page content appeared to contain prompt injection.",
    { reason },
  );
};

const enforceRateLimit = (clientKey: string): ApiError | null => {
  const verdict = checkRateLimit(clientKey);
  if (verdict.success) return null;
  return apiError(ERROR_CODES.RATE_LIMITED, "Too many requests; please wait.");
};

// ---------------------------------------------------------------------------
// Streaming construction.
// ---------------------------------------------------------------------------

interface StreamArgs {
  request: CompleteRequest;
  clientKey: string;
  contentBytes: number;
  startedAt: number;
  signal: AbortSignal;
}

const buildStream = (args: StreamArgs): ReadableStream<Uint8Array> => {
  const { request, clientKey, contentBytes, startedAt, signal } = args;

  // Wire the inbound abort signal through so client disconnects free
  // upstream resources.
  const abortController = new AbortController();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const prompt = buildPrompt(request);
  // The request model is validated against the catalog by zod, so it's
  // always a known model id when present. Otherwise fall back to the
  // operator-set env default, then the catalog default.
  const model = request.model ?? env.OPENAI_DEFAULT_MODEL ?? DEFAULT_MODEL_ID;
  // Resolve which provider serves this model. Adding a non-OpenAI provider
  // later changes nothing here — the registry handles dispatch.
  const provider = getProviderForModel(model);

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let modelUsed = model;
  let errorCode: string | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of provider.streamCompletion({
          model,
          system: prompt.system,
          user: prompt.user,
          signal: abortController.signal,
        })) {
          if (chunk.delta) sseToken(controller, { delta: chunk.delta });
          if (chunk.usage) {
            const u: SseUsagePayload = chunk.usage;
            promptTokens = u.promptTokens;
            completionTokens = u.completionTokens;
            totalTokens = u.totalTokens;
            modelUsed = u.model;
            sseUsage(controller, u);
          }
        }
        sseDone(controller);
      } catch (err: unknown) {
        const aborted =
          (err as { name?: string })?.name === "AbortError" ||
          abortController.signal.aborted;
        if (aborted) {
          errorCode = ERROR_CODES.STREAM_ABORTED;
          sseError(controller, {
            code: ERROR_CODES.STREAM_ABORTED,
            message: "Stream aborted",
            retryable: true,
          });
        } else {
          // Never echo upstream error details — they may leak provider info.
          errorCode = ERROR_CODES.UPSTREAM_ERROR;
          sseError(controller, {
            code: ERROR_CODES.UPSTREAM_ERROR,
            message: "Upstream model error",
            retryable: true,
          });
        }
      } finally {
        logCompletion({
          clientKey,
          action: request.action,
          model: modelUsed,
          promptTokens,
          completionTokens,
          totalTokens,
          requestBytes: contentBytes,
          durationMs: Date.now() - startedAt,
          status: errorCode ? 500 : 200,
          // Language ids only — useful for per-language quality metrics, and
          // safe to log because they carry no user content.
          ...(request.sourceLanguage
            ? { sourceLanguage: request.sourceLanguage }
            : {}),
          ...(request.targetLanguage
            ? { targetLanguage: request.targetLanguage }
            : {}),
          ...(errorCode ? { errorCode } : {}),
          ...(request.clientRequestId
            ? { clientRequestId: request.clientRequestId }
            : {}),
        });
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export const runCompletion = (input: PipelineInput): PipelineResult => {
  const startedAt = Date.now();

  const sizeErr = enforceSize(input.contentBytes);
  if (sizeErr) return { ok: false, error: sizeErr };

  const validation = validate(input.rawBody);
  if (!validation.ok) return validation;

  // Rate limit BEFORE we touch OpenAI.
  const rateErr = enforceRateLimit(input.clientKey);
  if (rateErr) return { ok: false, error: rateErr };

  const sanitizedContext = sanitizeContext(validation.value.context);
  const finalRequest: CompleteRequest = {
    ...validation.value,
    context: sanitizedContext,
  };

  const injectionErr = enforceInjection(finalRequest);
  if (injectionErr) return { ok: false, error: injectionErr };

  const stream = buildStream({
    request: finalRequest,
    clientKey: input.clientKey,
    contentBytes: input.contentBytes,
    startedAt,
    signal: input.signal,
  });
  return { ok: true, stream };
};
