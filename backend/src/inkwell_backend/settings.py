"""Single read-once view of the environment.

All ``os.environ`` access goes through this module so:

* The required env shape is a typed Pydantic model — config drift fails
  loud at startup, not on the first request.
* The rest of the codebase imports a ``Settings`` instance and never
  touches strings from ``os.environ`` directly.
* Tests build a custom Settings to override values without monkey-
  patching env vars.

There is no authentication and no database. The only external
dependency is OpenAI.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_csv(raw: str) -> tuple[str, ...]:
    """Comma-separated env values → trimmed, deduped tuple. Empty
    strings drop out so a trailing or doubled comma doesn't smuggle in
    a bogus origin."""
    seen: set[str] = set()
    out: list[str] = []
    for piece in raw.split(","):
        cleaned = piece.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    return tuple(out)


class Settings(BaseSettings):
    """Backend configuration.

    Loaded from environment variables, falling back to a `.env` file
    (the standard ``pydantic-settings`` precedence). Field names are
    case-insensitive — both ``OPENAI_API_KEY`` and ``openai_api_key``
    resolve to the same value.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Runtime mode — drives logging verbosity and a couple of dev-only
    # CORS conveniences (loopback origins, any chrome-extension://).
    environment: Literal["development", "production", "test"] = "development"

    # Public base URL of the backend (used for same-origin CORS check).
    app_url: str = Field(default="http://localhost:8000")

    # Comma-separated chrome-extension://<id> origins allowed to call
    # /api/v1/*. Empty value means "extension calls disallowed; same-
    # origin only".
    allowed_extension_ids: str = ""

    # Optional comma-separated extra origins to allow (handy for local
    # dev or staging proxies). Production deployments leave this empty.
    extra_allowed_origins: str = ""

    # OpenAI — leave blank to keep the mock streaming response.
    openai_api_key: str | None = None
    openai_default_model: str = "gpt-4o-mini"

    # Logging verbosity.
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # --- Derived helpers ---------------------------------------------------

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def has_openai(self) -> bool:
        """True when real credentials are configured; mock otherwise."""
        return bool(self.openai_api_key and self.openai_api_key.strip())

    @property
    def allowed_extension_origins(self) -> tuple[str, ...]:
        """Parsed allow-list, deduped + trimmed."""
        return _split_csv(self.allowed_extension_ids)

    @property
    def extra_origins(self) -> tuple[str, ...]:
        """Parsed extra-origins list, deduped + trimmed."""
        return _split_csv(self.extra_allowed_origins)

    # --- Validators --------------------------------------------------------

    @field_validator("openai_default_model")
    @classmethod
    def _strip_model_id(cls, value: str) -> str:
        return value.strip()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor. Importing ``Settings()`` directly re-parses env
    vars on every call; this version reads them once per process,
    which is what every consumer actually wants.

    Tests that need a different configuration can ``get_settings.cache_clear()``
    then re-call, or construct a ``Settings(...)`` instance directly.
    """
    return Settings()
