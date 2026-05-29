// Hard limits enforced on both ends. Single source of truth — keep clients and
// servers honest about what they will accept and produce.

export const LIMITS = {
  // Maximum size, in bytes, of the JSON body sent to /api/v1/complete.
  // Keeps prompt cost bounded and reduces DoS surface.
  MAX_REQUEST_BYTES: 32 * 1024,

  // Maximum length of the page-extracted context after sanitization.
  MAX_CONTEXT_CHARS: 8000,

  // Maximum length of the user's freeform instruction.
  MAX_INSTRUCTION_CHARS: 1000,

  // Maximum length of the user's "draft so far" (for grammar/rewrite).
  MAX_DRAFT_CHARS: 8000,

  // Maximum response tokens we'll request from the model.
  MAX_RESPONSE_TOKENS: 1024,

  // Maximum size, in bytes, of an /api/v1/ocr JSON body. The image is
  // sent as base64, which inflates raw bytes by ~4/3, so 12 MB carries
  // the 8 MB raw-image cap below. Bigger requests are rejected at the
  // boundary before parse.
  MAX_OCR_REQUEST_BYTES: 12 * 1024 * 1024,

  // Maximum decoded image size the OCR endpoint will hand to the
  // vision model. Mirrors the cap the client enforces *after* the
  // pre-upload preprocessing pass (decode → EXIF-rotate → downscale →
  // re-encode JPEG). Practically nothing the user uploads ends up
  // larger than this once preprocessed.
  MAX_OCR_IMAGE_BYTES: 8 * 1024 * 1024,

  // Maximum size, in bytes, of the *raw* blob the side panel accepts
  // before preprocessing. Phone photos and 4K screenshots routinely
  // exceed the post-encode 8 MB cap above; the preprocessor scales them
  // down to fit. This bound exists only to keep a wildly oversized file
  // from blowing up memory during decode.
  MAX_OCR_INPUT_BYTES: 32 * 1024 * 1024,
} as const;

// Model identifiers, the model catalog, and provider types live in ./models.

export const SSE = {
  // Custom event names used in our SSE stream. Generic `message` events carry
  // model tokens; named events carry control signals.
  EVENT_TOKEN: "token",
  EVENT_DONE: "done",
  EVENT_ERROR: "error",
  EVENT_USAGE: "usage",
} as const;
