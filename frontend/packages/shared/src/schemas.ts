import { z } from "zod";
import { ACTIONS } from "./actions";
import { TONE_PRESETS } from "./tones";
import { MODEL_IDS } from "./models";
import { LANGUAGE_IDS, SOURCE_LANGUAGE_IDS } from "./languages";
import { LIMITS } from "./constants";
import { ERROR_CODES } from "./errors";

// ---------------------------------------------------------------------------
// /api/v1/complete  (Edge, streaming SSE)
// ---------------------------------------------------------------------------

// The page-extracted context. Each field is optional because adapters extract
// what they can; the prompt builder copes with missing pieces.
export const ContextSchema = z
  .object({
    site: z.string().min(1).max(120).optional(),
    pageTitle: z.string().max(300).optional(),
    pageUrl: z.string().url().max(2048).optional(),

    // For email/threaded conversations: the thread the user is replying to.
    thread: z
      .array(
        z.object({
          author: z.string().max(200).optional(),
          // Stripped HTML; bounded by MAX_CONTEXT_CHARS at the field level.
          text: z.string().max(LIMITS.MAX_CONTEXT_CHARS),
          timestamp: z.string().max(64).optional(),
        }),
      )
      .max(40)
      .optional(),

    // For posts/comments: a single piece of content to respond to.
    post: z
      .object({
        author: z.string().max(200).optional(),
        text: z.string().max(LIMITS.MAX_CONTEXT_CHARS),
      })
      .optional(),

    // For grammar/rewrite: what the user has typed so far.
    draft: z.string().max(LIMITS.MAX_DRAFT_CHARS).optional(),

    // Misc page context (subject line, channel name, etc.). Free-form bag, but
    // the server caps each value before forwarding.
    meta: z.record(z.string().max(500)).optional(),
  })
  .strict();

export type RequestContext = z.infer<typeof ContextSchema>;

// Optional personalization. The extension stores this locally (in
// chrome.storage.local) and attaches it to the request — there is no
// server-side account or database. The backend uses it only to shape the
// prompt; it is never persisted.
export const RequestProfileSchema = z
  .object({
    displayName: z.string().max(120).optional(),
    aboutMe: z.string().max(2000).optional(),
  })
  .strict();

export type RequestProfile = z.infer<typeof RequestProfileSchema>;

export const CompleteRequestSchema = z
  .object({
    action: z.enum(ACTIONS),
    context: ContextSchema,
    tone: z.enum(TONE_PRESETS).optional(),
    instruction: z.string().max(LIMITS.MAX_INSTRUCTION_CHARS).optional(),
    model: z.enum(MODEL_IDS).optional(),
    // Language controls (see ./languages).
    //   sourceLanguage — the language of the input. "auto" (or omitted)
    //     lets the model detect it; a concrete id is treated as a hint.
    //   targetLanguage — the desired output language. Required for the
    //     "translate" action; optional elsewhere (omitted = match source).
    //   bilingual — produce the response in BOTH the source and target
    //     languages (only meaningful for "reply" / "rewrite").
    sourceLanguage: z.enum(SOURCE_LANGUAGE_IDS).optional(),
    targetLanguage: z.enum(LANGUAGE_IDS).optional(),
    bilingual: z.boolean().optional(),
    // Client-supplied personalization, sourced from local extension storage.
    profile: RequestProfileSchema.optional(),
    // Client-generated request id, echoed in metadata logs.
    clientRequestId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (val) => {
      const hasDraft = !!(val.context.draft && val.context.draft.length > 0);
      const hasInstruction = !!(val.instruction && val.instruction.trim().length > 0);
      const hasPageContext = !!(val.context.thread?.length || val.context.post);

      if (val.action === "grammar") {
        // Grammar fixes a piece of text — it's meaningless without a draft.
        return hasDraft;
      }
      if (val.action === "translate") {
        // Translate needs text to translate and a language to translate into.
        return (hasDraft || hasPageContext) && !!val.targetLanguage;
      }
      if (val.action === "rewrite") {
        // Rewrite is broader than its name: it's also the "compose from
        // description" path. Accept any of:
        //   - a draft to transform (classic rewrite),
        //   - an instruction telling us what to write (compose),
        //   - page context to draw from (e.g., "summarize this thread").
        return hasDraft || hasInstruction || hasPageContext;
      }
      // reply
      return hasPageContext;
    },
    {
      message:
        "Action requires content to work with: 'reply' needs thread/post, " +
        "'grammar' needs a draft, 'translate' needs text plus a target " +
        "language, 'rewrite' needs at least one of draft, instruction, or " +
        "page context.",
      path: ["context"],
    },
  );

export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;

// SSE payloads — what we emit to the extension on the wire.
export const SseTokenPayloadSchema = z.object({
  delta: z.string(),
});
export type SseTokenPayload = z.infer<typeof SseTokenPayloadSchema>;

export const SseUsagePayloadSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  model: z.string(),
});
export type SseUsagePayload = z.infer<typeof SseUsagePayloadSchema>;

export const SseErrorPayloadSchema = z.object({
  code: z.nativeEnum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
});
export type SseErrorPayload = z.infer<typeof SseErrorPayloadSchema>;

// ---------------------------------------------------------------------------
// Local extension settings (stored in chrome.storage.local — never sent to
// the backend except for the `profile` subset attached to /complete).
// ---------------------------------------------------------------------------

export const LocalSettingsSchema = z
  .object({
    displayName: z.string().max(120),
    aboutMe: z.string().max(2000),
    defaultTone: z.enum(TONE_PRESETS),
    defaultModel: z.enum(MODEL_IDS),
    // Multilingual preferences. `workingLanguage` is the agent's preferred
    // language for drafting and the second language in bilingual replies;
    // `frequentLanguages` are surfaced first in the popover's language
    // pickers so common target languages are one click away.
    workingLanguage: z.enum(LANGUAGE_IDS),
    frequentLanguages: z.array(z.enum(LANGUAGE_IDS)).max(20),
    siteAllowlist: z.array(z.string().min(1).max(200)).max(200),
    siteBlocklist: z.array(z.string().min(1).max(200)).max(200),
    // Backend the extension talks to. Defaults to the build-time
    // VITE_BACKEND_URL but is user-configurable at runtime, so the
    // extension can be pointed at any compatible backend (see
    // docs/how-to/use-your-own-backend.md). No trailing slash.
    backendUrl: z.string().url(),
    // Optional credential for the user's own backend, sent as
    // `Authorization: Bearer <apiKey>`. Empty = no header (the default
    // Inkwell backend needs none).
    apiKey: z.string().max(500),
  })
  .strict();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

// ---------------------------------------------------------------------------
// /api/v1/ocr  (Node, JSON in/out, non-streaming)
//
// The image is sent as base64 so the wire payload is JSON-only (matches the
// /complete contract). MIME type tells the vision model how to decode it.
// The endpoint is anonymous and rate-limited by client IP, like /complete.
// ---------------------------------------------------------------------------

// Allowed image MIME types. Whitelisted rather than open-ended so a
// malicious client can't smuggle SVG (XSS surface in some renderers) or
// arbitrary binary blobs through the endpoint.
export const OCR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type OcrMimeType = (typeof OCR_MIME_TYPES)[number];

export const OcrRequestSchema = z
  .object({
    /** Standard base64 (no `data:` prefix), max ~10 MB encoded. */
    imageBase64: z
      .string()
      .min(64, "Image data is too small to be a real image.")
      .max(
        Math.ceil((LIMITS.MAX_OCR_IMAGE_BYTES * 4) / 3) + 32,
        "Image data exceeds the OCR size limit.",
      )
      .regex(/^[A-Za-z0-9+/=\s]+$/, "Image data must be base64."),
    mimeType: z.enum(OCR_MIME_TYPES),
  })
  .strict();
export type OcrRequest = z.infer<typeof OcrRequestSchema>;

export const OcrResponseSchema = z
  .object({
    text: z.string(),
    /** Model id that produced the response; useful for debugging tier
     *  drift between deployments. Absent in mock responses. */
    model: z.string().optional(),
  })
  .strict();
export type OcrResponse = z.infer<typeof OcrResponseSchema>;

// ---------------------------------------------------------------------------
// /api/v1/health
// ---------------------------------------------------------------------------

export const HealthSchema = z
  .object({
    ok: z.literal(true),
    version: z.string(),
    runtime: z.string(),
    timestamp: z.string(),
  })
  .strict();

export type Health = z.infer<typeof HealthSchema>;
