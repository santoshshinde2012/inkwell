"""GET /api/v1/health smoke tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_returns_ok_payload(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["runtime"] == "fastapi"
    assert "version" in body
    assert "timestamp" in body


def test_health_options_preflight_returns_204(client: TestClient) -> None:
    # No Origin header → same-origin assumed → preflight succeeds.
    response = client.options("/api/v1/health")
    assert response.status_code == 204


def test_health_rejects_disallowed_origin(client: TestClient) -> None:
    response = client.get(
        "/api/v1/health",
        headers={"origin": "https://evil.example"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "ORIGIN_NOT_ALLOWED"
