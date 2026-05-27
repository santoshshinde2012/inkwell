"""Pluggable model providers.

Each provider implements :class:`CompletionProvider` and is registered
in :mod:`inkwell_backend.providers.registry`. Service code looks
providers up by model id via :func:`get_provider_for_model` and never
knows which concrete implementation it has.
"""

from .base import (
    CompletionChunk,
    CompletionProvider,
    CompletionUsage,
    ProviderCompletionArgs,
    VisionArgs,
    VisionResult,
)
from .registry import aclose_all_providers, get_provider_for_model

__all__ = [
    "CompletionChunk",
    "CompletionProvider",
    "CompletionUsage",
    "ProviderCompletionArgs",
    "VisionArgs",
    "VisionResult",
    "aclose_all_providers",
    "get_provider_for_model",
]
