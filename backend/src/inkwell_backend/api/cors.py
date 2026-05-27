"""CORS allow-list.

The extension is the *only* legitimate cross-origin caller of /api/v1/*.
Anything else is rejected at the middleware layer.

Why we don't use a wildcard:

* Wildcards make stolen tokens trivially exploitable from any page.
* The OpenAI key sits behind these routes, so blast radius is high.

Why we don't send ``Access-Control-Allow-Credentials: true``:

* Inkwell has no auth and no cookies. ``credentials: true`` paired
  with a reflected ``Access-Control-Allow-Origin`` is the canonical
  CSRF/XS-leak pattern; we don't need it and we don't ship it.

Why we still allow same-origin and dev loopbacks (but only in dev):

* Same-origin lets the FastAPI app itself hit the API (e.g. tests or a
  future admin page) during development.
* Loopback origins are convenient for curl/Postman in dev only.

Origin comparison is **case-insensitive on the scheme + host**. Browsers
always send lower-case Origin headers, but a user-supplied ``APP_URL``
or allow-list entry could be mixed-case; normalising both sides removes
that footgun.
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import Response

from ..settings import Settings, get_settings

_DEV_LOOPBACKS: frozenset[str] = frozenset({"http://localhost:8000", "http://127.0.0.1:8000"})

_PREFLIGHT_HEADERS_LITERAL = "Authorization, Content-Type, X-Client-Request-Id"


def _normalise(origin: str | None) -> str | None:
    """Lower-case + strip a single trailing slash so equality checks are
    robust against minor formatting differences in ``APP_URL`` / the
    allow-list env vars. Returns None for missing/empty input."""
    if not origin:
        return None
    o = origin.strip().lower()
    if o.endswith("/"):
        o = o[:-1]
    return o or None


def _same_origin(settings: Settings) -> str:
    """The configured app's scheme://host[:port], lower-cased."""
    parsed = urlparse(settings.app_url)
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def is_origin_allowed(origin: str | None, settings: Settings | None = None) -> bool:
    """Return True when ``origin`` may call the API.

    A missing ``Origin`` header is treated as allowed here so that
    server-to-server diagnostics (health probes, ``curl`` from a shell)
    still work. The cost-incurring POST routes (``/complete``, ``/ocr``)
    additionally require an Origin via :func:`require_browser_origin`
    in the route's dependency chain — so write-side traffic is still
    held to a browser origin allow-list.
    """
    normalised = _normalise(origin)
    if normalised is None:
        return True
    settings = settings or get_settings()
    if normalised == _same_origin(settings):
        return True
    if not settings.is_production and normalised in _DEV_LOOPBACKS:
        return True
    allow_set = {_normalise(o) for o in settings.allowed_extension_origins} - {None}
    if normalised in allow_set:
        return True
    extra_set = {_normalise(o) for o in settings.extra_origins} - {None}
    if normalised in extra_set:
        return True
    # Dev convenience: any chrome-extension:// origin during development,
    # so an unpacked-load doesn't require fishing the new id out of
    # chrome://extensions before the API will reply.
    return not settings.is_production and normalised.startswith("chrome-extension://")


def build_cors_headers(origin: str | None, settings: Settings | None = None) -> dict[str, str]:
    """Compute the CORS headers for a *checked* origin.

    Callers should have already verified the origin via
    :func:`is_origin_allowed` — passing a disallowed origin returns an
    empty dict so the browser blocks the response.
    """
    settings = settings or get_settings()
    if origin and is_origin_allowed(origin, settings):
        return {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": _PREFLIGHT_HEADERS_LITERAL,
            "Access-Control-Max-Age": "86400",
        }
    return {}


def attach_cors_headers(response: Response, origin: str | None) -> None:
    """Decorate ``response`` in-place with CORS headers."""
    for key, value in build_cors_headers(origin).items():
        response.headers[key] = value


def build_preflight_response(origin: str | None) -> Response:
    """Construct the body of a successful CORS preflight.

    Always 204; if the origin isn't allowed we just don't set the
    Allow-Origin header, which causes the browser to block the real
    request without leaking the allow-list via status codes.
    """
    return Response(status_code=204, headers=build_cors_headers(origin))
