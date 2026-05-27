"""OpenAI provider (chat completions + vision).

When ``OPENAI_API_KEY`` is unset, ``stream_completion`` delegates to
:func:`inkwell_backend.providers.mock_provider.mock_stream`. The real
client lives in :mod:`openai_client` so completion + OCR share one
pool and one timeout configuration.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from ..domain.limits import MAX_RESPONSE_TOKENS
from ..domain.models import ModelProvider
from ..settings import get_settings
from .base import (
    CompletionChunk,
    CompletionProvider,
    CompletionUsage,
    ProviderCompletionArgs,
)
from .mock_provider import mock_stream
from .openai_client import get_openai_client

_logger = logging.getLogger(__name__)


async def _real_stream(
    args: ProviderCompletionArgs,
) -> AsyncIterator[CompletionChunk]:
    """Stream a chat completion through the OpenAI async SDK."""
    client = get_openai_client()

    stream = await client.chat.completions.create(
        model=args.model,
        stream=True,
        stream_options={"include_usage": True},
        max_tokens=MAX_RESPONSE_TOKENS,
        messages=[
            {"role": "system", "content": args.system},
            {"role": "user", "content": args.user},
        ],
    )

    try:
        async for chunk in stream:
            # Choices may be empty on the final usage-only frame.
            if chunk.choices:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield CompletionChunk(delta=delta)
            if chunk.usage is not None:
                yield CompletionChunk(
                    usage=CompletionUsage(
                        prompt_tokens=chunk.usage.prompt_tokens or 0,
                        completion_tokens=chunk.usage.completion_tokens or 0,
                        total_tokens=chunk.usage.total_tokens or 0,
                        model=chunk.model or args.model,
                    )
                )
    finally:
        # The SDK's AsyncStream owns an httpx response; close it
        # explicitly so client disconnects free upstream connections.
        await stream.close()


class OpenAiProvider:
    """Concrete :class:`CompletionProvider` implementation for OpenAI."""

    id: ModelProvider = ModelProvider.OPENAI

    @property
    def configured(self) -> bool:
        return bool(get_settings().has_openai)

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        return _real_stream(args) if self.configured else mock_stream(args)


openai_provider: CompletionProvider = OpenAiProvider()
