"""FastAPI dependency providers.

Centralised here so route handlers stay declarative — every route's
signature shows up-front exactly which inbound facts it depends on.
"""

from __future__ import annotations

from fastapi import Header, Request


def client_ip(request: Request) -> str:
    """Best-effort client IP for rate limiting.

    Prefers ``X-Forwarded-For`` (every reverse proxy worth running in
    front of this service sets it), falls back to ``X-Real-IP``, then
    to the raw socket peer, and finally to a shared ``"unknown"``
    bucket so missing-header attackers can't bypass the limiter by
    stripping the header.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    client = request.client
    if client and client.host:
        return client.host
    return "unknown"


def origin_header(origin: str | None = Header(default=None)) -> str | None:
    """The inbound ``Origin`` header, normalised to ``None`` if absent."""
    return origin


def client_request_id(
    x_client_request_id: str | None = Header(default=None, max_length=64),
) -> str | None:
    """The inbound ``X-Client-Request-Id`` header, when present.

    The extension's background SSE client sends this so a request can
    be correlated end-to-end across the extension, the backend audit
    log, and any downstream observability. Capped at 64 chars so a
    malformed/oversized value can't bloat log lines.
    """
    if not x_client_request_id:
        return None
    return x_client_request_id.strip() or None
