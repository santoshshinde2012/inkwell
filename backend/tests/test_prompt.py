"""Prompt-builder unit tests — verify the action-specific strategies."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from inkwell_backend.domain.actions import Action
from inkwell_backend.domain.schemas import CompleteRequest, Post, RequestContext
from inkwell_backend.domain.tones import TonePreset
from inkwell_backend.services.prompt import build_prompt


def _reply_request(**overrides: object) -> CompleteRequest:
    """Build a minimal valid reply request, overridable per case."""
    defaults = {
        "action": Action.REPLY,
        "context": RequestContext(post=Post(text="hi there")),
    }
    defaults.update(overrides)
    return CompleteRequest.model_validate(defaults)


def test_reply_wraps_context_in_untrusted_block() -> None:
    prompt = build_prompt(_reply_request())
    assert "<UNTRUSTED_CONTEXT>" in prompt.user
    assert "</UNTRUSTED_CONTEXT>" in prompt.user
    assert "hi there" in prompt.user


def test_reply_tone_appended_to_system() -> None:
    req = _reply_request(tone=TonePreset.PROFESSIONAL)
    prompt = build_prompt(req)
    assert "polished, business-appropriate" in prompt.system


def test_translate_strips_structural_labels_from_user_message() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.TRANSLATE,
            "targetLanguage": "fr",
            "context": {
                "site": "example.com",
                "pageTitle": "Order #42",
                "thread": [
                    {"author": "Carla", "text": "Mon colis n'est pas arrivé."},
                ],
            },
        }
    )
    prompt = build_prompt(req)
    # Site / pageTitle / author lines must NOT leak into the
    # translate user message — those would get translated too.
    assert "Site:" not in prompt.user
    assert "Order #42" not in prompt.user
    assert "Carla" not in prompt.user
    assert "Mon colis n'est pas arrivé." in prompt.user
    # Target language is named in the system instruction.
    assert "French" in prompt.system


def test_grammar_requires_draft_and_keeps_source_language() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.GRAMMAR,
            "context": {"draft": "i goes home"},
            "sourceLanguage": "en",
        }
    )
    prompt = build_prompt(req)
    assert "Never translate" in prompt.system
    assert "i goes home" in prompt.user


def test_rewrite_compose_mode_when_only_instruction_supplied() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.REWRITE,
            "instruction": "Write a polite decline.",
            "context": {"post": {"text": "Hey, can you help on Saturday?"}},
        }
    )
    prompt = build_prompt(req)
    # Compose-mode system prompt mentions "write a piece of text".
    assert "write a piece of text" in prompt.system.lower()
    assert "Saturday" in prompt.user


def test_summarize_wraps_context_and_does_not_reply() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.SUMMARIZE,
            "context": {"post": {"text": "Long update about the Q3 roadmap and three blockers."}},
        }
    )
    prompt = build_prompt(req)
    assert "summarize" in prompt.system.lower()
    assert "<UNTRUSTED_CONTEXT>" in prompt.user
    assert "Q3 roadmap" in prompt.user


def test_explain_uses_draft_when_no_page_context() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.EXPLAIN,
            "context": {"draft": "Per my last email, kindly expedite the EOD deliverable."},
        }
    )
    prompt = build_prompt(req)
    assert "explain" in prompt.system.lower()
    assert "EOD deliverable" in prompt.user


@pytest.mark.parametrize("action", [Action.SUMMARIZE, Action.EXPLAIN])
def test_summarize_explain_require_content(action: Action) -> None:
    with pytest.raises(ValidationError):
        CompleteRequest.model_validate({"action": action, "context": {}})


def test_refinement_history_appended_to_user_message() -> None:
    req = CompleteRequest.model_validate(
        {
            "action": Action.REPLY,
            "context": {"post": {"text": "Can you join the call tomorrow?"}},
            "instruction": "make it shorter",
            "history": [
                {
                    "role": "assistant",
                    "text": "Absolutely — I'd be glad to join the call tomorrow.",
                },
            ],
        }
    )
    prompt = build_prompt(req)
    assert "Earlier in this conversation" in prompt.user
    assert "glad to join the call" in prompt.user
    assert "revised text" in prompt.user.lower()
    # The current instruction still rides on the task message.
    assert "make it shorter" in prompt.user


def test_no_history_leaves_user_message_unchanged() -> None:
    base = build_prompt(_reply_request())
    assert "Earlier in this conversation" not in base.user
