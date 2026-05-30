"""Pydantic v2 DTOs.

Mirrors the zod schemas in `@inkwell/shared/schemas`. Every request and
response that crosses the HTTP boundary has a Pydantic model here, so:

* the OpenAPI schema FastAPI generates is automatically accurate;
* misshaped requests fail at the boundary with a 400, never reach
  downstream code;
* the same DTOs are reused inside the pipelines for type-safe access.

Constraints:

* `model_config = ConfigDict(extra="forbid")` mirrors zod's ``.strict()``
  so unknown keys raise validation errors instead of being silently
  accepted (defence-in-depth against the client smuggling fields).
* Cross-field rules use ``@model_validator(mode="after")`` — Pydantic's
  equivalent of zod's ``.refine()``.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from .actions import Action
from .languages import AUTO_DETECT, LANGUAGE_IDS, SOURCE_LANGUAGE_IDS
from .limits import (
    MAX_CONTEXT_CHARS,
    MAX_DRAFT_CHARS,
    MAX_HISTORY_TURN_CHARS,
    MAX_HISTORY_TURNS,
    MAX_INSTRUCTION_CHARS,
    MAX_MODEL_ID_CHARS,
    MAX_OCR_IMAGE_BYTES,
)
from .models import MODEL_IDS
from .tones import TonePreset

# Bare-string constraint helpers — Pydantic equivalents of zod's
# ``.max(...)``. Keeping them named so the schema reads like prose.
SiteName = Annotated[str, StringConstraints(min_length=1, max_length=120)]
PageTitle = Annotated[str, StringConstraints(max_length=300)]
PageUrl = Annotated[AnyHttpUrl, Field(max_length=2048)]
Author = Annotated[str, StringConstraints(max_length=200)]
ContextText = Annotated[str, StringConstraints(max_length=MAX_CONTEXT_CHARS)]
DraftText = Annotated[str, StringConstraints(max_length=MAX_DRAFT_CHARS)]
InstructionText = Annotated[str, StringConstraints(max_length=MAX_INSTRUCTION_CHARS)]
MetaValue = Annotated[str, StringConstraints(max_length=500)]
Timestamp = Annotated[str, StringConstraints(max_length=64)]

# Allowed image MIME types — whitelisted so a malicious client can't smuggle
# SVG (XSS surface) or arbitrary binary blobs through the OCR endpoint.
OCR_MIME_TYPES: tuple[str, ...] = (
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
)
OcrMimeType = Literal["image/png", "image/jpeg", "image/webp", "image/gif"]

# Language enum types — the literal unions are derived from the catalogs
# so the schemas stay in sync with the source of truth.
LanguageId = Annotated[str, Field(json_schema_extra={"enum": list(LANGUAGE_IDS)})]
SourceLanguage = Annotated[str, Field(json_schema_extra={"enum": list(SOURCE_LANGUAGE_IDS)})]
# Bounded charset + length so even the relaxed Portkey path (below) can't
# accept an unbounded or exotic string. Covers catalog ids (``gpt-4o``)
# and Portkey model-catalog slugs (``@bedrock-use1/us.anthropic.claude``).
# The ``enum`` hint documents the curated direct-OpenAI catalog in OpenAPI;
# the cross-field validator decides whether non-catalog ids are allowed.
ModelId = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MAX_MODEL_ID_CHARS, pattern=r"^[A-Za-z0-9._:@/-]+$"),
    Field(json_schema_extra={"enum": list(MODEL_IDS)}),
]


class ThreadMessage(BaseModel):
    """A single message in a threaded conversation extracted from the page."""

    model_config = ConfigDict(extra="forbid")

    author: Author | None = None
    text: ContextText
    timestamp: Timestamp | None = None


class Post(BaseModel):
    """A single post / comment the user is responding to."""

    model_config = ConfigDict(extra="forbid")

    author: Author | None = None
    text: ContextText


class RequestContext(BaseModel):
    """Page context extracted by the in-page adapter.

    Each field is optional because adapters extract what they can; the
    prompt builder copes with missing pieces.
    """

    model_config = ConfigDict(extra="forbid")

    site: SiteName | None = None
    page_title: PageTitle | None = Field(default=None, alias="pageTitle")
    page_url: PageUrl | None = Field(default=None, alias="pageUrl")
    thread: list[ThreadMessage] | None = Field(default=None, max_length=40)
    post: Post | None = None
    draft: DraftText | None = None
    meta: dict[str, MetaValue] | None = None


HistoryTurnText = Annotated[str, StringConstraints(min_length=1, max_length=MAX_HISTORY_TURN_CHARS)]


class ConversationTurn(BaseModel):
    """One prior turn in a refinement conversation.

    The client replays earlier turns — its own task message(s) and the
    assistant's previous draft(s) — so a follow-up like "make it shorter"
    revises the existing output instead of starting from scratch. Roles
    mirror the chat convention; ``system`` is intentionally excluded so a
    client can never inject a competing system prompt.
    """

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    text: HistoryTurnText


class RequestProfile(BaseModel):
    """Optional personalization the extension attaches from local storage."""

    model_config = ConfigDict(extra="forbid")

    display_name: Annotated[str, StringConstraints(max_length=120)] | None = Field(
        default=None,
        alias="displayName",
    )
    about_me: Annotated[str, StringConstraints(max_length=2000)] | None = Field(
        default=None,
        alias="aboutMe",
    )


class CompleteRequest(BaseModel):
    """Body of POST /api/v1/complete."""

    # `populate_by_name` lets pipeline code read snake_case attributes
    # while client requests stay camelCase on the wire.
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    action: Action
    context: RequestContext
    tone: TonePreset | None = None
    instruction: InstructionText | None = None
    model: ModelId | None = None
    source_language: SourceLanguage | None = Field(default=None, alias="sourceLanguage")
    target_language: LanguageId | None = Field(default=None, alias="targetLanguage")
    bilingual: bool | None = None
    # Prior turns for conversational refinement. Empty/omitted for the
    # first request; populated when the user iterates on a result.
    history: list[ConversationTurn] | None = Field(default=None, max_length=MAX_HISTORY_TURNS)
    profile: RequestProfile | None = None
    client_request_id: Annotated[str, Field(pattern=r"^[0-9a-fA-F-]{36}$")] | None = Field(
        default=None,
        alias="clientRequestId",
    )

    @field_validator("source_language")
    @classmethod
    def _source_language_in_catalog(cls, value: str | None) -> str | None:
        if value is None or value == AUTO_DETECT or value in LANGUAGE_IDS:
            return value
        raise ValueError(f"Unknown sourceLanguage: {value!r}")

    @field_validator("target_language")
    @classmethod
    def _target_language_in_catalog(cls, value: str | None) -> str | None:
        if value is None or value in LANGUAGE_IDS:
            return value
        raise ValueError(f"Unknown targetLanguage: {value!r}")

    @field_validator("model")
    @classmethod
    def _model_in_catalog(cls, value: str | None) -> str | None:
        if value is None or value in MODEL_IDS:
            return value
        # When Portkey is enabled the gateway owns model routing —
        # virtual keys and model-catalog slugs ("@integration/model")
        # reference upstreams the backend has no catalog for. Accept any
        # well-formed id (charset/length already bounded by ``ModelId``)
        # and let the gateway validate it. Direct OpenAI stays strict so
        # a typo fails fast at the boundary instead of burning a call.
        from ..settings import get_settings

        if get_settings().portkey_enabled:
            return value
        raise ValueError(f"Unknown model: {value!r}")

    @model_validator(mode="after")
    def _action_specific_content(self) -> Self:
        ctx = self.context
        has_draft = bool(ctx.draft and len(ctx.draft) > 0)
        has_instruction = bool(self.instruction and self.instruction.strip())
        has_page_context = bool((ctx.thread and len(ctx.thread) > 0) or ctx.post)

        if self.action is Action.GRAMMAR and not has_draft:
            raise ValueError("'grammar' action requires `context.draft` to be provided.")
        if self.action is Action.TRANSLATE:
            if not (has_draft or has_page_context):
                raise ValueError("'translate' action needs text in context.draft / thread / post.")
            if not self.target_language:
                raise ValueError("'translate' action requires `targetLanguage`.")
        if self.action is Action.REWRITE and not (has_draft or has_instruction or has_page_context):
            raise ValueError(
                "'rewrite' action needs at least one of context.draft, instruction, "
                "or context.thread/post."
            )
        if self.action is Action.REPLY and not has_page_context:
            raise ValueError("'reply' action requires context.thread or context.post.")
        if self.action in (Action.SUMMARIZE, Action.EXPLAIN) and not (
            has_draft or has_page_context
        ):
            raise ValueError(
                f"'{self.action.value}' action needs text in context.draft / thread / post."
            )
        return self


# ---------------------------------------------------------------------------
# SSE payloads — what the /complete stream emits.
# ---------------------------------------------------------------------------


class SseTokenPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    delta: str


class SseUsagePayload(BaseModel):
    # `populate_by_name` so the pipeline can construct this with
    # Python-natural snake_case kwargs; ``model_dump(by_alias=True)``
    # still emits camelCase on the wire.
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    prompt_tokens: Annotated[int, Field(ge=0, alias="promptTokens")]
    completion_tokens: Annotated[int, Field(ge=0, alias="completionTokens")]
    total_tokens: Annotated[int, Field(ge=0, alias="totalTokens")]
    model: str


class SseErrorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool


# ---------------------------------------------------------------------------
# /api/v1/ocr
# ---------------------------------------------------------------------------


_MAX_OCR_B64_LEN = ((MAX_OCR_IMAGE_BYTES * 4) + 2) // 3 + 32


class OcrRequest(BaseModel):
    """Body of POST /api/v1/ocr."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    image_base64: Annotated[
        str,
        StringConstraints(
            min_length=64,
            max_length=_MAX_OCR_B64_LEN,
            pattern=r"^[A-Za-z0-9+/=\s]+$",
        ),
    ] = Field(alias="imageBase64")
    mime_type: OcrMimeType = Field(alias="mimeType")


class OcrResponse(BaseModel):
    """Body of a successful /api/v1/ocr 200."""

    model_config = ConfigDict(extra="forbid")

    text: str
    model: str | None = None


# ---------------------------------------------------------------------------
# /api/v1/health
# ---------------------------------------------------------------------------


class Health(BaseModel):
    """Body of a successful /api/v1/health 200."""

    model_config = ConfigDict(extra="forbid")

    ok: Literal[True]
    version: str
    runtime: str
    timestamp: str
