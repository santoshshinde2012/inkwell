"""Hard request/response limits enforced on both ends.

Single source of truth for the wire-level caps. Mirrors
`@inkwell/shared/constants`.
"""

from __future__ import annotations

from typing import Final

# Maximum size, in bytes, of the JSON body sent to /api/v1/complete.
# Keeps prompt cost bounded and reduces DoS surface.
MAX_REQUEST_BYTES: Final[int] = 32 * 1024

# Maximum length of the page-extracted context after sanitization.
MAX_CONTEXT_CHARS: Final[int] = 8_000

# Maximum length of the user's freeform instruction.
MAX_INSTRUCTION_CHARS: Final[int] = 1_000

# Maximum length of the user's "draft so far" (for grammar/rewrite).
MAX_DRAFT_CHARS: Final[int] = 8_000

# Conversational refinement ("make it shorter", "warmer", …). The client
# replays prior turns so the model can revise its own previous output.
# Both caps are deliberately tight: refinement is a short back-and-forth,
# not an unbounded chat log, and the whole payload still has to fit under
# MAX_REQUEST_BYTES.
MAX_HISTORY_TURNS: Final[int] = 12
MAX_HISTORY_TURN_CHARS: Final[int] = 8_000

# Maximum response tokens we'll request from the model.
MAX_RESPONSE_TOKENS: Final[int] = 1_024

# Maximum response tokens for OCR — dense screenshots can carry more
# legible text than a typical reply, so give them more headroom.
MAX_OCR_RESPONSE_TOKENS: Final[int] = 2_048

# Maximum size, in bytes, of the JSON body sent to /api/v1/ocr. Images
# are sent as base64, which inflates raw bytes by ~4/3, so 12 MB lets
# us accept the same ~8 MB raw images the side panel enforces.
MAX_OCR_REQUEST_BYTES: Final[int] = 12 * 1024 * 1024

# Maximum decoded image size the OCR endpoint will pass to the vision
# model. Mirrors the cap clients enforce client-side.
MAX_OCR_IMAGE_BYTES: Final[int] = 8 * 1024 * 1024

# Maximum length of a model id on the wire. Covers curated catalog ids
# (``gpt-4o-mini``) and Portkey model-catalog slugs
# (``@bedrock-use1/us.anthropic.claude-…``). Mirrors
# ``LIMITS.MAX_MODEL_ID_CHARS`` in ``@inkwell/shared/constants``.
MAX_MODEL_ID_CHARS: Final[int] = 200

# SSE event names live in domain/sse.py as a ``Literal`` — they were
# previously duplicated here as a class. The encoder enforces the
# event-name domain at the type-check level now.
