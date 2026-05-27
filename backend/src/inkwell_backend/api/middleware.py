"""ASGI middleware — CORS lockdown for /api/v1/*.

The middleware's only jobs are CORS + the "must have Origin on writes"
contract:

1. Answer OPTIONS preflights without invoking route logic.
2. Reject requests whose Origin isn't allowed (extension id, same-
   origin, or a dev loopback).
3. Reject non-GET requests that arrive without any Origin — those
   come from non-browser clients (curl from a server, malicious
   scripts) trying to replay our cost-incurring POST routes anonymously.
   ``is_origin_allowed(None)`` is intentionally permissive so that
   health probes and read-only diagnostics still work; here we just
   close the wallet-side door.
4. Attach the Allow-* headers on the forwarded response.

Rate limiting is NOT done here — the completion/OCR pipelines rate-
limit per client IP before opening the stream / calling the provider.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from ..domain.errors import ErrorCode, api_error
from .cors import (
    attach_cors_headers,
    build_preflight_response,
    is_origin_allowed,
)
from .responses import json_error

_PROTECTED_PREFIX = "/api/v1/"
# Methods that are allowed to omit an Origin header — read-only by
# convention. Anything that can spend money (POST) must come from a
# browser that supplied an Origin.
_ORIGIN_OPTIONAL_METHODS: frozenset[str] = frozenset({"GET", "HEAD", "OPTIONS"})


class CorsLockdownMiddleware(BaseHTTPMiddleware):
    """CORS allow-list applied to /api/v1/* only.

    Anything outside that prefix (the FastAPI docs, /openapi.json, etc.)
    passes through untouched so local debugging stays easy.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if not request.url.path.startswith(_PROTECTED_PREFIX):
            return await call_next(request)

        origin = request.headers.get("origin")

        if request.method == "OPTIONS":
            return build_preflight_response(origin)

        if not is_origin_allowed(origin):
            return json_error(
                api_error(ErrorCode.ORIGIN_NOT_ALLOWED, "Origin not allowed"),
                origin,
            )

        # Writes (POST/PUT/PATCH/DELETE) must arrive with an Origin —
        # otherwise some non-browser client is trying to replay them
        # anonymously. is_origin_allowed(None) returns True so that
        # health probes still work; this is where we draw the GET vs
        # write distinction.
        if not origin and request.method not in _ORIGIN_OPTIONAL_METHODS:
            return json_error(
                api_error(
                    ErrorCode.ORIGIN_NOT_ALLOWED,
                    "Origin header required for this endpoint.",
                ),
                origin,
            )

        response = await call_next(request)
        attach_cors_headers(response, origin)
        return response


def install(app: FastAPI) -> None:
    """Register the middleware on a FastAPI application."""
    app.add_middleware(CorsLockdownMiddleware)
