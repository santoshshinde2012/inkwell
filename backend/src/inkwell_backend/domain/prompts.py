"""System prompts used across the backend.

Single source of truth for any prompt sent to a model that is NOT
derived from per-request user input. Keeping them here means:

* Wording lives next to the limits / catalogs it pairs with — easy to
  audit when reviewing what we send upstream.
* Providers stay vendor-neutral: every provider receives the same
  prompt strings and only differs in how it wires them onto the wire
  (chat message shapes, content blocks, etc.).
* Tests can import these and assert on prompt content without
  reaching into service modules.
"""

from __future__ import annotations

from typing import Final

# Image-to-text. Kept explicit so the model returns the recognised text
# verbatim and doesn't paraphrase, comment, or insert a "Here is the
# text from the image:" preamble.
OCR_SYSTEM_PROMPT: Final[str] = (
    "You are an OCR engine. Extract every legible piece of text from the "
    "image, including UI labels, code, captions, and small print. Preserve "
    "line breaks where the visual layout suggests separate lines. Output "
    "ONLY the recognised text — no preamble, no explanation, no markdown "
    "formatting, no quoting. If the image contains no readable text, "
    "respond with an empty message."
)

# Sent alongside the image in the user turn — pairs with the OCR system
# prompt above. Kept as a constant so the provider layer never has to
# invent text on its own.
OCR_USER_PROMPT: Final[str] = "Recognise the text in this image."
