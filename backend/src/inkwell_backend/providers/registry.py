"""Provider registry.

Maps each :class:`ModelProvider` to its concrete :class:`CompletionProvider`.
Service code calls :func:`get_provider_for_model` and never sees the
implementation; lifecycle code calls :func:`aclose_all_providers`.

Adding a new integration is two lines: import the new provider module
and add the entry to ``_PROVIDERS``. The :class:`ModelProvider` enum
acts as the exhaustiveness check — extending it without registering a
matching provider trips a mypy error here.
"""

from __future__ import annotations

import contextlib
import logging

from ..domain.models import ModelProvider, provider_for_model
from .base import CompletionProvider
from .openai_provider import openai_provider

_logger = logging.getLogger(__name__)

_PROVIDERS: dict[ModelProvider, CompletionProvider] = {
    ModelProvider.OPENAI: openai_provider,
}


def get_provider_for_model(model_id: str) -> CompletionProvider:
    """Resolve the provider that serves a given catalog model id."""
    return _PROVIDERS[provider_for_model(model_id)]


async def aclose_all_providers() -> None:
    """Close every registered provider's upstream resources.

    Called from the FastAPI lifespan shutdown hook so a graceful
    SIGTERM frees connections. Best-effort: a failing ``aclose`` on
    one provider must not block cleanup of the rest.
    """
    for provider in _PROVIDERS.values():
        with contextlib.suppress(Exception):
            await provider.aclose()
