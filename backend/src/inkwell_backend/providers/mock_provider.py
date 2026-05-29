"""Deterministic mock provider.

Used by the registry as the fallback when a real provider has no
credentials wired up, so local development needs zero secrets. The
text is obviously synthetic so callers can't mistake it for real
model output, and tests can assert against the mock string verbatim.

This module is a first-class :class:`CompletionProvider`. It is not
imported by individual provider modules; the registry alone decides
when to serve mock data, which keeps real-provider implementations
ignorant of the fallback (Single Responsibility Principle).
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator

from .base import (
    CompletionChunk,
    CompletionProvider,
    CompletionUsage,
    ProviderCompletionArgs,
    VisionArgs,
    VisionResult,
)

_MOCK_PHRASES: tuple[str, ...] = (
    "Thanks for reaching out — ",
    "I appreciate the context you shared. ",
    "Here's a draft you can use as a starting point:\n\n",
    "I'm happy to keep iterating ",
    "until it sounds exactly right. ",
    "Let me know what you'd like to ",
    "tweak — tone, length, or any ",
    "specific points to add.\n\n",
    "(This is a mock response from the local backend. ",
    "Configure OPENAI_API_KEY to see real model output.)",
)

# Placeholder served by the mock vision path when no credentials are
# configured. Word-for-word string is asserted by tests, so do not edit
# without updating ``tests/test_ocr.py`` in lock-step.
MOCK_OCR_TEXT: str = (
    "[mock OCR text — set OPENAI_API_KEY in backend/.env to enable real recognition]"
)


async def _mock_stream(args: ProviderCompletionArgs) -> AsyncIterator[CompletionChunk]:
    """Yield deterministic text with realistic inter-token delays."""
    for phrase in _MOCK_PHRASES:
        yield CompletionChunk(delta=phrase)
        # 60–140 ms between tokens — matches the feel of a real stream
        # without burning real time in tests (tests can monkey-patch
        # ``asyncio.sleep``).
        await asyncio.sleep(0.06 + random.random() * 0.08)  # noqa: S311 — non-cryptographic

    estimated_prompt = (len(args.system) + len(args.user)) // 4
    yield CompletionChunk(
        usage=CompletionUsage(
            prompt_tokens=estimated_prompt,
            completion_tokens=64,
            total_tokens=estimated_prompt + 64,
            model=f"{args.model} (mock)",
        )
    )


# Split into a few chunks so the streaming path looks realistic in dev,
# but short enough that tests don't add measurable wall-clock time.
_MOCK_OCR_CHUNKS: tuple[str, ...] = (
    "[mock OCR text — ",
    "set OPENAI_API_KEY in backend/.env ",
    "to enable real recognition]",
)


async def _mock_recognize_stream(_: VisionArgs) -> AsyncIterator[str]:
    """Stream the mock OCR placeholder in a few delta-sized chunks."""
    for chunk in _MOCK_OCR_CHUNKS:
        yield chunk
        # Tiny delay so a streaming consumer actually sees multiple
        # frames. Tests that don't want the delay can monkey-patch
        # ``asyncio.sleep`` the same way the completion stream does.
        await asyncio.sleep(0.01)


class MockProvider:
    """The deterministic fallback used when no real provider is configured.

    Always reports ``configured = True`` — the mock has no external
    dependencies, so it can always serve a response. The registry only
    ever instantiates one of these and hands it out when the real
    provider for the requested model lacks credentials.
    """

    @property
    def configured(self) -> bool:
        # The mock is the fallback — by definition always ready.
        return True

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        return _mock_stream(args)

    async def recognize_text(self, args: VisionArgs) -> VisionResult:
        # Model id is annotated ``" (mock)"`` so any caller logging it
        # can see at a glance that no real upstream was hit. The
        # placeholder string itself is intentionally bracketed so a
        # downstream UI can detect and badge it if desired.
        return VisionResult(text=MOCK_OCR_TEXT, model=f"{args.model} (mock)")

    def stream_recognize_text(self, args: VisionArgs) -> AsyncIterator[str]:
        return _mock_recognize_stream(args)

    async def aclose(self) -> None:
        """Mock holds no resources — no-op."""
        return None


mock_provider: CompletionProvider = MockProvider()
