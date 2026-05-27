"""Process-wide ``AsyncOpenAI`` client factory.

The SDK's ``AsyncOpenAI`` is concurrency-safe and pools its own httpx
connections — but only across a *single* instance. Constructing one
per request (the original pattern) gave up that pooling and paid for
TLS handshakes on every call. This module exposes a lazily-created
singleton keyed by ``(api_key, timeout)`` so callers get a shared
client without each having to know how to wire it.

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

if TYPE_CHECKING:
    from openai import AsyncOpenAI

# Total request budget. SSE streams hold the connection open for the
# duration of the generation; for token streaming we want a fairly
# generous read timeout but a tight connect / pool budget so a stuck
# DNS or saturated pool fails fast.
_CONNECT_TIMEOUT_S = 5.0
_READ_TIMEOUT_S = 60.0
_WRITE_TIMEOUT_S = 10.0
_POOL_TIMEOUT_S = 5.0

# Cached client keyed by api_key — almost always a single entry, but
# keying on the key means tests that swap credentials don't poison the
# cache. ``None`` means "no key configured".
_clients: dict[str | None, AsyncOpenAI] = {}


def get_openai_client() -> AsyncOpenAI:
    """Return the process-wide ``AsyncOpenAI`` instance.

    Lazy-creates on first call. Safe to call from concurrent coroutines
    — the dict assignment is a single bytecode op, and a benign double-
    construction during a race just loses one client object to garbage
    collection.
    """
    settings = get_settings()
    key = settings.openai_api_key
    existing = _clients.get(key)
    if existing is not None:
        return existing

    # Lazy import — see module docstring for why.
    import httpx
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=key,
        timeout=httpx.Timeout(
            timeout=_READ_TIMEOUT_S,
            connect=_CONNECT_TIMEOUT_S,
            read=_READ_TIMEOUT_S,
            write=_WRITE_TIMEOUT_S,
            pool=_POOL_TIMEOUT_S,
        ),
    )
    _clients[key] = client
    return client


async def aclose_all() -> None:
    """Close every cached client. Called from the FastAPI lifespan
    shutdown hook so a graceful SIGTERM frees upstream connections.
    Safe to call when no clients have been created."""
    while _clients:
        _, client = _clients.popitem()
        await client.close()
