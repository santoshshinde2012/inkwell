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

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..domain.errors import ApiError, ErrorCode, api_error
from ..domain.limits import MAX_OCR_REQUEST_BYTES
from ..domain.models import DEFAULT_MODEL_ID
from ..domain.prompts import OCR_SYSTEM_PROMPT, OCR_USER_PROMPT
from ..domain.schemas import OcrRequest, OcrResponse, SseErrorPayload
from ..domain.sse import (
    HEARTBEAT_INTERVAL_S,
    done_event,
    error_event,
    heartbeat_event,
    token_event,
)
from ..providers import get_provider_for_model
from ..providers.base import VisionArgs
from ..settings import get_settings
from .audit import OcrLogEvent, log_ocr
from .ocr_cache import make_cache_key, ocr_result_cache
from .rate_limit import check_rate_limit

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

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
    """Run pre-flight checks; on success delegate to the provider.

    Always emits exactly one ``log.ocr`` audit line — successful,
    cached, validation-failed, rate-limited, aborted, or upstream
    error all surface as a single structured event so operators can
    slice latency / error / cache-hit-rate without correlating
    multiple lines.
    """
    settings = get_settings()
    started_at = time.monotonic()
    model = settings.default_model or DEFAULT_MODEL_ID

    def _audit(
        *,
        status: int,
        response_chars: int | None = None,
        cache_hit: bool = False,
        error_code: str | None = None,
    ) -> None:
        via_portkey: bool | None = settings.portkey_enabled if settings.has_openai else None
        log_ocr(
            OcrLogEvent(
                client_key=input_.client_key,
                model=model,
                request_bytes=input_.content_bytes,
                duration_ms=int((time.monotonic() - started_at) * 1_000),
                status=status,
                response_chars=response_chars,
                cache_hit=cache_hit,
                streamed=False,
                error_code=error_code,
                client_request_id=input_.request_id,
                via_portkey=via_portkey,
            )
        )

    size_err = _enforce_size(input_.content_bytes)
    if size_err:
        _audit(status=413, error_code=ErrorCode.PAYLOAD_TOO_LARGE.value)
        return size_err

    verdict = check_rate_limit(input_.client_key)
    if not verdict.success:
        # `reset_ms` is a wall-clock absolute timestamp; convert to a
        # delta-from-now for the wire so the client doesn't have to
        # know about our clock. The route divides by 1000 for the
        # RFC-9110-shaped `Retry-After` header (seconds).
        delta_ms = max(0, verdict.reset_ms - int(time.time() * 1_000))
        _audit(status=429, error_code=ErrorCode.RATE_LIMITED.value)
        return api_error(
            ErrorCode.RATE_LIMITED,
            "Too many requests — try again in a moment.",
            {"retryAfterMs": delta_ms},
        )

    if await input_.is_disconnected():
        _audit(status=499, error_code=ErrorCode.STREAM_ABORTED.value)
        return api_error(ErrorCode.STREAM_ABORTED, "Client closed the request.")

    provider = get_provider_for_model(model)

    # Canonicalise base64 once — the provider gets the stripped form on
    # the wire, and the cache key is computed from the same bytes so a
    # hit and a miss agree on what "the same image" means.
    canonical_b64 = "".join(input_.request.image_base64.split())
    cache_key = make_cache_key(model, canonical_b64)

    cached = ocr_result_cache.get(cache_key)
    if cached is not None:
        # Cache hit — skip the upstream call entirely. Rate limiting
        # has already run above, so this still respects per-IP caps.
        _audit(status=200, response_chars=len(cached.text), cache_hit=True)
        return cached

    args = VisionArgs(
        model=model,
        system=OCR_SYSTEM_PROMPT,
        user=OCR_USER_PROMPT,
        image_base64=canonical_b64,
        mime_type=input_.request.mime_type,
        trace_id=input_.request_id,
    )

    try:
        result = await provider.recognize_text(args)
    except Exception:
        if await input_.is_disconnected():
            _audit(status=499, error_code=ErrorCode.STREAM_ABORTED.value)
            return api_error(ErrorCode.STREAM_ABORTED, "Client closed the request.")
        _logger.exception("OCR upstream error")
        _audit(status=502, error_code=ErrorCode.UPSTREAM_ERROR.value)
        return api_error(
            ErrorCode.UPSTREAM_ERROR,
            "The OCR model failed to respond. Try again, or use a smaller image.",
        )

    response = OcrResponse(text=result.text, model=result.model)
    # Only cache non-empty results. An empty extraction is usually a
    # transient model issue (or a genuinely text-free image the user
    # might retry on a re-encoded copy), and caching it would lock in
    # the bad answer for the TTL window.
    if result.text:
        ocr_result_cache.put(cache_key, response)
    _audit(status=200, response_chars=len(result.text))
    return response


# ---------------------------------------------------------------------------
# Streaming variant — SSE deltas for the side panel's progressive UX
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class OcrStream:
    """Successful streaming-pipeline output: an SSE byte iterator.

    The route hands this to ``StreamingResponse`` directly; pre-flight
    errors are returned as ``ApiError`` instead.
    """

    chunks: AsyncIterator[bytes]


OcrStreamResult = OcrStream | ApiError


def run_ocr_stream(input_: OcrInput) -> OcrStreamResult:
    """Pre-flight checks; on success return an SSE byte stream.

    Mirrors :func:`run_completion`'s contract: synchronous wrapper that
    either returns an immediately-serialisable error or a streaming
    iterator the route turns into an SSE response.

    Streaming benefits OCR by making the first characters visible the
    moment the model emits them rather than after the whole image is
    transcribed — for dense screenshots, that's seconds of perceived
    latency removed.

    Pre-flight failures audit-log here; the stream's success / mid-flight
    outcomes audit-log in :func:`_ocr_event_stream`'s finally block.
    """
    settings = get_settings()
    model = settings.default_model or DEFAULT_MODEL_ID
    via_portkey: bool | None = settings.portkey_enabled if settings.has_openai else None

    size_err = _enforce_size(input_.content_bytes)
    if size_err:
        log_ocr(
            OcrLogEvent(
                client_key=input_.client_key,
                model=model,
                request_bytes=input_.content_bytes,
                duration_ms=0,
                status=413,
                streamed=True,
                error_code=ErrorCode.PAYLOAD_TOO_LARGE.value,
                client_request_id=input_.request_id,
                via_portkey=via_portkey,
            )
        )
        return size_err

    verdict = check_rate_limit(input_.client_key)
    if not verdict.success:
        delta_ms = max(0, verdict.reset_ms - int(time.time() * 1_000))
        log_ocr(
            OcrLogEvent(
                client_key=input_.client_key,
                model=model,
                request_bytes=input_.content_bytes,
                duration_ms=0,
                status=429,
                streamed=True,
                error_code=ErrorCode.RATE_LIMITED.value,
                client_request_id=input_.request_id,
                via_portkey=via_portkey,
            )
        )
        return api_error(
            ErrorCode.RATE_LIMITED,
            "Too many requests — try again in a moment.",
            {"retryAfterMs": delta_ms},
        )

    return OcrStream(chunks=_ocr_event_stream(input_))


async def _ocr_event_stream(input_: OcrInput) -> AsyncIterator[bytes]:
    """Async generator yielding SSE bytes end-to-end.

    Cache hits surface as a single ``token`` event with the full text
    followed by ``done`` — the client's incremental parser handles the
    one-shot the same as the streaming path. Cache misses stream
    deltas from the provider, accumulate them, and write the result to
    the cache on a clean finish.

    Errors collapse into a single ``error`` SSE frame; the route never
    sees an exception escape. Every terminal outcome (success / abort /
    error / cache hit) records exactly one ``log.ocr`` audit line via
    the ``finally`` block so operators see the same shape regardless
    of which branch taken.
    """
    settings = get_settings()
    started_at = time.monotonic()
    model = settings.default_model or DEFAULT_MODEL_ID
    provider = get_provider_for_model(model)

    canonical_b64 = "".join(input_.request.image_base64.split())
    cache_key = make_cache_key(model, canonical_b64)

    # Mutable outcome state — set by whichever branch actually
    # terminates, then logged in `finally` so we never double-log nor
    # skip-log.
    audit_status = 500
    audit_chars: int | None = None
    audit_cache_hit = False
    audit_error_code: str | None = None
    provider_stream = None

    try:
        # Cache hit fast-path. The Accept: text/event-stream client
        # gets the same wire shape as a miss so its parser doesn't
        # branch on cache state.
        cached = ocr_result_cache.get(cache_key)
        if cached is not None:
            if cached.text:
                yield token_event({"delta": cached.text})
            yield done_event()
            audit_status = 200
            audit_chars = len(cached.text)
            audit_cache_hit = True
            return

        args = VisionArgs(
            model=model,
            system=OCR_SYSTEM_PROMPT,
            user=OCR_USER_PROMPT,
            image_base64=canonical_b64,
            mime_type=input_.request.mime_type,
            trace_id=input_.request_id,
        )

        provider_stream = provider.stream_recognize_text(args)
        accumulated: list[str] = []
        last_yield_at = time.monotonic()
        aborted = False

        _HEARTBEAT = object()

        async def _next_delta() -> str | object:
            timeout = max(0.1, HEARTBEAT_INTERVAL_S - (time.monotonic() - last_yield_at))
            try:
                return await asyncio.wait_for(provider_stream.__anext__(), timeout=timeout)
            except TimeoutError:
                return _HEARTBEAT

        try:
            while True:
                if await input_.is_disconnected():
                    aborted = True
                    break
                try:
                    result = await _next_delta()
                except StopAsyncIteration:
                    break
                if result is _HEARTBEAT:
                    yield heartbeat_event()
                    last_yield_at = time.monotonic()
                    continue
                assert isinstance(result, str)
                if result:
                    accumulated.append(result)
                    yield token_event({"delta": result})
                    last_yield_at = time.monotonic()

            if aborted:
                yield error_event(
                    SseErrorPayload(
                        code=ErrorCode.STREAM_ABORTED.value,
                        message="Stream aborted",
                        retryable=True,
                    ).model_dump()
                )
                audit_status = 499
                audit_error_code = ErrorCode.STREAM_ABORTED.value
                return

            # Success — write through to the cache so a repeat call
            # returns instantly without re-billing the upstream. Empty
            # extractions are not cached for the same reason as the
            # JSON path.
            full_text = "".join(accumulated).strip()
            if full_text:
                ocr_result_cache.put(
                    cache_key,
                    OcrResponse(text=full_text, model=model),
                )
            yield done_event()
            audit_status = 200
            audit_chars = len(full_text)

        except Exception:
            _logger.exception("OCR stream upstream error")
            yield error_event(
                SseErrorPayload(
                    code=ErrorCode.UPSTREAM_ERROR.value,
                    message="The OCR model failed to respond. Try again, or use a smaller image.",
                    retryable=True,
                ).model_dump()
            )
            audit_status = 502
            audit_error_code = ErrorCode.UPSTREAM_ERROR.value
    finally:
        # Best-effort cleanup of the provider's HTTP connection so
        # cancellations don't leak upstream sockets.
        if provider_stream is not None:
            aclose = getattr(provider_stream, "aclose", None)
            if aclose is not None:
                with contextlib.suppress(Exception):
                    await aclose()
        via_portkey: bool | None = settings.portkey_enabled if settings.has_openai else None
        log_ocr(
            OcrLogEvent(
                client_key=input_.client_key,
                model=model,
                request_bytes=input_.content_bytes,
                duration_ms=int((time.monotonic() - started_at) * 1_000),
                status=audit_status,
                response_chars=audit_chars,
                cache_hit=audit_cache_hit,
                streamed=True,
                error_code=audit_error_code,
                client_request_id=input_.request_id,
                via_portkey=via_portkey,
            )
        )
