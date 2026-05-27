# Reference: Environment variables

_Every env var the backend reads. Inkwell has no auth and no database —
the only external dependency is OpenAI, so the list is short._

The schema lives in
[`backend/src/inkwell_backend/settings.py`](../../backend/src/inkwell_backend/settings.py).
Vars are validated at process start by `pydantic-settings`; an invalid
env aborts the boot.

For local dev, copy
[`backend/.env.example`](../../backend/.env.example)
to `backend/.env`. For production, set them in the hosting
platform's secret store.

## Backend

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `APP_URL` | yes (prod) | `http://localhost:8000` | Backend's own origin; used by CORS for same-origin checks. |
| `ALLOWED_EXTENSION_IDS` | yes (prod) | empty | Comma-separated `chrome-extension://<id>` origins permitted to call the API. **Production** requires it — without it, only same-origin is allowed. **Development** ignores the gap: any `chrome-extension://` origin is accepted so the unpacked extension works with no setup. |
| `EXTRA_ALLOWED_ORIGINS` | no | empty | Comma-separated extra origins to allow (handy for staging proxies). Leave empty in production unless you really need this. |
| `OPENAI_API_KEY` | yes (prod) | — | Server-side only. If absent, `/complete` serves a mock streaming response and `/ocr` returns a deterministic placeholder. |
| `OPENAI_DEFAULT_MODEL` | no | `gpt-4o-mini` | Model used when the request doesn't specify one. Also drives the OCR vision call. |
| `ENVIRONMENT` | no | `development` | One of `development` / `production` / `test`. Production hides `/docs` + `/openapi.json` and tightens the CORS allow-list to the explicit list. |
| `LOG_LEVEL` | no | `INFO` | Stdlib log-level name. `DEBUG` while iterating; `INFO` in prod. |

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
{"level":"info","message":"inkwell-backend ready","version":"1.1.0","environment":"production","has_openai":true,...}
```

If `has_openai=false` in production, `OPENAI_API_KEY` is missing —
`/complete` would serve mock responses to real users. Set the key and
restart the service.

## See also

- [Security](../security.md)
- [How-to: Use your own backend](../how-to/use-your-own-backend.md)
