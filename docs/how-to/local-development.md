# How-to: Local development

_Once you've finished [Getting started](../getting-started.md), this is
how to use a real OpenAI key and work on one layer at a time._

## Backend layout at a glance

The backend is a Python (FastAPI) service in `backend/`. It
exposes:

- `GET  /api/v1/health` — JSON health check
- `POST /api/v1/complete` — SSE-streamed chat completion
- `POST /api/v1/ocr` — image-to-text via a vision model; JSON by default,
  SSE stream when `Accept: text/event-stream` is sent

There is no database and no authentication. The only external
dependency is OpenAI.

## Using a real OpenAI key

By default the backend serves a deterministic mock streaming response,
so local dev works with zero secrets. To use the real model, put your
key in `backend/.env`:

```
OPENAI_API_KEY=sk-...
DEFAULT_MODEL=gpt-4o-mini
```

Restart the dev server. The startup log line should include
`has_openai=True`.

> `OPENAI_DEFAULT_MODEL` is still accepted as a backward-compat alias
> for `DEFAULT_MODEL`, so existing `.env` files keep working.

## Routing through the Portkey gateway

Optionally, route every upstream call through the Portkey gateway
(observability, caching, retries, fallbacks). Add to `backend/.env`:

```
USE_PORTKEY=true
PORTKEY_API_KEY=pk-...

# One of: keep OPENAI_API_KEY set and Portkey forwards it,
# OR use a virtual key (recommended; OPENAI_API_KEY can be blank):
PORTKEY_VIRTUAL_KEY=vk-...

# Optional saved Portkey config (cache TTLs, fallbacks, guardrails):
PORTKEY_CONFIG=cfg-...
```

Restart the dev server. The startup log line should now include
`portkey_enabled=True`. The audit log line for each request gains a
`via_portkey: true` field. The extension's `X-Client-Request-Id`
flows through as `x-portkey-trace-id`, so the same UUID appears in
both our logs and Portkey's dashboard.

Setting `USE_PORTKEY=true` without `PORTKEY_API_KEY` aborts boot
with a Pydantic `ValidationError` — by design, so misconfiguration
fails loud instead of silently falling back to direct OpenAI.

To revert: set `USE_PORTKEY=false` (or remove the line). No code
change required — the toggle is transport-level.

## Running one layer at a time

```bash
# Extension only (rebuilds dist/ on save):
make frontend

# Backend only (uvicorn --reload on :8000):
make backend                # uvicorn --reload on :8000 (delegates to backend/Makefile)

# Or directly inside the backend dir:
cd backend
make install               # one-off: creates .venv with dev extras
make dev                   # uvicorn --reload on :8000
```

When you change `frontend/packages/shared/`, rebuild it before the extension
sees the change:

```bash
pnpm --filter @inkwell/shared build
# or, in another terminal:
pnpm --filter @inkwell/shared build --watch
```

## Useful curl recipes

No auth header is needed — the API is anonymous.

```bash
# Health
curl http://localhost:8000/api/v1/health

# Streaming completion
curl -N http://localhost:8000/api/v1/complete \
  -H "Origin: http://localhost:8000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"author":"Bob","text":"hi"}}}'

# Translate a customer query into English
curl -N http://localhost:8000/api/v1/complete \
  -H "Origin: http://localhost:8000" \
  -H "Content-Type: application/json" \
  -d '{"action":"translate","context":{"post":{"text":"Bonjour, ma commande est en retard."}},
       "sourceLanguage":"fr","targetLanguage":"en"}'

# Reply to a French customer, in French (targetLanguage omitted = match source)
curl -N http://localhost:8000/api/v1/complete \
  -H "Origin: http://localhost:8000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"text":"Ma commande est en retard."}},
       "sourceLanguage":"fr"}'

# OCR a base64-encoded image (one-shot JSON)
curl http://localhost:8000/api/v1/ocr \
  -H "Origin: http://localhost:8000" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"<base64>","mimeType":"image/png"}'

# OCR streamed as SSE deltas — same body, just add Accept and -N
curl -N http://localhost:8000/api/v1/ocr \
  -H "Origin: http://localhost:8000" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"<base64>","mimeType":"image/png"}'
# → emits `event: token` frames as the model produces text, then
#   `event: done`. A second call with the same image is a cache hit
#   and arrives as a single `event: token` followed by `event: done`.

# With personalization (what the extension attaches from local storage)
curl -N http://localhost:8000/api/v1/complete \
  -H "Origin: http://localhost:8000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"text":"hi"}},
       "profile":{"displayName":"Alex","aboutMe":"PM, prefers concise"}}'
```

While iterating on the backend you can also browse the auto-generated
OpenAPI docs at <http://localhost:8000/docs>.

## Iterating on the extension

`pnpm --filter @inkwell/extension dev` rebuilds `dist/` on save. Chrome
doesn't auto-reload extensions — click the reload icon on
`chrome://extensions` after a rebuild.

- **Popover (in-page UI):** DevTools on whatever site you're testing.
- **Background service worker:** "Inspect views: service worker" on the
  extension card.
- **Side panel:** open the side panel, then right-click anywhere inside
  it → Inspect. The "Inspect views: side panel" link on the extension
  card opens the same DevTools instance.
- **Options page:** open it, then DevTools as for any normal tab.
- **Stored settings:** the service-worker DevTools console —
  `chrome.storage.local.get(console.log)`.

## Backend dev commands cheatsheet

```bash
cd backend
make dev          # uvicorn --reload on :8000
make lint         # ruff check
make format       # ruff format + autofix
make typecheck    # mypy strict
make test         # pytest
make check        # all three
make docker       # build the production image
```

## See also

- [Getting started](../getting-started.md)
- [How-to: Add a site adapter](./add-a-site-adapter.md)
- [Reference: API](../reference/api.md)
