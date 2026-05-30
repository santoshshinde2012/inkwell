"""Single configuration point for the OpenAI SDK — direct or via Portkey.

The Portkey gateway is OpenAI-SDK-compatible by design: integration is
purely a transport concern (base URL + a few headers), so we keep
using ``AsyncOpenAI`` and only swap how it's constructed. Both modes
go through one factory:

.. code-block:: python

    # USE_PORTKEY=false → direct OpenAI
    AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=...)

    # USE_PORTKEY=true → Portkey gateway
    AsyncOpenAI(
        api_key=<placeholder or vendor key>,
        base_url=PORTKEY_GATEWAY_URL,
        default_headers=createHeaders(api_key=PORTKEY_API_KEY, ...),
        timeout=...,
    )

This file is the *only* place that knows about Portkey. Other modules
call :func:`get_openai_client` and :func:`build_request_headers` and
remain mode-agnostic.

Why the lazy imports of ``openai`` and ``portkey_ai``:

* Both pull in non-trivial code we don't want on the import path of
  mock-only deployments. Importing them when someone *calls* the
  factory keeps the cold start fast when no credentials are configured.

Why explicit timeouts:

* The SDK default timeout is 600s. A hung upstream would tie up an
  ASGI worker for ten full minutes and silently roast the OpenAI key.
  We override to a connection-aware ``httpx.Timeout`` so the
  ``async for chunk in stream`` loop can fail in a bounded time and
  the caller can yield an SSE ``error`` event.

Why the singleton cache:

* ``AsyncOpenAI`` is concurrency-safe and pools its own httpx
  connections — but only across a *single* instance. Constructing one
  per request gives up the pooling and pays for TLS handshakes on
  every call. The cache is keyed on every input that affects the wire
  shape (api_key, base_url, headers) so a credential rotation or
  toggle flip cannot serve a stale client.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from ..settings import get_settings

if TYPE_CHECKING:
    from openai import AsyncOpenAI

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Placeholder ``api_key`` handed to the SDK when authentication happens
# via a Portkey virtual key — the OpenAI SDK refuses an empty key, and
# the gateway strips this Authorization header before forwarding. Using
# a clearly fake value here so it shows up in logs if it ever leaks.
_VIRTUAL_KEY_PLACEHOLDER: str = "PORTKEY_VIRTUAL_KEY_PLACEHOLDER"

# Total request budget. SSE streams hold the connection open for the
# duration of the generation; for token streaming we want a fairly
# generous read timeout but a tight connect / pool budget so a stuck
# DNS or saturated pool fails fast.
_CONNECT_TIMEOUT_S = 5.0
_READ_TIMEOUT_S = 60.0
_WRITE_TIMEOUT_S = 10.0
_POOL_TIMEOUT_S = 5.0

# Cached client keyed by every input that changes the wire shape —
# api_key, base URL, and the frozenset of Portkey headers. Tests that
# toggle the gateway on/off don't poison the cache, and the keying
# survives credential rotation in long-running processes.
_ClientKey = tuple[str | None, str | None, frozenset[tuple[str, str]]]
_clients: dict[_ClientKey, AsyncOpenAI] = {}


# ---------------------------------------------------------------------------
# Portkey overrides — private; only used when settings.portkey_enabled
# ---------------------------------------------------------------------------


def _portkey_overrides(vendor_api_key: str | None) -> tuple[str, str, Mapping[str, str]] | None:
    """Return ``(api_key, base_url, headers)`` for the Portkey path, or
    ``None`` when the gateway is disabled.

    The settings layer's cross-field validator guarantees that when
    ``portkey_enabled`` is True, ``portkey_api_key`` is populated —
    callers don't need to defend against that case.

    The lazy import of ``portkey_ai`` keeps cold-start fast for
    deployments that don't use the gateway.
    """
    settings = get_settings()
    if not settings.portkey_enabled:
        return None

    # Lazy import — see module docstring.
    from portkey_ai import createHeaders

    # ``createHeaders`` accepts only keyword arguments and skips entries
    # whose value is None, so we pass every optional field directly and
    # let it omit the unset ones. ``provider`` is intentionally optional:
    # when None (the default) no ``x-portkey-provider`` header is sent,
    # so a model-catalog slug (``@integration/model``) or virtual key
    # drives routing to any upstream — OpenAI, Anthropic, Bedrock, ….
    # The SDK ships without type stubs for this helper — silence the
    # untyped-call warning rather than wrap the whole module.
    headers: Mapping[str, str] = createHeaders(  # type: ignore[no-untyped-call]
        api_key=settings.portkey_api_key,
        provider=settings.portkey_provider,
        virtual_key=settings.portkey_virtual_key,
        config=settings.portkey_config,
    )

    if settings.portkey_virtual_key:
        # The vault provides the upstream credential; the SDK still
        # demands a non-empty api_key, so feed it a placeholder.
        api_key = _VIRTUAL_KEY_PLACEHOLDER
    else:
        # Forward the vendor's own key through the gateway. Falling back
        # to the placeholder when no key is set lets the SDK construct
        # without raising; the upstream call will fail with a clear 401
        # from Portkey, which is the right surfacing.
        api_key = (vendor_api_key or "").strip() or _VIRTUAL_KEY_PLACEHOLDER

    return api_key, settings.portkey_base_url, headers


# ---------------------------------------------------------------------------
# Public — client factory + per-request trace header
# ---------------------------------------------------------------------------


def get_openai_client() -> AsyncOpenAI:
    """Return the process-wide ``AsyncOpenAI`` instance.

    Lazy-creates on first call. Safe to call from concurrent coroutines
    — the dict assignment is a single bytecode op, and a benign double-
    construction during a race just loses one client object to garbage
    collection.

    Picks up Portkey overrides automatically; callers don't need to know
    which mode they're running in.
    """
    settings = get_settings()
    overrides = _portkey_overrides(vendor_api_key=settings.openai_api_key)

    if overrides is None:
        api_key: str | None = settings.openai_api_key
        base_url: str | None = None
        headers: Mapping[str, str] = {}
    else:
        api_key, base_url, headers = overrides

    cache_key: _ClientKey = (api_key, base_url, frozenset(headers.items()))
    existing = _clients.get(cache_key)
    if existing is not None:
        return existing

    # Lazy imports — see module docstring.
    import httpx
    from openai import AsyncOpenAI

    timeout = httpx.Timeout(
        timeout=_READ_TIMEOUT_S,
        connect=_CONNECT_TIMEOUT_S,
        read=_READ_TIMEOUT_S,
        write=_WRITE_TIMEOUT_S,
        pool=_POOL_TIMEOUT_S,
    )

    # Single SDK call, varying kwargs. ``base_url`` and
    # ``default_headers`` are only sent when the Portkey overrides
    # populated them — omitting them entirely lets the SDK pick its own
    # defaults (``https://api.openai.com/v1`` and no extra headers).
    kwargs: dict[str, Any] = {"api_key": api_key, "timeout": timeout}
    if base_url is not None:
        kwargs["base_url"] = base_url
    if headers:
        kwargs["default_headers"] = dict(headers)

    client = AsyncOpenAI(**kwargs)
    _clients[cache_key] = client
    return client


def build_request_headers(trace_id: str | None) -> dict[str, str] | None:
    """Return per-request ``extra_headers`` for the SDK, or ``None`` when
    nothing needs adding.

    Today this only forwards the client-supplied request id as Portkey's
    ``x-portkey-trace-id`` — the canonical way to correlate our audit
    log lines with the gateway's request log. Skipped when Portkey is
    disabled (the header would be ignored upstream) or when no trace id
    is available (the gateway will mint its own).

    The OpenAI SDK accepts ``extra_headers`` on every API call and
    merges them on top of the client's ``default_headers``; this helper
    only emits the per-request headers, leaving the static ones
    (``x-portkey-api-key`` etc.) on the client.
    """
    if not trace_id:
        return None
    if not get_settings().portkey_enabled:
        return None
    return {"x-portkey-trace-id": trace_id}


async def aclose_all() -> None:
    """Close every cached client. Called from the FastAPI lifespan
    shutdown hook so a graceful SIGTERM frees upstream connections.
    Safe to call when no clients have been created."""
    while _clients:
        _, client = _clients.popitem()
        await client.close()
