# `@inkwell/backend` — Python (FastAPI) backend

The Inkwell backend. Anonymous, no database, single external
dependency (OpenAI). Exposes `/api/v1/{health,live,ready,version,models,complete,ocr}`
for the Chrome extension and operators.

## Stack

| Concern | Choice |
|---|---|
| Language / runtime | Python 3.12+ |
| Web framework | FastAPI (async, OpenAPI-first) |
| ASGI server | Uvicorn |
| Validation / settings | Pydantic v2 + pydantic-settings |
| OpenAI client | Official `openai` Python SDK (async) |
| Streaming | Server-Sent Events via `StreamingResponse` |
| Lint + format | Ruff |
| Type checking | mypy strict |
| Tests | pytest + pytest-asyncio + httpx |
| Container | Multi-stage Docker, non-root runtime user |

## Quick start

```bash
cd backend
make install          # creates .venv and installs editable + dev extras
cp .env.example .env  # then edit OPENAI_API_KEY + ALLOWED_EXTENSION_IDS
make dev              # uvicorn --reload on :8000
```

The extension's `VITE_BACKEND_URL` should point at `http://localhost:8000`.

## Endpoints

- `GET  /api/v1/health` — Legacy liveness probe.
- `GET  /api/v1/live` — Process-alive probe (always 200 once running).
- `GET  /api/v1/ready` — Readiness gate; 503 until lifespan startup completes.
- `GET  /api/v1/version` — Build version + boot timestamp.
- `GET  /api/v1/models` — Model catalog the backend recognises.
- `POST /api/v1/complete` — SSE stream of `token` / `usage` / `done` / `error` events. Heartbeat comments every 15 s.
- `POST /api/v1/ocr` — JSON `{ text, model? }`, calls a vision model.
- `OPTIONS /api/v1/*` — CORS preflight.

CORS is enforced by middleware: only configured chrome-extension origins
and same-origin requests are allowed. Non-GET requests must also carry
an `Origin` header — the backend will not spend OpenAI tokens for
anonymous server-side callers. See [docs/reference/api.md](../docs/reference/api.md).

## Project layout

```
src/inkwell_backend/
├── main.py                # FastAPI app factory
├── settings.py            # pydantic-settings (env-driven)
├── logging_setup.py       # JSON-structured stdlib logging
│
├── domain/                # pure types — no I/O, no FastAPI
│   ├── actions.py
│   ├── tones.py
│   ├── models.py
│   ├── languages.py
│   ├── limits.py
│   ├── errors.py
│   ├── schemas.py         # request/response DTOs (Pydantic)
│   └── sse.py             # SSE event encoders
│
├── services/              # business logic — no HTTP coupling
│   ├── completion.py      # /complete pipeline (SSE)
│   ├── ocr.py             # /ocr pipeline
│   ├── prompt.py          # action-strategy prompt builder
│   ├── sanitizer.py       # untrusted-content cleanup + injection detect
│   ├── rate_limit.py      # in-memory IP sliding window
│   └── audit.py           # metadata-only structured logging
│
├── providers/             # pluggable model integrations
│   ├── base.py            # Protocol
│   ├── registry.py        # model id → provider lookup
│   ├── openai_client.py   # process-wide AsyncOpenAI singleton + timeouts
│   ├── openai_provider.py
│   └── mock_provider.py   # zero-config local dev
│
└── api/                   # HTTP layer (FastAPI-aware)
    ├── cors.py
    ├── deps.py            # client_ip / origin_header / client_request_id
    ├── middleware.py      # CORS lockdown + Origin-required-on-write
    ├── responses.py
    └── v1/
        ├── router.py
        ├── health.py      # /health, /live, /ready
        ├── meta.py        # /version, /models
        ├── complete.py
        └── ocr.py
```

The split mirrors a hexagonal-ish layout:

- **`domain/`** holds catalogs, error codes, DTOs, and SSE encoders —
  everything that the rest of the codebase reaches into but never
  reaches *out* from. No imports from `services/`, `providers/`, or
  `api/`.
- **`services/`** is the application layer. Each file is one cohesive
  pipeline orchestration. Free of FastAPI imports; unit-testable.
- **`providers/`** wraps external integrations behind a Protocol so the
  pipelines never know which vendor they're talking to.
- **`api/`** is the only place FastAPI is imported. Route handlers are
  intentionally thin: parse, hand off to a service, serialise.

## Common commands

```bash
make lint        # ruff check
make format      # ruff format + autofix
make typecheck   # mypy strict over src/
make test        # pytest
make check       # all three
make docker      # build production image
```

## Production

```bash
docker build -t inkwell-backend:latest .
docker run --rm -p 8000:8000 \
    -e OPENAI_API_KEY=... \
    -e ALLOWED_EXTENSION_IDS=chrome-extension://<your-id> \
    inkwell-backend:latest
```

The image runs as a non-root user, includes a Docker `HEALTHCHECK`
hitting `/api/v1/health`, and respects `X-Forwarded-For` for rate
limiting behind a reverse proxy.

## Operational notes

- **No auth, no database.** Rate limiting is in-process, keyed by
  client IP. Counters reset on cold start. For a hard quota, swap the
  in-process store in `services/rate_limit.py` for Redis without
  touching any caller.
- **No content logging.** Only request metadata is logged (action,
  model, token counts, latency, status). Prompts and completions are
  never written.
- **Mock provider** kicks in when `OPENAI_API_KEY` is unset, so local
  dev needs zero secrets and produces deterministic output. Same code
  path serves the OCR mock placeholder.
- **Strict CORS allow-list** for `/api/v1/*`. Dev convenience allows
  any `chrome-extension://` origin so unpacked-load doesn't need
  manually configuring the new id in `.env`; production deployments
  must list extension IDs explicitly via `ALLOWED_EXTENSION_IDS`.
