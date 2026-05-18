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
