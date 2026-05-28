"""Portkey gateway integration tests.

Covers the two layers that change when the toggle is flipped:

* ``Settings`` — env parsing, derived properties, fail-loud validation
* ``providers.openai_client`` — the single SDK factory builds an
  ``AsyncOpenAI`` pointed either at OpenAI directly or at the Portkey
  gateway, with the right ``x-portkey-*`` headers in the latter case.

The tests never make a real network call — they only inspect the
constructed client's ``base_url`` and ``default_headers``.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from inkwell_backend import settings as settings_mod
from inkwell_backend.providers import openai_client
from inkwell_backend.providers.openai_client import build_request_headers


@pytest.fixture(autouse=True)
def _reset_openai_clients() -> None:
    """Each test gets a clean client cache — otherwise the first test's
    AsyncOpenAI instance survives across test cases and masks toggle
    changes from later tests."""
    # Best-effort: close synchronously isn't an option, but the cache
    # only holds httpx clients that the event-loop teardown reaps.
    openai_client._clients.clear()


def _build_settings(**overrides: object) -> settings_mod.Settings:
    """Construct a Settings with the conftest defaults + overrides.

    Settings() reads env vars, which the conftest already pinned to
    safe defaults; instantiating again here picks them up.
    """
    settings_mod.get_settings.cache_clear()
    return settings_mod.Settings(**overrides)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Settings layer
# ---------------------------------------------------------------------------


def test_portkey_off_by_default() -> None:
    s = _build_settings()
    assert s.use_portkey is False
    assert s.portkey_enabled is False


def test_portkey_enabled_requires_key() -> None:
    """USE_PORTKEY=true without PORTKEY_API_KEY fails at startup."""
    with pytest.raises(ValidationError) as exc:
        _build_settings(use_portkey=True, portkey_api_key=None)
    # The error message should mention both knobs so the operator knows
    # which env var to set.
    msg = str(exc.value)
    assert "USE_PORTKEY" in msg
    assert "PORTKEY_API_KEY" in msg


def test_portkey_enabled_with_key() -> None:
    s = _build_settings(use_portkey=True, portkey_api_key="pk-test-1")
    assert s.portkey_enabled is True


def test_portkey_disabled_ignores_missing_key() -> None:
    """USE_PORTKEY=false should never trip the validator, regardless
    of whether other Portkey vars happen to be set."""
    s = _build_settings(
        use_portkey=False,
        portkey_api_key=None,
        portkey_virtual_key="vk-test",
    )
    assert s.portkey_enabled is False


def test_portkey_base_url_strips_trailing_slash() -> None:
    s = _build_settings(
        use_portkey=True,
        portkey_api_key="pk-test",
        portkey_base_url="https://gateway.example.com/v1/",
    )
    assert s.portkey_base_url == "https://gateway.example.com/v1"


def test_default_base_url_matches_sdk_constant() -> None:
    """Our default ``PORTKEY_BASE_URL`` must equal the URL the Portkey
    SDK ships as ``PORTKEY_GATEWAY_URL``.

    Why this test exists: the hardcoded default in ``settings.py``
    sidesteps importing ``portkey_ai`` at settings-load time (we
    lazy-import it elsewhere to keep cold-start fast for mock-only
    deployments). If the SDK ever bumps the URL (regional endpoint,
    v2 cutover, etc.), this test fires loud instead of silently
    routing to a stale URL — and the fix is to update the literal in
    settings.
    """
    from portkey_ai import PORTKEY_GATEWAY_URL

    s = _build_settings(use_portkey=True, portkey_api_key="pk-test")
    # Both sides normalised by trailing-slash strip — the SDK constant
    # is canonical, our setting strips trailing slashes via validator.
    assert s.portkey_base_url == PORTKEY_GATEWAY_URL.rstrip("/")


def test_has_openai_via_portkey_virtual_key() -> None:
    """With a virtual key, OPENAI_API_KEY may be blank and we still
    consider the upstream reachable — the gateway's vault provides
    the credential."""
    s = _build_settings(
        use_portkey=True,
        portkey_api_key="pk-test",
        portkey_virtual_key="vk-test",
        openai_api_key=None,
    )
    assert s.has_openai is True


def test_has_openai_via_portkey_forwarded_key() -> None:
    s = _build_settings(
        use_portkey=True,
        portkey_api_key="pk-test",
        portkey_virtual_key=None,
        openai_api_key="sk-test",
    )
    assert s.has_openai is True


def test_has_openai_false_when_neither_path_configured() -> None:
    """Portkey on but no virtual key and no OpenAI key — mock path."""
    s = _build_settings(
        use_portkey=True,
        portkey_api_key="pk-test",
        portkey_virtual_key=None,
        openai_api_key=None,
    )
    assert s.has_openai is False


# ---------------------------------------------------------------------------
# AsyncOpenAI client factory — both modes exercised end-to-end
# ---------------------------------------------------------------------------


def test_get_openai_client_default_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Portkey OFF: client points at the SDK's default OpenAI URL and
    carries no x-portkey-* headers."""
    monkeypatch.setenv("USE_PORTKEY", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings_mod.get_settings.cache_clear()

    client = openai_client.get_openai_client()
    # The SDK normalises base_url to a URL object; coerce to str for
    # comparison so we tolerate trailing-slash differences.
    assert "api.portkey.ai" not in str(client.base_url)
    portkey_headers = [k for k in client.default_headers if k.lower().startswith("x-portkey")]
    assert portkey_headers == []


def test_get_openai_client_portkey_path_with_virtual_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Portkey ON with a virtual key: client targets the gateway, sends
    the virtual-key header, and uses the placeholder api_key (the real
    upstream credential lives in Portkey's vault)."""
    monkeypatch.setenv("USE_PORTKEY", "true")
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY", "vk-openai")
    monkeypatch.setenv("PORTKEY_CONFIG", "cfg-abc")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    settings_mod.get_settings.cache_clear()

    client = openai_client.get_openai_client()
    assert "api.portkey.ai" in str(client.base_url)
    headers = {k.lower(): v for k, v in client.default_headers.items()}
    assert headers["x-portkey-api-key"] == "pk-test"
    assert headers["x-portkey-provider"] == "openai"
    assert headers["x-portkey-virtual-key"] == "vk-openai"
    assert headers["x-portkey-config"] == "cfg-abc"
    # api_key is the placeholder when a virtual key is in use — we never
    # expose the real virtual key as a Bearer token to the SDK.
    assert "PLACEHOLDER" in client.api_key


def test_get_openai_client_portkey_forwards_vendor_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Portkey ON without a virtual key: the vendor's own credential is
    passed to the SDK so Portkey can forward it as Authorization to the
    upstream provider."""
    monkeypatch.setenv("USE_PORTKEY", "true")
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-openai")
    settings_mod.get_settings.cache_clear()

    client = openai_client.get_openai_client()
    assert client.api_key == "sk-real-openai"


# ---------------------------------------------------------------------------
# Per-request trace header
# ---------------------------------------------------------------------------


def test_build_request_headers_off_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Portkey OFF: even with a trace id, no extra headers — the gateway
    is bypassed entirely."""
    monkeypatch.setenv("USE_PORTKEY", "false")
    settings_mod.get_settings.cache_clear()

    assert build_request_headers("abc-123") is None


def test_build_request_headers_off_when_no_trace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """Portkey ON but no trace id: nothing to forward, gateway mints its own."""
    monkeypatch.setenv("USE_PORTKEY", "true")
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    settings_mod.get_settings.cache_clear()

    assert build_request_headers(None) is None
    assert build_request_headers("") is None


def test_build_request_headers_forwards_trace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USE_PORTKEY", "true")
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    settings_mod.get_settings.cache_clear()

    headers = build_request_headers("req-abc-123")
    assert headers == {"x-portkey-trace-id": "req-abc-123"}
