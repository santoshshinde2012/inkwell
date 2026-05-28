"""Provider registry — the one place that knows which concrete
implementation serves a given model.

Service code calls :func:`get_provider_for_model` and receives a
:class:`CompletionProvider` it can use immediately. Two invariants
this module enforces:

* **Single point of dispatch.** Service code never imports a concrete
  provider directly. Swapping vendors, adding a new one, or routing
  to the mock fallback is a one-file change here (Dependency Inversion).
* **Mock fallback lives here, not in real providers.** If a real
  provider reports ``configured = False``, we return the mock
  provider instead. This keeps each real provider focused on its
  vendor's API (Single Responsibility) and means a future Anthropic
  provider gets the same fallback behaviour for free (Open/Closed —
  add a class, don't duplicate the fallback logic).

Adding a new integration:

1. Implement :class:`CompletionProvider` in a new module.
2. Add the :class:`ModelProvider` enum value in ``domain/models.py``.
3. Register the singleton in :data:`_REAL_PROVIDERS` below — mypy's
   exhaustiveness check on the enum will trip if you forget.
"""

from __future__ import annotations

import contextlib

from ..domain.models import ModelProvider, provider_for_model
from .base import CompletionProvider
from .mock_provider import mock_provider
from .openai_provider import openai_provider

# Real providers, keyed by the vendor enum value. The mock is NOT in
# this map — it isn't tied to a vendor and is only used as fallback.
_REAL_PROVIDERS: dict[ModelProvider, CompletionProvider] = {
    ModelProvider.OPENAI: openai_provider,
}


def get_provider_for_model(model_id: str) -> CompletionProvider:
    """Resolve the provider that serves a given catalog model id.

    Returns the real vendor provider when it has credentials configured,
    otherwise the mock provider. The decision is re-evaluated on every
    call (cheap — just a settings property read) so a hot-reload of
    credentials in a long-running process takes effect on the next
    request without needing a restart.
    """
    real = _REAL_PROVIDERS[provider_for_model(model_id)]
    return real if real.configured else mock_provider


async def aclose_all_providers() -> None:
    """Close every registered provider's upstream resources.

    Called from the FastAPI lifespan shutdown hook so a graceful
    SIGTERM frees connections. Best-effort: a failing ``aclose`` on
    one provider must not block cleanup of the rest. The mock is
    included for completeness — its ``aclose`` is a no-op but iterating
    over it keeps this function's contract simple ("close everything we
    might have used").
    """
    providers: tuple[CompletionProvider, ...] = (*_REAL_PROVIDERS.values(), mock_provider)
    for provider in providers:
        with contextlib.suppress(Exception):
            await provider.aclose()
