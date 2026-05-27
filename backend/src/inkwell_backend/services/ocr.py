"""OCR pipeline.

Pure domain orchestration for /api/v1/ocr — kept out of the route
handler so HTTP concerns stay thin and this stays unit-testable.

There is no authentication and no database. The request is anonymous
and rate-limited by client IP, the same way /complete is. When the
configured provider has no credentials, it transparently returns a
deterministic mock response so local dev needs no secrets — this file
no longer knows or cares which vendor is on the other end.

Flow::

    enforce_size → validate → rate_limit(IP)
                                       ↓
                       provider.recognize_text → return text
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..domain.errors import ApiError, ErrorCode, api_error
from ..domain.limits import MAX_OCR_REQUEST_BYTES
from ..domain.models import DEFAULT_MODEL_ID
from ..domain.prompts import OCR_SYSTEM_PROMPT, OCR_USER_PROMPT
from ..domain.schemas import OcrRequest, OcrResponse
from ..providers import get_provider_for_model
from ..providers.base import VisionArgs
from ..settings import get_settings
from .rate_limit import check_rate_limit

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

_logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class OcrInput:
    """Inputs to :func:`run_ocr`."""

    client_key: str
    request: OcrRequest
    content_bytes: int
    is_disconnected: Callable[[], Awaitable[bool]]

    request_id: str | None = None
    """Optional ``X-Client-Request-Id`` header value. Forwarded to the
    provider as a trace id so gateway-side logs (e.g. Portkey) can be
    correlated with our request lifecycle."""


OcrResult = OcrResponse | ApiError


def _enforce_size(bytes_: int) -> ApiError | None:
    if bytes_ > MAX_OCR_REQUEST_BYTES:
        return api_error(
            ErrorCode.PAYLOAD_TOO_LARGE,
            "Image is too large for OCR — try a smaller screenshot.",
        )
    return None


async def run_ocr(input_: OcrInput) -> OcrResult:
    """Run pre-flight checks; on success delegate to the provider."""
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

    model = settings.default_model or DEFAULT_MODEL_ID
    provider = get_provider_for_model(model)

    args = VisionArgs(
        model=model,
        system=OCR_SYSTEM_PROMPT,
        user=OCR_USER_PROMPT,
        # Strip whitespace so the provider doesn't have to worry about
        # the wire format of base64 (newlines etc.).
        image_base64="".join(input_.request.image_base64.split()),
        mime_type=input_.request.mime_type,
        trace_id=input_.request_id,
    )

    try:
        result = await provider.recognize_text(args)
    except Exception:
        if await input_.is_disconnected():
            return api_error(ErrorCode.STREAM_ABORTED, "Client closed the request.")
        _logger.exception("OCR upstream error")
        return api_error(
            ErrorCode.UPSTREAM_ERROR,
            "The OCR model failed to respond. Try again, or use a smaller image.",
        )

    return OcrResponse(text=result.text, model=result.model)
