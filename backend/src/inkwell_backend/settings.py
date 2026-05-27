"""Single read-once view of the environment.

All ``os.environ`` access goes through this module so:

* The required env shape is a typed Pydantic model — config drift fails
  loud at startup, not on the first request.
* The rest of the codebase imports a ``Settings`` instance and never
  touches strings from ``os.environ`` directly.
* Tests build a custom Settings to override values without monkey-
  patching env vars.

There is no authentication and no database. The default external
dependency is OpenAI; swap providers by editing the providers package,
not this file.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal, Self

from pydantic import AliasChoices, Field, field_validator, model_validator
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

    # OpenAI credentials — leave blank to keep the mock streaming
    # response. Per-vendor keys live as siblings (e.g. ``anthropic_api_key``
    # when that provider is added); the provider implementation owns
    # which field it reads.
    openai_api_key: str | None = None

    # Default model id when the client does not specify one. Vendor-
    # neutral — the catalog in ``domain/models.py`` resolves the id to
    # the right provider. ``OPENAI_DEFAULT_MODEL`` is accepted for
    # backward compatibility with older ``.env`` files.
    default_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("DEFAULT_MODEL", "OPENAI_DEFAULT_MODEL"),
    )

    # --- Portkey AI gateway (optional) -----------------------------------
    #
    # When ``use_portkey`` is True every provider client is constructed
    # to route through the Portkey gateway instead of calling the vendor
    # API directly. Gives us observability, caching, retries, fallbacks,
    # and centralised secret management without changing any service /
    # route code. Toggle is explicit (not "key-set means on") so the
    # credentials can stay in ``.env`` while Portkey is paused.
    use_portkey: bool = False

    # Portkey project / workspace key. Required when ``use_portkey`` is
    # True — the cross-field validator below fails startup if it's missing.
    portkey_api_key: str | None = None

    # Optional Portkey "virtual key" — when set, Portkey's vault provides
    # the underlying provider credentials and ``openai_api_key`` can be
    # left blank. Recommended for production so secrets stay out of the
    # backend's env entirely.
    portkey_virtual_key: str | None = None

    # Optional Portkey config id — points at a saved gateway config
    # (cache TTLs, fallbacks, guardrails). Leaving this unset uses the
    # account default.
    portkey_config: str | None = None

    # Gateway base URL. Defaults to the public SaaS endpoint; override
    # for a self-hosted gateway (e.g. ``http://portkey:8787/v1`` inside
    # a docker network).
    portkey_base_url: str = "https://api.portkey.ai/v1"

    # Logging verbosity.
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # --- Derived helpers ---------------------------------------------------

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def portkey_enabled(self) -> bool:
        """True when the gateway should be used.

        Both the toggle and the project key must be present — the
        ``model_validator`` below enforces this combination so this
        property is just a positive assertion.
        """
        return bool(self.use_portkey and self.portkey_api_key)

    @property
    def has_openai(self) -> bool:
        """True when a usable OpenAI upstream is reachable — directly
        with an OpenAI key, or via Portkey (with either a virtual key
        or a real OpenAI key forwarded through the gateway).

        Drives the mock-vs-real branch in the provider; the mock path
        kicks in only when no usable credential combination exists.
        """
        if self.portkey_enabled:
            return bool(
                self.portkey_virtual_key or (self.openai_api_key and self.openai_api_key.strip())
            )
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

    @field_validator("default_model")
    @classmethod
    def _strip_model_id(cls, value: str) -> str:
        return value.strip()

    @field_validator("portkey_base_url")
    @classmethod
    def _strip_portkey_url(cls, value: str) -> str:
        # Trailing slashes break the OpenAI SDK's URL composition (it
        # appends ``/chat/completions`` and a doubled slash trips some
        # gateways). Strip eagerly so misconfiguration fails loud.
        return value.strip().rstrip("/")

    @model_validator(mode="after")
    def _validate_portkey_combination(self) -> Self:
        """Fail loud at startup when Portkey is toggled on without a key.

        Catches the most common misconfiguration: someone flipped
        ``USE_PORTKEY=true`` but forgot the project key. Without this
        check the first request would silently fall back to direct
        OpenAI (when ``OPENAI_API_KEY`` is set) or to the mock — both
        confusing and possibly billing-relevant.
        """
        if self.use_portkey and not self.portkey_api_key:
            raise ValueError(
                "USE_PORTKEY=true requires PORTKEY_API_KEY to be set. "
                "Either provide the key or set USE_PORTKEY=false."
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor. Importing ``Settings()`` directly re-parses env
    vars on every call; this version reads them once per process,
    which is what every consumer actually wants.

    Tests that need a different configuration can ``get_settings.cache_clear()``
    then re-call, or construct a ``Settings(...)`` instance directly.
    """
    return Settings()
