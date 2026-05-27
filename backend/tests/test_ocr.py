"""POST /api/v1/ocr smoke tests — mock provider path only.

Real OpenAI calls are out of scope here; the mock branch in
``services.ocr`` returns a deterministic placeholder when
``OPENAI_API_KEY`` is unset, which the conftest's Settings honours.
"""

from __future__ import annotations

import base64

from fastapi.testclient import TestClient

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
