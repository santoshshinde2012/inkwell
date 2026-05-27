"""Audit log shape — focuses on fields that are easy to mis-wire.

The audit module itself is a thin logger; what we want to lock down
here is that the completion pipeline populates the right dimensions
in :class:`CompletionLogEvent` so observability tooling stays meaningful.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from inkwell_backend.services import audit as audit_mod
from inkwell_backend.services.audit import CompletionLogEvent


@pytest.fixture
def captured_events(
    monkeypatch: pytest.MonkeyPatch,
) -> list[CompletionLogEvent]:
    """Replace ``log_completion`` with a recorder for the duration of
    one test — avoids parsing JSON log lines just to assert on fields."""
    events: list[CompletionLogEvent] = []

    def _capture(event: CompletionLogEvent) -> None:
        events.append(event)

    monkeypatch.setattr(audit_mod, "log_completion", _capture)
    # The completion pipeline imports ``log_completion`` by name at
    # module load time, so patch the imported reference too.
    from inkwell_backend.services import completion as completion_mod

    monkeypatch.setattr(completion_mod, "log_completion", _capture)
    return events


def _drain_stream(response: Any) -> None:
    # Consume the SSE body so the pipeline's ``finally`` block runs
    # (that's where ``log_completion`` is called).
    b"".join(response.iter_bytes())


def test_audit_via_portkey_is_none_on_mock(
    client: TestClient, captured_events: list[CompletionLogEvent]
) -> None:
    """No real upstream was hit — ``via_portkey`` is left null so
    operators don't read it as a "direct" call."""
    with client.stream(
        "POST",
        "/api/v1/complete",
        json={
            "action": "reply",
            "context": {"post": {"author": "Carla", "text": "Hi"}},
        },
    ) as response:
        _drain_stream(response)

    assert len(captured_events) == 1
    assert captured_events[0].via_portkey is None


def test_audit_carries_client_request_id(
    client: TestClient, captured_events: list[CompletionLogEvent]
) -> None:
    """Header-sourced request id flows into the audit log so a single
    id correlates client ↔ backend ↔ (future) Portkey gateway."""
    rid = "11111111-2222-3333-4444-555555555555"
    with client.stream(
        "POST",
        "/api/v1/complete",
        json={
            "action": "reply",
            "context": {"post": {"author": "Carla", "text": "Hi"}},
        },
        headers={"X-Client-Request-Id": rid},
    ) as response:
        _drain_stream(response)

    assert captured_events[0].client_request_id == rid
