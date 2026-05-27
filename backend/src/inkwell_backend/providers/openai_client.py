"""Process-wide ``AsyncOpenAI`` client factory.

The SDK's ``AsyncOpenAI`` is concurrency-safe and pools its own httpx
connections — but only across a *single* instance. Constructing one
per request (the original pattern) gave up that pooling and paid for
TLS handshakes on every call. This module exposes a lazily-created
singleton so callers get a shared client without each having to know
how to wire it.

The Portkey toggle is applied here: when ``settings.use_portkey`` is
True, the SDK is pointed at the gateway URL and given the
``x-portkey-*`` headers. From every caller's perspective the client
behaves identically — chat completions and vision both flow through
the same SDK methods.

Why the lazy import:

* The SDK pulls in httpx + a non-trivial chunk of code we don't want
  on the import path of mock-only deployments. Importing ``openai``
  the first time someone *calls* :func:`get_openai_client` keeps the
  cold-start fast when no key is configured.

Why explicit timeouts:

* The SDK default timeout is 600s. A hung upstream would tie up an
  ASGI worker for ten full minutes and silently roast the OpenAI key.
  We override to a connection-aware ``httpx.Timeout`` so the
  ``async for chunk in stream`` loop can fail in a bounded time and
  the caller can yield an SSE ``error`` event.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..settings import get_settings
from .portkey import build_client_overrides

if TYPE_CHECKING:
    from openai import AsyncOpenAI

# Portkey-side provider slug — passed in the ``x-portkey-provider``
# header so the gateway knows which upstream to route to. Constant
# because this file only constructs OpenAI clients; the slug changes
# per-vendor and is the caller's responsibility for any future provider.
_PORTKEY_PROVIDER_SLUG: str = "openai"

# Total request budget. SSE streams hold the connection open for the
# duration of the generation; for token streaming we want a fairly
# generous read timeout but a tight connect / pool budget so a stuck
# DNS or saturated pool fails fast.
_CONNECT_TIMEOUT_S = 5.0
_READ_TIMEOUT_S = 60.0
_WRITE_TIMEOUT_S = 10.0
_POOL_TIMEOUT_S = 5.0

# Cached client keyed by a tuple capturing every input that changes the
# wire shape — api_key, gateway base URL, and the frozenset of Portkey
# headers. Tests that toggle Portkey on/off don't poison the cache,
# and the keying survives credential rotation in long-running processes.
_ClientKey = tuple[str | None, str | None, frozenset[tuple[str, str]]]
_clients: dict[_ClientKey, AsyncOpenAI] = {}


def _cache_key(
    api_key: str | None,
    base_url: str | None,
    headers: dict[str, str],
) -> _ClientKey:
    return (api_key, base_url, frozenset(headers.items()))


def get_openai_client() -> AsyncOpenAI:
    """Return the process-wide ``AsyncOpenAI`` instance.

    Lazy-creates on first call. Safe to call from concurrent coroutines
    — the dict assignment is a single bytecode op, and a benign double-
    construction during a race just loses one client object to garbage
    collection.

    Picks up Portkey overrides automatically; callers don't need to
    know which mode they're running in.
    """
    settings = get_settings()

    overrides = build_client_overrides(
        _PORTKEY_PROVIDER_SLUG,
        vendor_api_key=settings.openai_api_key,
    )

    if overrides is None:
        api_key: str | None = settings.openai_api_key
        base_url: str | None = None
        headers: dict[str, str] = {}
    else:
        api_key = overrides.api_key
        base_url = overrides.base_url
        headers = dict(overrides.default_headers)

    key = _cache_key(api_key, base_url, headers)
    existing = _clients.get(key)
    if existing is not None:
        return existing

    # Lazy import — see module docstring for why.
    import httpx
    from openai import AsyncOpenAI

    timeout = httpx.Timeout(
        timeout=_READ_TIMEOUT_S,
        connect=_CONNECT_TIMEOUT_S,
        read=_READ_TIMEOUT_S,
        write=_WRITE_TIMEOUT_S,
        pool=_POOL_TIMEOUT_S,
    )

    # Two explicit branches keep mypy strict happy without resorting to
    # **kwargs unpacking (which loses the per-arg types). The Portkey
    # branch sets every override at once; the default branch lets the
    # SDK pick its own ``base_url`` and ships no extra headers.
    if base_url is not None:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers=headers,
            timeout=timeout,
        )
    else:
        client = AsyncOpenAI(api_key=api_key, timeout=timeout)

    _clients[key] = client
    return client


async def aclose_all() -> None:
    """Close every cached client. Called from the FastAPI lifespan
    shutdown hook via the provider registry so a graceful SIGTERM frees
    upstream connections. Safe to call when no clients have been
    created."""
    while _clients:
        _, client = _clients.popitem()
        await client.close()
