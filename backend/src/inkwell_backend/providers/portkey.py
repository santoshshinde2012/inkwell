"""Portkey AI gateway helpers — provider-neutral.

Portkey is an LLM gateway that fronts the vendor APIs (OpenAI, Anthropic,
…). Because the gateway is OpenAI-SDK-compatible by design, integration
is purely a transport concern: we keep using ``AsyncOpenAI`` (and any
future vendor SDK) and just point its base URL at the gateway and add
a few ``x-portkey-*`` headers.

This module is the **single place** that knows about Portkey. Every
vendor's client factory imports :func:`build_client_overrides` and
merges the result into its SDK constructor when the gateway is on.

When ``settings.use_portkey`` is False (the default), this module is
inert — :func:`build_client_overrides` returns ``None`` and no Portkey
code runs.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..settings import get_settings

# Placeholder ``api_key`` handed to the SDK when authentication happens
# via a Portkey virtual key — the OpenAI SDK refuses an empty key, and
# the gateway strips this Authorization header before forwarding. Using
# a clearly fake value here so it shows up in logs if it ever leaks.
_VIRTUAL_KEY_PLACEHOLDER: str = "PORTKEY_VIRTUAL_KEY_PLACEHOLDER"


@dataclass(frozen=True, slots=True)
class PortkeyClientOverrides:
    """Kwargs to merge into an OpenAI-compatible SDK constructor when
    the gateway is enabled.

    Kept as a dataclass — not a plain dict — so vendor client factories
    can pattern-match on it and we can grow the shape (e.g. add a
    ``client_options`` field) without changing call sites.
    """

    base_url: str
    default_headers: Mapping[str, str]
    api_key: str
    """``api_key`` to hand the SDK. When a Portkey virtual key is in
    use this is a placeholder; otherwise it's the vendor credential the
    caller passed in (which Portkey forwards verbatim)."""


def build_client_overrides(
    provider: str,
    vendor_api_key: str | None,
) -> PortkeyClientOverrides | None:
    """Return Portkey overrides for a vendor SDK, or ``None`` when the
    gateway is disabled.

    Args:
        provider: Portkey-side provider slug (``"openai"``,
            ``"anthropic"``, …). Each vendor's client factory passes
            its own slug, so a single helper covers every integration.
        vendor_api_key: The vendor's own API key from settings, or
            ``None`` if absent. Used only when no Portkey virtual key
            is configured — the gateway forwards it verbatim to the
            upstream provider.

    The settings layer's cross-field validator guarantees that when
    this function returns non-None, ``portkey_api_key`` is populated —
    callers don't need to defend against that case.

    The lazy import of ``portkey_ai`` keeps cold-start fast for
    deployments that don't use the gateway.
    """
    settings = get_settings()
    if not settings.portkey_enabled:
        return None

    # Lazy import — see module docstring.
    from portkey_ai import createHeaders

    # ``createHeaders`` accepts only keyword arguments and skips entries
    # whose value is None, so we can pass every optional field directly.
    # The SDK ships without type stubs for this helper — silence the
    # untyped-call warning rather than wrap the whole module.
    headers: Mapping[str, str] = createHeaders(  # type: ignore[no-untyped-call]
        api_key=settings.portkey_api_key,
        provider=provider,
        virtual_key=settings.portkey_virtual_key,
        config=settings.portkey_config,
    )

    if settings.portkey_virtual_key:
        # The vault provides the upstream credential; the SDK still
        # demands a non-empty api_key, so feed it a placeholder.
        api_key = _VIRTUAL_KEY_PLACEHOLDER
    else:
        # Forward the vendor's own key through the gateway. Falling
        # back to the placeholder when no key is set lets the SDK
        # construct without raising; the upstream call will fail with
        # a clear 401 from Portkey, which is the right surfacing.
        api_key = (vendor_api_key or "").strip() or _VIRTUAL_KEY_PLACEHOLDER

    return PortkeyClientOverrides(
        base_url=settings.portkey_base_url,
        default_headers=headers,
        api_key=api_key,
    )


def build_request_headers(trace_id: str | None) -> dict[str, str] | None:
    """Return per-request ``extra_headers`` for the vendor SDK, or
    ``None`` when nothing needs adding.

    Today this only forwards ``client_request_id`` as Portkey's
    ``x-portkey-trace-id`` — the canonical way to correlate our audit
    log lines with the gateway's request log. Skipped when Portkey is
    disabled (the header would be ignored upstream) or when no trace id
    is available (the gateway will mint its own).

    The OpenAI SDK accepts ``extra_headers`` on every API call and
    merges them on top of the client's ``default_headers``; this helper
    only emits the per-request headers, leaving the static ones
    (``x-portkey-api-key`` etc.) where they belong on the client.
    """
    if not trace_id:
        return None
    if not get_settings().portkey_enabled:
        return None
    return {"x-portkey-trace-id": trace_id}
