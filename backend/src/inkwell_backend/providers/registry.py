"""Provider registry.

Maps each :class:`ModelProvider` to its concrete :class:`CompletionProvider`.
The completion pipeline calls :func:`get_provider_for_model` and never
sees the implementation.

Adding a new integration is two lines: import the new provider module
and add the entry to ``_PROVIDERS``. The :class:`ModelProvider` enum
acts as the exhaustiveness check — extending it without registering a
matching provider trips a mypy error here.
"""

from __future__ import annotations

from ..domain.models import ModelProvider, provider_for_model
from .base import CompletionProvider
from .openai_provider import openai_provider

_PROVIDERS: dict[ModelProvider, CompletionProvider] = {
    ModelProvider.OPENAI: openai_provider,
}


def get_provider_for_model(model_id: str) -> CompletionProvider:
    """Resolve the provider that serves a given catalog model id."""
    return _PROVIDERS[provider_for_model(model_id)]
