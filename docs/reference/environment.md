# Reference: Environment variables

_Every env var the backend reads. Inkwell has no auth and no database;
the default upstream is OpenAI, optionally routed through the Portkey
AI gateway as a transport-level toggle._

The schema lives in
[`backend/src/inkwell_backend/settings.py`](../../backend/src/inkwell_backend/settings.py).
Vars are validated at process start by `pydantic-settings`; an invalid
env aborts the boot.

For local dev, copy
[`backend/.env.example`](../../backend/.env.example)
to `backend/.env`. For production, set them in the hosting
platform's secret store.

## Backend — core

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `APP_URL` | yes (prod) | `http://localhost:8000` | Backend's own origin; used by CORS for same-origin checks. |
| `ALLOWED_EXTENSION_IDS` | yes (prod) | empty | Comma-separated `chrome-extension://<id>` origins permitted to call the API. **Production** requires it — without it, only same-origin is allowed. **Development** ignores the gap: any `chrome-extension://` origin is accepted so the unpacked extension works with no setup. |
| `EXTRA_ALLOWED_ORIGINS` | no | empty | Comma-separated extra origins to allow (handy for staging proxies). Leave empty in production unless you really need this. |
| `OPENAI_API_KEY` | conditional | — | Server-side only. Required when Portkey is off and you want real model calls. When `USE_PORTKEY=true` it can be left blank — the gateway supplies the upstream credential via a virtual key, model-catalog slug, or a forwarded key. With Portkey off and no key, `/complete` serves a mock streaming response and `/ocr` returns a deterministic placeholder. |
| `DEFAULT_MODEL` | no | `gpt-4o-mini` | Vendor-neutral default model id when the request doesn't specify one. The catalog in [`domain/models.py`](../../backend/src/inkwell_backend/domain/models.py) resolves the id to the right provider. Also drives the OCR vision call. The legacy `OPENAI_DEFAULT_MODEL` name is still accepted (Pydantic `AliasChoices`) so existing `.env` files keep working. |
| `ENVIRONMENT` | no | `development` | One of `development` / `production` / `test`. Production hides `/docs` + `/openapi.json` and tightens the CORS allow-list to the explicit list. |
| `LOG_LEVEL` | no | `INFO` | Stdlib log-level name. `DEBUG` while iterating; `INFO` in prod. |

## Backend — Portkey AI gateway (optional)

When `USE_PORTKEY=true` the backend constructs its OpenAI client
against Portkey's gateway URL with `x-portkey-*` headers attached.
Everything else (routes, services, the provider Protocol, tests)
behaves identically. See
[Explanation: Model providers § Portkey](../explanation/model-providers.md#portkey-ai-gateway-optional-transport-toggle)
for the design rationale.

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `USE_PORTKEY` | no | `false` | Explicit on/off. Set `true` to route every upstream call through Portkey. |
| `PORTKEY_API_KEY` | yes when `USE_PORTKEY=true` | — | Portkey project / workspace key. Misconfiguration (`USE_PORTKEY=true` with this empty) fails loud at startup with a `ValidationError` — by design. |
| `PORTKEY_PROVIDER` | no | — | Provider slug sent as `x-portkey-provider` (e.g. `openai`) so the gateway routes a *bare* model id to that vendor. Leave unset when routing via a model-catalog slug (`@integration/model`) or a virtual key — a stray provider header would override their routing. Blank values normalise to unset. |
| `PORTKEY_VIRTUAL_KEY` | no | — | When set, Portkey's vault provides the upstream provider credential and `OPENAI_API_KEY` can be left blank. Recommended for production. |
| `PORTKEY_CONFIG` | no | — | Points at a saved Portkey config id (cache TTLs, fallbacks, guardrails). Leave blank to use the account default. |
| `PORTKEY_BASE_URL` | no | `https://api.portkey.ai/v1` | Override only for a self-hosted gateway (e.g. `http://portkey:8787/v1` inside a docker network). Trailing slashes are stripped. |

> **Never** expose `OPENAI_API_KEY` to the client. The FastAPI service
> is the only thing that should read it. If you do so by accident,
> rotate the key.

## Extension (build-time)

Belongs in `frontend/packages/extension/.env.local`, not the backend env.

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_BACKEND_URL` | no | `http://localhost:8000` | The **default** backend baked into the extension at build time — it seeds the initial value and the static `host_permissions` entry. Users can override the backend at runtime in the options page (Backend tab), so a rebuild is only needed to change the *default*. See [How-to: Use your own backend](../how-to/use-your-own-backend.md). |

## What there is NOT

There are no Clerk, Turso, Upstash, or database variables — Inkwell
has no authentication and no database. User settings live entirely in
the extension's `chrome.storage.local`.

## Startup banner

The backend logs a single startup line when it binds:

```
{"level":"info","message":"inkwell-backend ready","version":"1.1.0","environment":"production","has_openai":true,"portkey_enabled":false,...}
```

Two flags to verify on a prod boot:

- `has_openai=false` in production means no usable upstream was found.
  With Portkey **off** that's a missing `OPENAI_API_KEY`. With Portkey
  **on** it never happens — the project key alone routes (via a
  model-catalog slug, virtual key, or forwarded key), so `has_openai`
  is always `true` when `portkey_enabled=true`. A `false` here means
  `/complete` serves mock responses to real users — set the credential
  and restart.
- `portkey_enabled=true` confirms the gateway toggle. If you set
  `USE_PORTKEY=true` but this is `false`, check the startup error log
  — a missing `PORTKEY_API_KEY` aborts the boot before this line.

## See also

- [Security](../security.md)
- [How-to: Use your own backend](../how-to/use-your-own-backend.md)
