"""OCR pipeline.

Pure domain orchestration for /api/v1/ocr — kept out of the route
handler so HTTP concerns stay thin and this stays unit-testable.

There is no authentication and no database. The request is anonymous
and rate-limited by client IP, the same way /complete is. When
``OPENAI_API_KEY`` is unset, the pipeline returns a deterministic mock
response so local dev needs no secrets.

Flow::

    enforce_size → validate → rate_limit(IP)
                                       ↓
                       openai.vision → return text
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..domain.errors import ApiError, ErrorCode, api_error
from ..domain.limits import MAX_OCR_REQUEST_BYTES, MAX_OCR_RESPONSE_TOKENS
from ..domain.schemas import OcrRequest, OcrResponse
from ..providers.openai_client import get_openai_client
from ..settings import get_settings
from .rate_limit import check_rate_limit

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

_logger = logging.getLogger(__name__)


# Single system prompt for image-to-text. Kept explicit so the model
# returns the recognised text verbatim and doesn't paraphrase, comment,
# or insert a "Here is the text from the image:" preamble.
_OCR_SYSTEM_PROMPT = (
    "You are an OCR engine. Extract every legible piece of text from the "
    "image, including UI labels, code, captions, and small print. Preserve "
    "line breaks where the visual layout suggests separate lines. Output "
    "ONLY the recognised text — no preamble, no explanation, no markdown "
    "formatting, no quoting. If the image contains no readable text, "
    "respond with an empty message."
)


@dataclass(frozen=True, slots=True)
class OcrInput:
    """Inputs to :func:`run_ocr`."""

    client_key: str
    request: OcrRequest
    content_bytes: int
    is_disconnected: Callable[[], Awaitable[bool]]


OcrResult = OcrResponse | ApiError


def _enforce_size(bytes_: int) -> ApiError | None:
    if bytes_ > MAX_OCR_REQUEST_BYTES:
        return api_error(
            ErrorCode.PAYLOAD_TOO_LARGE,
            "Image is too large for OCR — try a smaller screenshot.",
        )
    return None


async def run_ocr(input_: OcrInput) -> OcrResult:
    """Run pre-flight checks; on success call the vision model."""
    settings = get_settings()

    size_err = _enforce_size(input_.content_bytes)
    if size_err:
        return size_err

    verdict = check_rate_limit(input_.client_key)
    if not verdict.success:
        # `reset_ms` is a wall-clock absolute timestamp; convert to a
        # delta-from-now for the wire so the client doesn't have to
        # know about our clock. The route divides by 1000 for the
        # RFC-9110-shaped `Retry-After` header (seconds).
        delta_ms = max(0, verdict.reset_ms - int(time.time() * 1_000))
        return api_error(
            ErrorCode.RATE_LIMITED,
            "Too many requests — try again in a moment.",
            {"retryAfterMs": delta_ms},
        )

    if await input_.is_disconnected():
        return api_error(ErrorCode.STREAM_ABORTED, "Client closed the request.")

    # Mock path keeps local dev usable with no API key.
    if not settings.has_openai:
        return OcrResponse(
            text=(
                "[mock OCR text — set OPENAI_API_KEY in backend/.env to enable real recognition]"
            ),
            model=None,
        )

    client = get_openai_client()
    model = settings.openai_default_model

    cleaned_b64 = "".join(input_.request.image_base64.split())
    data_url = f"data:{input_.request.mime_type};base64,{cleaned_b64}"

    try:
        completion = await client.chat.completions.create(
            model=model,
            # OCR responses can be long for dense screenshots — give them
            # more headroom than the completion path's default.
            max_tokens=MAX_OCR_RESPONSE_TOKENS,
            temperature=0,
            messages=[
                {"role": "system", "content": _OCR_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Recognise the text in this image."},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                    ],
                },
            ],
        )
    except Exception:
        if await input_.is_disconnected():
            return api_error(ErrorCode.STREAM_ABORTED, "Client closed the request.")
        _logger.exception("OCR upstream error")
        return api_error(
            ErrorCode.UPSTREAM_ERROR,
            "The OCR model failed to respond. Try again, or use a smaller image.",
        )

    raw = completion.choices[0].message.content if completion.choices else ""
    text = (raw or "").strip() if isinstance(raw, str) else ""
    return OcrResponse(text=text, model=completion.model or model)
