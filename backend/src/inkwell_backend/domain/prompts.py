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

# Image-to-text. The wording is deliberately rule-shaped so the model
# returns the recognised text verbatim, preserves the document's visual
# structure as Markdown, and never paraphrases or wraps the output in a
# "Here is the text:" preamble.
OCR_SYSTEM_PROMPT: Final[str] = (
    "You are a high-fidelity OCR engine. Extract every piece of visible "
    "text from the image and preserve the document's structure.\n"
    "\n"
    "Rules:\n"
    "- Capture all legible text: titles, body, captions, code, UI labels, "
    "watermarks, footnotes, and small print. Do not skip anything readable.\n"
    "- Reading order is top-to-bottom, left-to-right. For multi-column "
    "layouts, finish one column before starting the next.\n"
    "- Preserve structure with Markdown: tables as GitHub-style pipe "
    "tables; code or terminal output inside ``` fenced blocks with the "
    'original indentation; bulleted lists with "- "; numbered lists with '
    '"1. "; headings with "#" levels when the visual hierarchy is clear.\n'
    "- Join soft-wrapped lines within a paragraph into one line; keep real "
    "line breaks between paragraphs, list items, and distinct blocks.\n"
    "- Keep the source script and original casing — do not transliterate, "
    "translate, or paraphrase. Preserve punctuation and special characters "
    "exactly.\n"
    "- Render math with LaTeX inside $...$ or $$...$$ delimiters.\n"
    "- Output ONLY the recognised text. No preamble, no commentary, no "
    'surrounding quotes, no "Here is the text" phrasing.\n'
    "- If the image contains no readable text, respond with an empty "
    "message."
)

# Sent alongside the image in the user turn — pairs with the OCR system
# prompt above. Kept as a constant so the provider layer never has to
# invent text on its own.
OCR_USER_PROMPT: Final[str] = "Recognise the text in this image."
