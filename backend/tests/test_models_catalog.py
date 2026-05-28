"""Tests for the model catalog loader.

Covers the validation gates that protect the runtime from a malformed
config file. The loader is exercised via the pure ``parse_catalog``
function; the module-level load is checked indirectly by the rest of
the test suite (every test imports ``inkwell_backend``, which imports
this module, which loads the JSON).
"""

from __future__ import annotations

import json
from importlib.resources import files

import pytest
from pydantic import ValidationError

from inkwell_backend.domain.models import (
    DEFAULT_MODEL_ID,
    MODEL_CATALOG,
    MODEL_IDS,
    ModelInfo,
    ModelProvider,
    parse_catalog,
)

# A complete, valid row used as a fixture base for the negative tests
# below — each test mutates one field rather than re-typing the whole
# document.
_VALID_ROW: dict[str, str] = {
    "id": "gpt-4o-mini",
    "label": "GPT-4o mini",
    "provider": "openai",
    "description": "Fast and economical.",
    "tier": "fast",
}


def _doc(*, default: str = "gpt-4o-mini", **row_overrides: object) -> dict[str, object]:
    """Build a one-row catalog doc with optional row overrides."""
    row = {**_VALID_ROW, **row_overrides}
    return {"default": default, "models": [row]}


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_load_from_packaged_json() -> None:
    """The module-level load should produce a non-empty, frozen catalog."""
    assert len(MODEL_CATALOG) >= 1
    assert all(isinstance(m, ModelInfo) for m in MODEL_CATALOG)
    assert DEFAULT_MODEL_ID in MODEL_IDS


def test_packaged_json_matches_module_state() -> None:
    """The on-disk JSON and the loaded catalog don't drift mid-test."""
    raw = json.loads(
        files("inkwell_backend.config").joinpath("models.catalog.json").read_text(encoding="utf-8")
    )
    entries, default = parse_catalog(raw)
    assert entries == MODEL_CATALOG
    assert default == DEFAULT_MODEL_ID


def test_parse_minimal_valid_catalog() -> None:
    entries, default = parse_catalog(_doc())
    assert default == "gpt-4o-mini"
    assert len(entries) == 1
    assert entries[0].id == "gpt-4o-mini"
    assert entries[0].provider is ModelProvider.OPENAI


def test_parse_ignores_top_level_schema_pointer() -> None:
    """The ``$schema`` editor hint in the JSON file is tolerated."""
    doc = _doc()
    doc["$schema"] = "./models.catalog.schema.json"
    entries, _ = parse_catalog(doc)
    assert entries[0].id == "gpt-4o-mini"


# ---------------------------------------------------------------------------
# Invariants
# ---------------------------------------------------------------------------


def test_default_must_be_in_models() -> None:
    """A ``default`` not present in ``models`` fails loud."""
    with pytest.raises(ValidationError) as exc:
        parse_catalog(_doc(default="not-a-real-id"))
    assert "not-a-real-id" in str(exc.value)


def test_unknown_provider_rejected() -> None:
    """The provider enum gate refuses unregistered providers at load."""
    with pytest.raises(ValidationError):
        parse_catalog(_doc(provider="anthropic"))


def test_empty_models_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_catalog({"default": "x", "models": []})


def test_missing_required_field_rejected() -> None:
    """``label`` is mandatory — dropping it should fail shape validation."""
    row = {k: v for k, v in _VALID_ROW.items() if k != "label"}
    with pytest.raises(ValidationError):
        parse_catalog({"default": "gpt-4o-mini", "models": [row]})


def test_unknown_tier_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_catalog(_doc(tier="legendary"))


def test_extra_field_on_row_rejected() -> None:
    """Rows use ``extra='forbid'`` — typos in field names fail fast
    instead of being silently dropped."""
    with pytest.raises(ValidationError):
        parse_catalog(_doc(typo="oops"))


def test_id_too_long_rejected() -> None:
    """Wire-side ``ModelIdField`` caps ids at 120 chars; the catalog
    enforces the same upper bound so a too-long id can't be added
    here and then rejected at the API boundary."""
    with pytest.raises(ValidationError):
        parse_catalog(_doc(id="x" * 121))


def test_blank_id_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_catalog(_doc(id=""))
