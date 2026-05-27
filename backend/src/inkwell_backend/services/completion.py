"""Completion pipeline — pure domain orchestration.

Extracted from the route handler so the HTTP layer stays thin and this
file is unit-testable without a TestClient. Flow::

    enforce_size → validate → rate_limit(IP)
                                       ↓
            sanitize → detect_injection → build_prompt
                                       ↓
                          stream_model → emit_sse → log_completion
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..domain.errors import ApiError, ErrorCode, api_error
from ..domain.limits import MAX_REQUEST_BYTES
from ..domain.models import DEFAULT_MODEL_ID
from ..domain.schemas import CompleteRequest, SseErrorPayload, SseUsagePayload
from ..domain.sse import (
    HEARTBEAT_INTERVAL_S,
    done_event,
    error_event,
    heartbeat_event,
    token_event,
    usage_event,
)
from ..providers import ProviderCompletionArgs, get_provider_for_model
from ..providers.base import CompletionChunk
from ..settings import get_settings
from .audit import CompletionLogEvent, log_completion
from .prompt import build_prompt
from .rate_limit import check_rate_limit
from .sanitizer import detect_suspicious, sanitize_context

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

_logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class CompletionInput:
    """Inputs to :func:`run_completion`."""

    client_key: str
    """IP-derived rate-limit key — NOT a user account."""

    request: CompleteRequest
    """Pre-validated request body."""

    content_bytes: int
    """Raw request size, pre-parse."""

    is_disconnected: Callable[[], Awaitable[bool]]
    """Coroutine returning True when the client has hung up.

    The caller wires this to ``Request.is_disconnected`` from FastAPI;
    the pipeline polls it between chunks so disconnects free upstream
    resources promptly.
    """

    request_id: str | None = None
    """Optional client-supplied correlation id from
    ``X-Client-Request-Id``. Used only for the audit log line."""


@dataclass(frozen=True, slots=True)
class CompletionStream:
    """Successful pipeline output: an SSE byte stream."""

    chunks: AsyncIterator[bytes]


CompletionResult = CompletionStream | ApiError


# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------


def _enforce_size(bytes_: int) -> ApiError | None:
    if bytes_ > MAX_REQUEST_BYTES:
        return api_error(
            ErrorCode.PAYLOAD_TOO_LARGE,
            f"Request body exceeds {MAX_REQUEST_BYTES} bytes",
        )
    return None


def _enforce_rate_limit(client_key: str) -> ApiError | None:
    verdict = check_rate_limit(client_key)
    if verdict.success:
        return None
    # `verdict.reset_ms` is a wall-clock absolute timestamp; the wire
    # field is a *delta* in ms so the client doesn't have to know about
    # our clock. The route layer divides by 1000 for the `Retry-After`
    # header (RFC 9110 wants seconds).
    delta_ms = max(0, verdict.reset_ms - int(time.time() * 1_000))
    return api_error(
        ErrorCode.RATE_LIMITED,
        "Too many requests; please wait.",
        {"retryAfterMs": delta_ms},
    )


def _enforce_injection(request: CompleteRequest) -> ApiError | None:
    reason = detect_suspicious(request.context)
    if not reason:
        return None
    return api_error(
        ErrorCode.FORBIDDEN,
        "Refused: page content appeared to contain prompt injection.",
        {"reason": reason},
    )


# ---------------------------------------------------------------------------
# Stream construction
# ---------------------------------------------------------------------------


async def _stream(input_: CompletionInput) -> AsyncIterator[bytes]:
    """Async generator that yields encoded SSE events end-to-end.

    The function holds no shared state — every per-request value lives
    in locals. Errors from the provider become a single ``error`` SSE
    event followed by termination; the route handler never sees
    exceptions, only bytes.

    Emits a ``: keep-alive`` comment frame every
    :data:`HEARTBEAT_INTERVAL_S` seconds the model is silent, so
    intermediary proxies with idle-connection timeouts don't reap the
    stream mid-generation.
    """
    settings = get_settings()
    started_at = time.monotonic()
    last_yield_at = started_at
    request = input_.request

    model = request.model or settings.default_model or DEFAULT_MODEL_ID
    provider = get_provider_for_model(model)
    prompt = build_prompt(request)

    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    model_used = model
    error_code: str | None = None

    provider_stream = provider.stream_completion(
        ProviderCompletionArgs(model=model, system=prompt.system, user=prompt.user)
    )

    # Sentinel used to distinguish "no chunk arrived before the
    # heartbeat deadline" from a real chunk. Avoids tagged tuples
    # and the type-ignores that come with them.
    _HEARTBEAT = object()

    async def _next_chunk() -> CompletionChunk | object:
        timeout = max(0.1, HEARTBEAT_INTERVAL_S - (time.monotonic() - last_yield_at))
        try:
            return await asyncio.wait_for(provider_stream.__anext__(), timeout=timeout)
        except TimeoutError:
            return _HEARTBEAT

    try:
        while True:
            # Cheap polling — `is_disconnected` is non-blocking and
            # returns True the moment the ASGI server sees a TCP RST /
            # half-close. Saves real money on long generations.
            if await input_.is_disconnected():
                error_code = ErrorCode.STREAM_ABORTED.value
                break

            try:
                result = await _next_chunk()
            except StopAsyncIteration:
                break

            if result is _HEARTBEAT:
                yield heartbeat_event()
                last_yield_at = time.monotonic()
                continue

            assert isinstance(result, CompletionChunk)  # narrow for mypy
            if result.delta:
                yield token_event({"delta": result.delta})
                last_yield_at = time.monotonic()
            if result.usage:
                prompt_tokens = result.usage.prompt_tokens
                completion_tokens = result.usage.completion_tokens
                total_tokens = result.usage.total_tokens
                model_used = result.usage.model
                usage_payload = SseUsagePayload(
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    model=model_used,
                )
                yield usage_event(usage_payload.model_dump(by_alias=True))
                last_yield_at = time.monotonic()

        if error_code:
            yield error_event(
                SseErrorPayload(
                    code=ErrorCode.STREAM_ABORTED.value,
                    message="Stream aborted",
                    retryable=True,
                ).model_dump()
            )
        else:
            yield done_event()
    except Exception:
        # Hide upstream details from the client — server log only.
        _logger.exception("provider stream failed", extra={"model": model})
        error_code = ErrorCode.UPSTREAM_ERROR.value
        yield error_event(
            SseErrorPayload(
                code=error_code,
                message="Upstream model error",
                retryable=True,
            ).model_dump()
        )
        # Intentionally not re-raised — the SSE stream has delivered a
        # useful error event and is now finished.
    finally:
        # Free upstream resources even on early break / cancellation.
        # Best-effort: an aclose() that itself fails is unrecoverable
        # from this layer, and shouldn't suppress the audit log below.
        aclose = getattr(provider_stream, "aclose", None)
        if aclose is not None:
            with contextlib.suppress(Exception):
                await aclose()

        log_completion(
            CompletionLogEvent(
                client_key=input_.client_key,
                action=request.action,
                model=model_used,
                source_language=request.source_language,
                target_language=request.target_language,
                prompt_tokens=prompt_tokens or None,
                completion_tokens=completion_tokens or None,
                total_tokens=total_tokens or None,
                request_bytes=input_.content_bytes,
                duration_ms=int((time.monotonic() - started_at) * 1_000),
                status=500 if error_code else 200,
                error_code=error_code,
                # Prefer the header-sourced request id (one canonical
                # value for cross-layer correlation), fall back to
                # the in-body field if the client only set that one.
                client_request_id=input_.request_id or request.client_request_id,
            )
        )


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------


def run_completion(input_: CompletionInput) -> CompletionResult:
    """Run pre-flight checks; on success return an SSE byte stream.

    The function is sync — only the returned stream is async. That
    matches the Node implementation and keeps the route handler simple:
    ``run_completion(...)`` either returns an ApiError it can serialize
    immediately, or a ``StreamingResponse``-compatible iterator.
    """
    size_err = _enforce_size(input_.content_bytes)
    if size_err:
        return size_err

    # Rate-limit BEFORE we sanitize / build prompt / touch the provider.
    rate_err = _enforce_rate_limit(input_.client_key)
    if rate_err:
        return rate_err

    # Mutate the request context with sanitized copies. The Pydantic
    # model is immutable by default, so use model_copy.
    sanitized = sanitize_context(input_.request.context)
    final_request = input_.request.model_copy(update={"context": sanitized})

    injection_err = _enforce_injection(final_request)
    if injection_err:
        return injection_err

    return CompletionStream(
        chunks=_stream(
            CompletionInput(
                client_key=input_.client_key,
                request=final_request,
                content_bytes=input_.content_bytes,
                is_disconnected=input_.is_disconnected,
                request_id=input_.request_id,
            )
        )
    )
