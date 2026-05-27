"""Provider-neutral interface every completion backend implements.

A new integration (Anthropic, Google, a local model, …) is one new file
implementing :class:`CompletionProvider` plus a one-line registry entry.
Nothing in the route handlers or the completion pipeline knows which
provider it's talking to.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..domain.models import ModelProvider


@dataclass(frozen=True, slots=True)
class ProviderCompletionArgs:
    """Inputs to a single ``stream_completion`` call."""

    model: str
    """Catalog model id, e.g. ``"gpt-4o-mini"``."""

    system: str
    user: str


@dataclass(frozen=True, slots=True)
class CompletionChunk:
    """One chunk yielded by ``stream_completion``.

    ``delta`` is set for streamed text; ``usage`` is set once at the end
    of the stream. Mutually exclusive.
    """

    delta: str | None = None
    usage: CompletionUsage | None = None


@dataclass(frozen=True, slots=True)
class CompletionUsage:
    """Final usage accounting reported by the provider."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    model: str


@runtime_checkable
class CompletionProvider(Protocol):
    """Every completion provider implements this protocol.

    Implementations live as module-level singletons; ``stream_completion``
    is called once per request and returns a fresh async iterator each
    time. Cancellation is signalled by closing the iterator (the caller
    awaits ``aclose()``); implementations must clean up upstream
    resources on cancellation.
    """

    id: ModelProvider

    @property
    def configured(self) -> bool:
        """True when real credentials are wired up.

        A provider that is NOT configured must still implement
        ``stream_completion`` and yield a usable mock response so local
        dev needs no secrets. Declared as a property — not a plain
        attribute — so concrete implementations can derive it lazily
        from settings without flagging a Protocol mismatch in mypy.
        """
        ...

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        """Yield ``delta`` chunks as the model produces text, then one
        final ``usage`` chunk."""
        ...
