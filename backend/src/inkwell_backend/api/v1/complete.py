"""POST /api/v1/complete — SSE-streamed chat completion.

The route handler is intentionally tiny: read headers, parse the body,
hand off to :func:`run_completion`, return either a JSON error or a
StreamingResponse wrapping the pipeline's SSE byte iterator.

All real logic lives in :mod:`inkwell_backend.services.completion`.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from ...domain.errors import ApiError, ErrorCode, api_error
from ...domain.limits import MAX_REQUEST_BYTES
from ...domain.schemas import CompleteRequest
from ...services.completion import (
    CompletionInput,
    CompletionStream,
    run_completion,
)
from ..deps import client_ip, client_request_id, origin_header
from ..responses import json_error, sse_headers

_logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/complete",
    summary="Streaming chat completion",
    response_class=StreamingResponse,
    # Disable the generated response model — the handler returns either
    # a streaming SSE body or a JSON error, neither of which fit a
    # single Pydantic shape. Errors are documented in `responses=`.
    response_model=None,
    responses={
        200: {"content": {"text/event-stream": {}}},
        400: {"description": "Validation failed", "model": ApiError},
        413: {"description": "Request body too large", "model": ApiError},
        429: {"description": "Rate limited", "model": ApiError},
    },
    tags=["completion"],
)
async def complete(
    request: Request,
    origin: str | None = Depends(origin_header),
    ip: str = Depends(client_ip),
    request_id: str | None = Depends(client_request_id),
) -> StreamingResponse | JSONResponse:
    content_bytes = int(request.headers.get("content-length") or 0)

    # Short-circuit grossly oversized bodies before parsing — we don't
    # want to materialise a 50 MB payload in memory just to validate it.
    # The pipeline also enforces the cap on the parsed body; this just
    # saves the allocation. Mirrors the OCR route.
    if content_bytes > MAX_REQUEST_BYTES:
        return json_error(
            api_error(
                ErrorCode.PAYLOAD_TOO_LARGE,
                f"Request body exceeds {MAX_REQUEST_BYTES} bytes",
            ),
            origin,
        )

    try:
        raw = await request.body()
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return json_error(
            api_error(ErrorCode.VALIDATION_FAILED, "Body is not valid JSON"),
            origin,
        )

    try:
        parsed = CompleteRequest.model_validate(payload)
    except ValidationError as err:
        # ``err.errors()`` includes ``ctx`` / ``input`` keys whose values
        # may be live Python exceptions or arbitrary user objects — not
        # JSON-serialisable. Strip to the safe fields the client cares
        # about so the response body is always a clean JSON document.
        issues = [
            {
                "loc": list(issue.get("loc", ())),
                "msg": issue.get("msg", ""),
                "type": issue.get("type", ""),
            }
            for issue in err.errors(include_url=False, include_input=False, include_context=False)
        ]
        return json_error(
            api_error(
                ErrorCode.VALIDATION_FAILED,
                "Request did not match schema",
                {"issues": issues},
            ),
            origin,
        )

    try:
        result = run_completion(
            CompletionInput(
                client_key=ip,
                request=parsed,
                content_bytes=content_bytes,
                is_disconnected=request.is_disconnected,
                request_id=request_id,
            )
        )
    except Exception:
        # The pipeline's pre-flight steps are pure and shouldn't raise,
        # but if a future refactor introduces a code path that does,
        # surface a clean ApiError with CORS headers attached instead
        # of a bare 500. The streamed `_stream` body handles its own
        # exceptions separately and emits an SSE `error` event.
        _logger.exception("complete pipeline failed", extra={"request_id": request_id})
        return json_error(
            api_error(ErrorCode.INTERNAL_ERROR, "Internal error"),
            origin,
        )

    if isinstance(result, CompletionStream):
        return StreamingResponse(
            result.chunks,
            status_code=200,
            headers=sse_headers(origin),
            media_type="text/event-stream",
        )
    return _json_error_with_retry_after(result, origin)


def _json_error_with_retry_after(error: ApiError, origin: str | None) -> JSONResponse:
    """Attach a ``Retry-After`` header on RATE_LIMITED responses, derived
    from the ``retryAfterMs`` field the pipeline includes in
    ``details``. The header is in *seconds* per RFC 9110."""
    extra: dict[str, str] = {}
    if error.code == ErrorCode.RATE_LIMITED and error.details:
        ms = error.details.get("retryAfterMs")
        if isinstance(ms, int) and ms > 0:
            extra["Retry-After"] = str(max(1, ms // 1000))
    return json_error(error, origin, extra_headers=extra or None)
