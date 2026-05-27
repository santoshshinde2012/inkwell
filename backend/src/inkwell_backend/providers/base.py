"""Provider-neutral interface every model backend implements.

A new integration (Anthropic, Google, a local model, …) is one new file
implementing :class:`CompletionProvider` plus a one-line registry entry.
Nothing in the route handlers or the service pipelines knows which
provider it's talking to — they call ``stream_completion`` or
``recognize_text`` and receive provider-neutral dataclasses back.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..domain.models import ModelProvider

# ---------------------------------------------------------------------------
# Chat completion
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProviderCompletionArgs:
    """Inputs to a single ``stream_completion`` call."""

    model: str
    """Catalog model id, e.g. ``"gpt-4o-mini"``."""

    system: str
    user: str


@dataclass(frozen=True, slots=True)
class CompletionUsage:
    """Final usage accounting reported by the provider."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    model: str


@dataclass(frozen=True, slots=True)
class CompletionChunk:
    """One chunk yielded by ``stream_completion``.

    ``delta`` is set for streamed text; ``usage`` is set once at the end
    of the stream. Mutually exclusive.
    """

    delta: str | None = None
    usage: CompletionUsage | None = None


# ---------------------------------------------------------------------------
# Vision / OCR
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class VisionArgs:
    """Inputs to a single ``recognize_text`` call.

    ``image_base64`` is the raw, whitespace-stripped base64 payload; the
    provider is responsible for assembling the on-wire shape (data URL,
    binary upload, etc.) appropriate for its vendor.
    """

    model: str
    system: str
    user: str
    image_base64: str
    mime_type: str


@dataclass(frozen=True, slots=True)
class VisionResult:
    """Successful output of ``recognize_text`` — model output text
    plus the model id actually used (which may include a ``" (mock)"``
    suffix when running unconfigured)."""

    text: str
    model: str


# ---------------------------------------------------------------------------
# Provider protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class CompletionProvider(Protocol):
    """Every model provider implements this protocol.

    Implementations live as module-level singletons; the methods are
    called once per request. Cancellation of ``stream_completion`` is
    signalled by closing the iterator (the caller awaits ``aclose()``);
    implementations must clean up upstream resources on cancellation.

    A provider that is NOT configured (no credentials) must still
    implement both methods and return usable mock data so local dev
    needs no secrets.
    """

    id: ModelProvider

    @property
    def configured(self) -> bool:
        """True when real credentials are wired up.

        Declared as a property — not a plain attribute — so concrete
        implementations can derive it lazily from settings without
        flagging a Protocol mismatch in mypy.
        """
        ...

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        """Yield ``delta`` chunks as the model produces text, then one
        final ``usage`` chunk."""
        ...

    async def recognize_text(self, args: VisionArgs) -> VisionResult:
        """Run image-to-text against a vision-capable model.

        Returns the extracted text and the model id actually used. The
        caller has already enforced size limits and rate-limit gates;
        the provider only handles the upstream call shape.
        """
        ...

    async def aclose(self) -> None:
        """Release any process-wide resources (HTTP pools, etc.).

        Called from the FastAPI lifespan shutdown hook via the registry,
        so a graceful SIGTERM frees upstream connections. Implementations
        must be safe to call when no resources have been allocated yet
        (e.g. provider was never used in this process).
        """
        ...
