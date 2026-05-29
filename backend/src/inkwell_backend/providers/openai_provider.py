"""OpenAI provider — chat completions + vision (OCR).

The single end-to-end wrapper for all OpenAI traffic. Every other
module talks to the provider abstraction (:class:`CompletionProvider`)
and is unaware which vendor is on the other end. Adding an integration
(Anthropic, Google, …) is one new file implementing the same Protocol
plus a one-line registry entry.

This module is **pure OpenAI** — it has no awareness of the mock
fallback. The registry checks ``configured`` and routes to
:mod:`mock_provider` when this provider lacks credentials, so the
"is real upstream reachable?" decision lives in exactly one place
(SRP).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from ..domain.limits import MAX_OCR_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS
from ..settings import get_settings
from .base import (
    CompletionChunk,
    CompletionProvider,
    CompletionUsage,
    ProviderCompletionArgs,
    VisionArgs,
    VisionResult,
)
from .openai_client import (
    aclose_all as _aclose_openai_clients,
)
from .openai_client import (
    build_request_headers,
    get_openai_client,
)

# Temperature for OCR. Zero so the model doesn't paraphrase or
# hallucinate text that isn't in the image. Kept module-local because
# it's an OpenAI-specific tuning knob — a different vendor's vision
# API may not expose temperature at all.
_OCR_TEMPERATURE: float = 0.0


# ---------------------------------------------------------------------------
# Chat completion
# ---------------------------------------------------------------------------


async def _stream(args: ProviderCompletionArgs) -> AsyncIterator[CompletionChunk]:
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


async def _recognize(args: VisionArgs) -> VisionResult:
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

    # The message list is duplicated between the non-streaming path
    # below and ``_recognize_stream`` above on purpose: typing the
    # message-list literal inline at the call site is the only way the
    # OpenAI SDK's overloads pick up the right shape (factoring it into
    # a helper widens the type to ``dict[str, object]`` and loses both
    # the streaming-vs-non-streaming overload resolution and the wire
    # type-checking).
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
        # See ``_stream`` for the rationale.
        extra_headers=build_request_headers(args.trace_id),
    )

    raw = completion.choices[0].message.content if completion.choices else ""
    text = (raw or "").strip() if isinstance(raw, str) else ""
    return VisionResult(text=text, model=completion.model or args.model)


async def _recognize_stream(args: VisionArgs) -> AsyncIterator[str]:
    """Stream a vision call's content deltas as plain text chunks.

    Mirrors :func:`_recognize`'s prompt shape exactly — only ``stream=
    True`` and the iteration loop differ — so a streamed call and a
    non-streamed call produce equivalent text for the same image. See
    the note in ``_recognize`` for why the message list is duplicated.
    """
    client = get_openai_client()

    data_url = f"data:{args.mime_type};base64,{args.image_base64}"

    stream = await client.chat.completions.create(
        model=args.model,
        stream=True,
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
        extra_headers=build_request_headers(args.trace_id),
    )

    try:
        async for chunk in stream:
            if not chunk.choices:
                # Usage-only frame at the end of the stream; vision OCR
                # currently has no usage consumer, so just skip it.
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    finally:
        # Free the upstream HTTP connection if the caller breaks out of
        # the iterator early (client disconnect, error in the consumer).
        await stream.close()


# ---------------------------------------------------------------------------
# Provider singleton
# ---------------------------------------------------------------------------


class OpenAiProvider:
    """Concrete :class:`CompletionProvider` for OpenAI.

    Pure adapter — knows nothing about the mock fallback. The registry
    selects the mock provider instead of this one when ``configured``
    reports False, so this class can stay focused on the OpenAI SDK
    call shape.
    """

    @property
    def configured(self) -> bool:
        """True when an OpenAI upstream is reachable — directly with
        a vendor key, or via Portkey (virtual key or forwarded key)."""
        return bool(get_settings().has_openai)

    def stream_completion(
        self,
        args: ProviderCompletionArgs,
    ) -> AsyncIterator[CompletionChunk]:
        return _stream(args)

    async def recognize_text(self, args: VisionArgs) -> VisionResult:
        return await _recognize(args)

    def stream_recognize_text(self, args: VisionArgs) -> AsyncIterator[str]:
        return _recognize_stream(args)

    async def aclose(self) -> None:
        await _aclose_openai_clients()


openai_provider: CompletionProvider = OpenAiProvider()
