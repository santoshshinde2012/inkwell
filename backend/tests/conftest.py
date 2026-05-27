"""Shared pytest fixtures.

* ``client``  — FastAPI TestClient wired to a fresh app instance per
                test (avoids state bleed between tests, e.g. rate-
                limiter counters). The client's default headers include
                a valid extension Origin so POST routes pass the
                "Origin required on writes" gate; tests that want to
                exercise the missing-Origin path can override headers
                per request.
* ``reset_rate_limits`` — autouse fixture clearing the in-process
                limiter.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from inkwell_backend import settings as settings_mod
from inkwell_backend.main import create_app
from inkwell_backend.services import rate_limit
from inkwell_backend.settings import Settings

# A valid dev-mode origin — any chrome-extension:// origin is accepted
# in non-production. Set on the TestClient so every POST in the suite
# satisfies the Origin-required-on-writes check by default.
TEST_ORIGIN = "chrome-extension://test-extension-id"


@pytest.fixture(autouse=True)
def reset_rate_limits() -> Iterator[None]:
    """Clear the in-process limiter before EVERY test.

    Without this, tests interact via the module-level dict in
    ``rate_limit`` and order-dependent flakes appear.
    """
    rate_limit.reset_for_tests()
    yield
    rate_limit.reset_for_tests()


@pytest.fixture(autouse=True)
def _isolate_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Isolate every test from the developer's ``backend/.env`` file.

    Services in the codebase do ``from ..settings import get_settings``
    which captures a *name binding* into each module. Monkey-patching
    ``inkwell_backend.settings.get_settings`` after import wouldn't
    reach those bindings. Instead we go one layer down: set the env
    vars Pydantic Settings reads from to known test values BEFORE the
    cache is filled, then clear the lru_cache so the next call rebuilds
    Settings from the test env. pydantic-settings reads ``os.environ``
    ahead of the ``.env`` file, so a real ``OPENAI_API_KEY`` on disk
    can't leak into tests.
    """
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("APP_URL", "http://localhost:8000")
    monkeypatch.setenv("ALLOWED_EXTENSION_IDS", "")
    monkeypatch.setenv("EXTRA_ALLOWED_ORIGINS", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_DEFAULT_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    settings_mod.get_settings.cache_clear()
    yield
    settings_mod.get_settings.cache_clear()


@pytest.fixture
def settings() -> Settings:
    """Test-tuned Settings — same env as ``_isolate_settings`` set up,
    handed to ``create_app`` so the FastAPI factory sees a known shape.
    The service layer also calls ``get_settings()`` directly and reads
    the same env-driven snapshot."""
    return settings_mod.get_settings()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    with TestClient(app, headers={"origin": TEST_ORIGIN}) as test_client:
        yield test_client
