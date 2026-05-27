"""HTTP response helpers.

Single source of truth for how JSON / SSE responses are framed, so
every route emits the same shape and headers.
"""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

from ..domain.errors import ApiError, status_for_code
from .cors import build_cors_headers


def json_ok(body: Any, origin: str | None, status_code: int = 200) -> JSONResponse:
    """200 (or other 2xx) JSON response with CORS headers attached."""
    return JSONResponse(
        content=body,
        status_code=status_code,
        headers=build_cors_headers(origin),
    )


def json_error(
    error: ApiError,
    origin: str | None,
    status_code: int | None = None,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Error JSON response. Status is derived from the error code unless
    overridden explicitly. ``extra_headers`` lets callers attach things
    like ``Retry-After`` on rate-limit responses without bypassing the
    CORS header path."""
    headers = build_cors_headers(origin)
    if extra_headers:
        headers.update(extra_headers)
    return JSONResponse(
        content={"error": error.model_dump(mode="json", exclude_none=True)},
        status_code=status_code if status_code is not None else status_for_code(error.code),
        headers=headers,
    )


def sse_headers(origin: str | None) -> dict[str, str]:
    """Headers for a long-lived SSE stream."""
    headers: dict[str, str] = {
        **build_cors_headers(origin),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        # Disable proxy buffering. Nginx in front of self-hosted setups
        # respects this header; modern serverless edges already stream
        # without buffering.
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return headers
