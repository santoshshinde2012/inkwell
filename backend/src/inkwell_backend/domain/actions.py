"""Actions the user can trigger from the popover.

Mirrors `@inkwell/shared/actions`. `Action` is a string-valued enum so
Pydantic validates request payloads against the same set the TypeScript
backend does, and IDE autocomplete still works inside the codebase.
"""

from __future__ import annotations

from enum import StrEnum


class Action(StrEnum):
    """Every action surface the extension can request from the backend."""

    # Draft a contextual response to a conversation.
    REPLY = "reply"
    # Fix grammar/spelling in the user's draft, in its own language.
    GRAMMAR = "grammar"
    # Transform / compose / light-edit text (optionally into a new language).
    REWRITE = "rewrite"
    # Render a customer query (or any text) in a chosen language.
    TRANSLATE = "translate"
