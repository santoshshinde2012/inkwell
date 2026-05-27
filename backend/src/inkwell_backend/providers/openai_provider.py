"""OpenAI provider — chat completions + vision (OCR).

This is the **single end-to-end wrapper** for all OpenAI traffic. Every
other module talks to the provider abstraction (``CompletionProvider``)
and is unaware which vendor is on the other end. To swap providers,
write a sibling file (e.g. ``anthropic_provider.py``) implementing the
same protocol and register it in ``providers/registry.py``.

When ``OPENAI_API_KEY`` is unset, both ``stream_completion`` and
``recognize_text`` delegate to :mod:`mock_provider`. The real client
lives in :mod:`openai_client` so chat + OCR share one pool and one
timeout configuration.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from ..domain.limits import MAX_OCR_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS
from ..domain.models import ModelProvider
from ..settings import get_settings
from .base import (
    CompletionChunk,
    CompletionProvider,
    CompletionUsage,
    ProviderCompletionArgs,
    VisionArgs,
    VisionResult,
)
from .mock_provider import mock_recognize, mock_stream
from .openai_client import aclose_all as _aclose_openai_clients
from .openai_client import get_openai_client
from .portkey import build_request_headers

_logger = logging.getLogger(__name__)

# Temperature for OCR. Zero so the model doesn't paraphrase or hallucinate
# text that isn't in the image. Kept module-local because it's an OpenAI-
# specific tuning knob — a different vendor's vision API may not expose
# temperature at all.
_OCR_TEMPERATURE: float = 0.0


# ---------------------------------------------------------------------------
# Chat completion
# ---------------------------------------------------------------------------


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
        # Per-call headers — merged onto the client's default_headers.
        # ``build_request_headers`` returns ``None`` when nothing needs
        # adding (Portkey disabled or no trace id), which the SDK
        # treats as a no-op.
        extra_headers=build_request_headers(args.trace_id),
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


# ---------------------------------------------------------------------------
# Vision / OCR
# ---------------------------------------------------------------------------


async def _real_recognize(args: VisionArgs) -> VisionResult:
    """Send an image to OpenAI's vision-capable chat model and return
    the extracted text.

    Raises whatever the OpenAI SDK raises on transport / API failures —
    the service layer translates these into ``UPSTREAM_ERROR`` for the
    wire. Keeping the translation there (not here) keeps providers
    swappable: an Anthropic implementation can raise its own native
    exceptions and the service layer treats them uniformly.
    """
    client = get_openai_client()

    data_url = f"data:{args.mime_type};base64,{args.image_base64}"

    completion = await client.chat.completions.create(
        model=args.model,
        # OCR responses can be long for dense screenshots — give them
        # more headroom than the completion path's default.
        max_tokens=MAX_OCR_RESPONSE_TOKENS,
        temperature=_OCR_TEMPERATURE,
        messages=[
            {"role": "system", "content": args.system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": args.user},
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url, "detail": "high"},
                    },
                ],
            },
        ],
        # See ``_real_stream`` for the rationale.
        extra_headers=build_request_headers(args.trace_id),
    )

    raw = completion.choices[0].message.content if completion.choices else ""
    text = (raw or "").strip() if isinstance(raw, str) else ""
    return VisionResult(text=text, model=completion.model or args.model)


# ---------------------------------------------------------------------------
# Provider singleton
# ---------------------------------------------------------------------------


class OpenAiProvider:
    """Concrete :class:`CompletionProvider` for OpenAI.

    Both methods short-circuit to the mock provider when no key is
    configured, so the rest of the app sees identical behaviour
    whether or not credentials are present.
    """

    id: ModelProvider = ModelProvider.OPENAI

    @property
    def configured(self) -> bool:
        return bool(get_settings().has_openai)

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        return _real_stream(args) if self.configured else mock_stream(args)

    async def recognize_text(self, args: VisionArgs) -> VisionResult:
        if not self.configured:
            return await mock_recognize(args)
        return await _real_recognize(args)

    async def aclose(self) -> None:
        await _aclose_openai_clients()


openai_provider: CompletionProvider = OpenAiProvider()
