"""Model catalog — the single source of truth for which models the
product supports and which provider serves each.

Mirrors `@inkwell/shared/models`. Order matters: the first entry is the
product default.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal


class ModelProvider(StrEnum):
    """Every distinct upstream a model can be served by.

    Add a member here to onboard a new integration (e.g. ``ANTHROPIC =
    "anthropic"``); the provider registry is keyed on this enum, so the
    type-checker will then force a matching provider to be registered.
    """

    OPENAI = "openai"


ModelTier = Literal["fast", "balanced", "quality"]


@dataclass(frozen=True, slots=True)
class ModelInfo:
    """Catalog entry for a single model."""

    id: str
    """Stable id sent in API requests and stored in extension settings."""

    label: str
    """Human-readable name shown in the extension's model picker."""

    provider: ModelProvider
    """Which upstream serves this model."""

    description: str
    """One-line blurb shown under the label in the picker."""

    tier: ModelTier
    """Coarse speed/quality bucket — lets the UI sort/group sensibly."""


# The catalog. Order matters: the first entry is the product default.
MODEL_CATALOG: tuple[ModelInfo, ...] = (
    ModelInfo(
        id="gpt-4o-mini",
        label="GPT-4o mini",
        provider=ModelProvider.OPENAI,
        description="Fast and economical — great for everyday replies.",
        tier="fast",
    ),
    ModelInfo(
        id="gpt-4o",
        label="GPT-4o",
        provider=ModelProvider.OPENAI,
        description="Higher quality, a little slower — for nuanced or long-form writing.",
        tier="quality",
    ),
)

MODEL_IDS: tuple[str, ...] = tuple(m.id for m in MODEL_CATALOG)
DEFAULT_MODEL_ID: str = MODEL_CATALOG[0].id


def get_model_info(model_id: str) -> ModelInfo | None:
    """Look up a model's metadata by id. Returns ``None`` for unknown ids."""
    return next((m for m in MODEL_CATALOG if m.id == model_id), None)


def is_model_id(model_id: object) -> bool:
    """True when ``model_id`` is a known catalog id."""
    return isinstance(model_id, str) and any(m.id == model_id for m in MODEL_CATALOG)


def provider_for_model(model_id: str) -> ModelProvider:
    """Provider that serves a given model id (falls back to the default)."""
    info = get_model_info(model_id)
    return info.provider if info is not None else MODEL_CATALOG[0].provider
