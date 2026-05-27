"""Health (live / ready) + meta (version / models) endpoint tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_live_returns_ok_payload(client: TestClient) -> None:
    response = client.get("/api/v1/live")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["runtime"] == "fastapi"


def test_ready_returns_ok_after_lifespan_startup(client: TestClient) -> None:
    # The ``TestClient`` context manager triggers the lifespan startup
    # hook, which flips the readiness flag. We're already inside that
    # context here, so /ready should already be reporting 200.
    response = client.get("/api/v1/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True


def test_version_returns_metadata(client: TestClient) -> None:
    response = client.get("/api/v1/version")
    assert response.status_code == 200
    body = response.json()
    assert "version" in body
    assert body["runtime"] == "fastapi"
    assert "boot_at" in body


def test_models_returns_catalog(client: TestClient) -> None:
    response = client.get("/api/v1/models")
    assert response.status_code == 200
    body = response.json()
    assert "default" in body
    assert isinstance(body["models"], list)
    assert len(body["models"]) >= 1
    first = body["models"][0]
    # Catalog entries carry the full shape the extension's picker reads.
    assert {"id", "label", "provider", "description", "tier"} <= set(first)


def test_post_route_without_origin_is_rejected(client: TestClient) -> None:
    """Cost-incurring POST routes must reject missing-Origin requests
    even though same-origin GETs are allowed without one."""
    # The default fixture sets an Origin header; override to drop it.
    response = client.post(
        "/api/v1/complete",
        json={
            "action": "grammar",
            "context": {"draft": "hello"},
        },
        headers={"origin": ""},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "ORIGIN_NOT_ALLOWED"
