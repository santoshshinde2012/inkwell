"""POST /api/v1/ocr smoke tests — mock provider path only.

Real OpenAI calls are out of scope here; the mock branch in
``services.ocr`` returns a deterministic placeholder when
``OPENAI_API_KEY`` is unset, which the conftest's Settings honours.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from inkwell_backend.services import audit as audit_mod
from inkwell_backend.services.audit import OcrLogEvent

# A 1×1 transparent PNG — smallest valid image we can ship without a
# fixture file.
_TINY_PNG = base64.b64encode(
    bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
        "8900000019744558745265616C6C7920536D616C6C20505047C30D0A1A0A"
        "0000000C4944415478DA63F8FF1F00050B020155F1F0FD0000000049454E"
        "44AE426082"
    )
).decode()


def test_ocr_returns_mock_text_when_no_api_key(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "mock OCR text" in body["text"]


def test_ocr_rejects_unknown_mime_type(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/bmp"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_ocr_rejects_unknown_fields(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ocr",
        json={
            "imageBase64": _TINY_PNG,
            "mimeType": "image/png",
            "extra": "should not be here",
        },
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_ocr_streams_sse_when_client_accepts_event_stream(client: TestClient) -> None:
    """A client opting in via Accept: text/event-stream gets the SSE
    contract: ``event: token`` frames with delta text, terminated by
    an ``event: done`` frame."""
    response = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.text
    # The mock provider yields three chunks; each is its own token frame.
    assert "event: token" in body
    assert "mock OCR text" in body
    assert "event: done" in body


@pytest.fixture
def captured_ocr_events(monkeypatch: pytest.MonkeyPatch) -> list[OcrLogEvent]:
    """Capture every ``log_ocr`` call for the duration of one test.

    Mirrors the ``captured_events`` fixture in ``test_audit.py`` —
    we patch both the source module and the import the OCR pipeline
    grabbed at module-load time so neither path slips past us.

    Also flushes the in-process OCR result cache so a previous test
    (which uses the same ``_TINY_PNG``) doesn't turn a cache miss
    into a cache hit and skew the audit assertions.
    """
    events: list[OcrLogEvent] = []

    def _capture(event: OcrLogEvent) -> None:
        events.append(event)

    monkeypatch.setattr(audit_mod, "log_ocr", _capture)
    from inkwell_backend.services import ocr as ocr_mod
    from inkwell_backend.services.ocr_cache import ocr_result_cache

    monkeypatch.setattr(ocr_mod, "log_ocr", _capture)
    ocr_result_cache.clear()
    return events


def test_ocr_audit_records_success(
    client: TestClient, captured_ocr_events: list[OcrLogEvent]
) -> None:
    """A successful JSON-path OCR call emits one audit event with
    status=200 and the recognised text's character count."""
    response = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
    )
    assert response.status_code == 200

    assert len(captured_ocr_events) == 1
    event = captured_ocr_events[0]
    assert event.status == 200
    assert event.streamed is False
    assert event.cache_hit is False
    assert event.response_chars == len(response.json()["text"])
    # Mock branch — no real upstream, so via_portkey is None per the
    # same rule the completion audit uses.
    assert event.via_portkey is None


def test_ocr_audit_marks_cache_hit_and_streaming_separately(
    client: TestClient, captured_ocr_events: list[OcrLogEvent]
) -> None:
    """First call → cache miss (cache_hit=False, streamed=False).
    Second call (same image, Accept: text/event-stream) → cache hit
    on the streaming path (cache_hit=True, streamed=True)."""
    client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
    )
    client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
        headers={"Accept": "text/event-stream"},
    )

    assert len(captured_ocr_events) == 2
    miss, hit = captured_ocr_events
    assert miss.cache_hit is False
    assert miss.streamed is False
    assert hit.cache_hit is True
    assert hit.streamed is True
    assert hit.status == 200


def test_ocr_streaming_cache_hit_emits_full_text_in_one_frame(client: TestClient) -> None:
    """Second streaming call for the same image is a cache hit: the
    cached response is emitted as a single ``token`` event so the
    incremental client parser doesn't have to branch on cache state."""
    # Prime the cache via the JSON path so we know exactly what text is
    # stored — easier to assert against than reassembling from chunks.
    primer = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
    )
    assert primer.status_code == 200
    cached_text = primer.json()["text"]

    response = client.post(
        "/api/v1/ocr",
        json={"imageBase64": _TINY_PNG, "mimeType": "image/png"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    body = response.text
    assert body.count("event: token") == 1
    assert cached_text in body
    assert "event: done" in body
