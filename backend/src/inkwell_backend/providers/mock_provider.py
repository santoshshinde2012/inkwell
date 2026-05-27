"""Deterministic mock provider.

Used by every provider when its credentials aren't configured, so local
dev needs zero secrets. The text is obviously fake so callers can't
mistake it for real model output.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator

from .base import (
    CompletionChunk,
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

# Placeholder served by ``mock_recognize`` when no credentials are
# configured. Word-for-word string is asserted by tests, so do not edit
# without updating ``tests/test_ocr.py`` in lock-step.
MOCK_OCR_TEXT: str = (
    "[mock OCR text — set OPENAI_API_KEY in backend/.env to enable real recognition]"
)


async def mock_stream(args: ProviderCompletionArgs) -> AsyncIterator[CompletionChunk]:
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


async def mock_recognize(args: VisionArgs) -> VisionResult:
    """Return a fixed placeholder so OCR works in local dev with no key.

    The model id is annotated ``" (mock)"`` so any caller logging it
    can see at a glance that no real upstream was hit. The placeholder
    string itself is intentionally bracketed so a downstream UI can
    detect and badge it if desired.
    """
    return VisionResult(text=MOCK_OCR_TEXT, model=f"{args.model} (mock)")
