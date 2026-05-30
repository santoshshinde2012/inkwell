"""Model catalog — loaded from the canonical JSON config.

The catalog data lives in ``inkwell_backend/config/models.catalog.json``
and is the **single source of truth** for both the backend and the
extension's bundled fallback (the build step that wires this up lives
at ``frontend/packages/shared/scripts/sync-config.mjs``).

Why not a Python literal? Two reasons:

1. The frontend needs to embed the same catalog as a build-time
   fallback. A JSON file can be read by both ``json.load`` and
   TypeScript's ``resolveJsonModule`` with no codegen, keeping the
   two sides in step without runtime coupling.
2. The catalog is data, not behaviour. Keeping it out of code makes
   the "add a model" change a single-line diff a non-Python author
   can land confidently.

Validation runs at module import:

* JSON is parsed and shape-checked via a Pydantic model.
* Every ``provider`` field must resolve to a registered
  :class:`ModelProvider` enum value — a typo or unwired provider
  fails startup loudly instead of falling through to a default at
  the first request.
* ``default`` must reference a model id that's actually in the list.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .limits import MAX_MODEL_ID_CHARS


class ModelProvider(StrEnum):
    """Every distinct upstream a model can be served by.

    Add a member here to onboard a new integration (e.g.
    ``ANTHROPIC = "anthropic"``); the provider registry is keyed on
    this enum so the type-checker will then force a matching provider
    to be registered. The catalog JSON's ``provider`` field is
    validated against this enum at module load, so a typo there fails
    startup rather than at first request.
    """

    OPENAI = "openai"


ModelTier = Literal["fast", "balanced", "quality"]


@dataclass(frozen=True, slots=True)
class ModelInfo:
    """Catalog entry for a single model — the public type that the
    rest of the backend works with. Built from the validated JSON via
    :class:`_CatalogEntry` so consumers see a frozen dataclass and
    never a mutable Pydantic instance."""

    id: str
    label: str
    provider: ModelProvider
    description: str
    tier: ModelTier


# ---------------------------------------------------------------------------
# JSON-side schema (Pydantic). Lives in this module so the load-time
# validation that turns the JSON into ``ModelInfo`` instances stays
# colocated with the public types.
# ---------------------------------------------------------------------------


class _CatalogEntry(BaseModel):
    """Shape of a single ``models[*]`` row in the JSON file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1, max_length=MAX_MODEL_ID_CHARS)
    label: str = Field(min_length=1, max_length=80)
    provider: ModelProvider
    description: str = Field(max_length=300)
    tier: ModelTier


class _CatalogFile(BaseModel):
    """Shape of the top-level JSON document."""

    # Tolerate the editor ``$schema`` pointer at the top of the file —
    # consumers ignore it but a forbid-extra config would reject it.
    model_config = ConfigDict(extra="ignore", frozen=True)

    default: str = Field(min_length=1)
    models: tuple[_CatalogEntry, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _default_in_models(self) -> _CatalogFile:
        ids = {m.id for m in self.models}
        if self.default not in ids:
            raise ValueError(
                f"default model id {self.default!r} is not in the catalog (known: {sorted(ids)})"
            )
        return self


# ---------------------------------------------------------------------------
# Load + freeze the catalog at import time.
#
# Parsing is split into a pure ``parse_catalog(raw)`` function so unit
# tests can exercise every failure mode (bad default, unknown provider,
# malformed shape) without writing scratch files. The module-level
# ``_load_catalog`` is a thin wrapper that locates the packaged JSON
# and hands its body to ``parse_catalog``.
# ---------------------------------------------------------------------------


_CATALOG_FILENAME = "models.catalog.json"


def parse_catalog(raw: object) -> tuple[tuple[ModelInfo, ...], str]:
    """Validate a raw catalog dict and freeze it.

    Returns ``(catalog_entries, default_id)``. Raises
    :class:`pydantic.ValidationError` on any of the gated invariants:

    * Shape: every row has the required fields with the right types.
    * Provider: every row's ``provider`` resolves to a registered
      :class:`ModelProvider` enum value.
    * Default: ``default`` references a model id in ``models``.
    * Non-empty: at least one row.

    Pure — no IO, no caching, safe to call from tests with arbitrary
    inputs.
    """
    parsed = _CatalogFile.model_validate(raw)
    entries = tuple(
        ModelInfo(
            id=row.id,
            label=row.label,
            provider=row.provider,
            description=row.description,
            tier=row.tier,
        )
        for row in parsed.models
    )
    return entries, parsed.default


def _load_catalog() -> tuple[tuple[ModelInfo, ...], str]:
    """Read the packaged JSON file and validate it via :func:`parse_catalog`.

    Uses ``importlib.resources`` so the file resolves correctly in
    every distribution form: editable install, built wheel, and
    container image. The wheel target in ``pyproject.toml`` packages
    the JSON alongside the module.
    """
    resource = files("inkwell_backend.config").joinpath(_CATALOG_FILENAME)
    raw = json.loads(resource.read_text(encoding="utf-8"))
    return parse_catalog(raw)


MODEL_CATALOG, DEFAULT_MODEL_ID = _load_catalog()
"""The validated catalog. Order matches the JSON file."""

MODEL_IDS: tuple[str, ...] = tuple(m.id for m in MODEL_CATALOG)


def _get_model_info(model_id: str) -> ModelInfo | None:
    """Look up a model's metadata by id. Returns ``None`` for unknown ids."""
    return next((m for m in MODEL_CATALOG if m.id == model_id), None)


def provider_for_model(model_id: str) -> ModelProvider:
    """Provider that serves a given model id (falls back to the default).

    The fallback is intentional: callers that didn't pre-validate the
    id (none today, but a future internal pipeline might) still get a
    routable result. The schema layer rejects unknown ids at the
    request boundary, so the fallback is unreachable from the wire.
    """
    info = _get_model_info(model_id)
    return info.provider if info is not None else MODEL_CATALOG[0].provider
