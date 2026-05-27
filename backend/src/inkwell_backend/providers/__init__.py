"""Pluggable model providers.

Each provider implements :class:`CompletionProvider` and is registered
in :mod:`inkwell_backend.providers.registry`. The completion pipeline
looks providers up by model id and never knows which concrete
implementation it has.
"""

from .base import CompletionChunk, CompletionProvider, ProviderCompletionArgs
from .registry import get_provider_for_model

__all__ = [
    "CompletionChunk",
    "CompletionProvider",
    "ProviderCompletionArgs",
    "get_provider_for_model",
]
