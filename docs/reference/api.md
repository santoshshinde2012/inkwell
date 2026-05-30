# Reference: API

_HTTP API exposed by the FastAPI backend. All routes are versioned under
`/api/v1/`._

Base URL in dev: `http://localhost:8000`. In prod: wherever you deploy
the FastAPI service.

> **The API is a portable contract.** The extension's backend URL is a
> runtime setting — anyone can point Inkwell at their own server that
> implements this contract. If you're *building* a compatible backend,
> read [How-to: Use your own backend](../how-to/use-your-own-backend.md);
> this page is the endpoint-by-endpoint reference.

**The bundled backend has no authentication.** It accepts an optional
`Authorization: Bearer` header (the extension sends one only if the user
configured an API key) but ignores it; a custom backend may require it.
CORS restricts browser callers to the extension origin; the `/complete`
and `/ocr` routes additionally rate-limit by client IP.

## Conventions

- Requests with bodies use JSON (`Content-Type: application/json`).
- The extension sends `Authorization: Bearer <key>` **only** when the
  user has configured an API key for a custom backend. The bundled
  backend ignores it.
- **All non-GET requests must send an `Origin` header** matching one of:
  - the deployed app origin (same-origin), or
  - an entry in `ALLOWED_EXTENSION_IDS`, or
  - `http://localhost:8000` / `127.0.0.1:8000` (dev only).
  GET requests may omit `Origin` (server-to-server diagnostics) but POSTs
  without one are rejected with `ORIGIN_NOT_ALLOWED` — the bundled
  backend will not spend OpenAI tokens for anonymous, non-browser callers.
- `Access-Control-Allow-Credentials` is **not** sent. Inkwell has no
  auth and no cookies; the `Origin` reflection + credentials pairing is
  a known XSRF pattern and is unnecessary here.
- The extension sends an `X-Client-Request-Id: <uuid>` header on
  `/complete`. The backend echoes the id into the structured audit log
  so a single request can be correlated end-to-end across the extension,
  the SSE stream, and the audit drain. Custom backends should accept and
  log it; emitting it on responses is optional.
- Errors use a consistent envelope:
  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "...", "retryable": false } }
  ```
  See [Error codes](./error-codes.md).
- The auto-generated OpenAPI schema is available at `/openapi.json` in
  dev (`/docs` for the interactive UI). Both are disabled when the
  service runs with `ENVIRONMENT=production`.

## Endpoints

| Method | Path | Body limit | Response | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/health` | — | JSON | Legacy liveness probe. |
| `GET` | `/api/v1/live` | — | JSON | Process-alive probe (Kubernetes `livenessProbe`). |
| `GET` | `/api/v1/ready` | — | JSON / 503 | Readiness probe — 503 until lifespan startup completes. |
| `GET` | `/api/v1/version` | — | JSON | Build version + boot timestamp. |
| `GET` | `/api/v1/models` | — | JSON | Model catalog the backend recognises. |
| `POST` | `/api/v1/complete` | 32 KB | `text/event-stream` | Streaming chat completion. |
| `POST` | `/api/v1/ocr` | 12 MB | JSON or `text/event-stream` | Image → text via vision model. Content-negotiated. |
| `OPTIONS` | `/api/v1/*` | — | 204 | CORS preflight. |

There are no profile, usage, or auth endpoints — user settings live in
the extension's `chrome.storage.local`.

---

## `GET /api/v1/health`

Legacy liveness probe. Identical shape to `/live`; kept for back-compat.

```bash
curl http://localhost:8000/api/v1/health
```

```json
{ "ok": true, "version": "1.1.0", "runtime": "fastapi", "timestamp": "..." }
```

## `GET /api/v1/live`

Pure process-alive check. Always returns 200 once the worker is running.
This is what a Kubernetes `livenessProbe` should hit.

```json
{ "ok": true, "version": "1.1.0", "runtime": "fastapi", "timestamp": "..." }
```

## `GET /api/v1/ready`

Readiness gate. Returns **503** until the FastAPI lifespan startup hook
has completed, so rolling deploys / load balancers don't route traffic
into a worker that hasn't finished warming up. Returns **200** once
ready; flips back to 503 during graceful shutdown so in-flight probes
see the drain before the worker actually stops accepting connections.

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/v1/ready
# 200 when ready, 503 otherwise
```

## `GET /api/v1/version`

Build version + boot timestamp. Useful for confirming a rolling deploy
actually rolled.

```json
{ "version": "1.1.0", "runtime": "fastapi", "boot_at": "2026-05-27T18:15:28.123456+00:00" }
```

## `GET /api/v1/models`

Model catalog the backend recognises. The extension currently embeds
its own copy of the catalog; this endpoint exists so a future build can
fetch the live catalog and stop drifting against the server's truth.

```json
{
  "default": "gpt-4o-mini",
  "models": [
    {
      "id": "gpt-4o-mini",
      "label": "GPT-4o mini",
      "provider": "openai",
      "description": "Fast and economical — great for everyday replies.",
      "tier": "fast"
    },
    {
      "id": "gpt-4o",
      "label": "GPT-4o",
      "provider": "openai",
      "description": "Higher quality, a little slower — for nuanced or long-form writing.",
      "tier": "quality"
    }
  ]
}
```

## `POST /api/v1/complete`

Streaming completion. Returns `text/event-stream`.

### Request

```jsonc
{
  "action": "reply" | "grammar" | "rewrite" | "translate" | "summarize" | "explain",
  "context": {
    "site": "string?",
    "pageTitle": "string?",
    "pageUrl": "string?",
    "thread": [{ "author": "string?", "text": "string", "timestamp": "string?" }],
    "post": { "author": "string?", "text": "string" },
    "draft": "string?",
    // Page-derived metadata the extension scrapes from the active page's
    // *declared* sources (Open Graph / <meta> / JSON-LD / <h1>), e.g.
    // siteName, pageType, description, author, section, published,
    // pageLanguage, heading. Free-form bag; treated as untrusted context.
    "meta": { "key": "value" }
  },
  "tone": "professional" | "friendly" | "concise" | "detailed",
  "instruction": "string?",
  "model": "<catalog model id>",  // see MODEL_CATALOG; e.g. "gpt-4o-mini"
  // Language controls — see LANGUAGE_CATALOG in shared/src/languages.ts.
  "sourceLanguage": "auto" | "<catalog language id>",  // e.g. "fr", "zh-Hans"
  "targetLanguage": "<catalog language id>?",          // output language
  "bilingual": "boolean?",                             // reply in both languages
  // Conversational refinement: prior turns replayed so a follow-up
  // ("make it shorter") revises the assistant's previous draft instead
  // of regenerating. Omitted on the first request. ≤ 12 turns; `role`
  // is "user" | "assistant" only (no client-supplied "system").
  "history": [{ "role": "user" | "assistant", "text": "string" }],
  // Optional personalization, sourced from chrome.storage.local by the
  // extension. Never persisted server-side.
  "profile": { "displayName": "string?", "aboutMe": "string?" },
  "clientRequestId": "uuid?"
}
```

Validation lives in
[backend/src/inkwell_backend/domain/schemas.py](../../backend/src/inkwell_backend/domain/schemas.py):

- `reply` requires `context.thread` or `context.post`.
- `grammar` requires `context.draft`.
- `translate` requires text (`context.draft` or page context) **and** a
  `targetLanguage`.
- `rewrite` requires at least one of `context.draft`, `instruction`, or
  page context — see [three-rewrite-modes.md](../explanation/three-rewrite-modes.md).
- `summarize` and `explain` require text (`context.draft` or page
  context). They honour `targetLanguage` (e.g. "explain in French") and
  fall back to the source language when it's omitted.
- `history`, if present, holds ≤ 12 prior turns (each ≤ 8 000 chars).
  The prompt builder renders them as a transcript and instructs the
  model to revise its most recent draft per the current `instruction`.
- `model`, if present, must be an id in the shared model catalog;
  unknown ids are rejected. When omitted, the backend uses
  `DEFAULT_MODEL` (legacy `OPENAI_DEFAULT_MODEL` is still accepted)
  then the catalog default. The extension always sends the user's
  selected model. See
  [model-providers.md](../explanation/model-providers.md).
- `sourceLanguage` / `targetLanguage`, if present, must be ids in the
  shared language catalog (`sourceLanguage` also accepts `"auto"`).
  `sourceLanguage` is a hint — the model still detects the language from
  the text. See [multilingual-support.md](../explanation/multilingual-support.md).
- `context.meta` is page-derived (scraped from the active page's Open
  Graph / `<meta>` / JSON-LD / `<h1>`), so it's untrusted: every value is
  capped at 500 chars, sanitized, and scanned for prompt-injection
  red-flags alongside `thread`/`post`. See
  [backend/src/inkwell_backend/services/sanitizer.py](../../backend/src/inkwell_backend/services/sanitizer.py).
- Unknown top-level fields are rejected (`extra="forbid"`).
- Body ≤ 32 KB (header pre-check rejects with 413 before the body is
  parsed).

### Response: `text/event-stream`

```
event: token
data: {"delta":"Hi Bob, "}

event: usage
data: {"promptTokens":204,"completionTokens":36,"totalTokens":240,"model":"gpt-4o-mini"}

event: done
data: {"ok":true}
```

Error event (stream may end early on injection refusal or upstream error):

```
event: error
data: {"code":"UPSTREAM_ERROR","message":"...","retryable":true}
```

**Heartbeat frame.** During long generations the backend emits an SSE
*comment* every 15 s the model is silent, so idle nginx / Cloudflare /
load-balancer proxies don't reap the connection mid-stream:

```
: keep-alive

```

Comment lines are part of the SSE spec — every conforming parser
(including the extension's) ignores them. Custom clients should drop
any line whose first character is `:`.

### Errors

| Code | When |
| --- | --- |
| `ORIGIN_NOT_ALLOWED` | `Origin` missing on POST, or not in the allowlist. |
| `VALIDATION_FAILED` | Body fails Pydantic validation / not JSON. |
| `PAYLOAD_TOO_LARGE` | Body > 32 KB. |
| `RATE_LIMITED` | Client IP exceeded 20/min or 500/day. Includes a `Retry-After` header (seconds) and an `error.details.retryAfterMs` field. |
| `FORBIDDEN` | Page content matched a prompt-injection pattern. |
| `UPSTREAM_ERROR` | OpenAI returned an error. |
| `STREAM_ABORTED` | Client closed the connection (status 499, nginx convention). |
| `INTERNAL_ERROR` | Unexpected exception in the pipeline; returns 500 with CORS headers attached. |

## `POST /api/v1/ocr`

Image-to-text via a vision model. **Content-negotiated** — the response
shape is picked from the request's `Accept` header:

- `Accept: text/event-stream` → SSE stream of `token` / `error` / `done`
  frames (same envelope as `/complete`). Lets the side panel show text
  as the model emits it.
- `Accept: application/json` (default) → one-shot `{ text, model }`
  body. Used by the right-click context-menu flow, which opens the
  popover once at the end of OCR.

The same image, model, prompt, rate-limit, and cache lookup apply to
both branches — only the wire shape differs.

### Request

```jsonc
{
  "imageBase64": "<standard base64, no `data:` prefix>",
  "mimeType": "image/png" | "image/jpeg" | "image/webp" | "image/gif"
}
```

- Body ≤ 12 MB. The image payload itself is capped at 8 MB decoded
  (`MAX_OCR_IMAGE_BYTES`); 12 MB JSON carries that 8 MB raw inflated
  ~4/3 by base64.
- `mimeType` is whitelisted to keep SVG and arbitrary binaries out.
- Unknown top-level fields are rejected (`extra="forbid"`).

#### Client-side preprocessing (side panel)

The extension's side panel applies a preprocessing pass before
upload — implemented in
[`extension/src/lib/ocr.ts`](../../frontend/packages/extension/src/lib/ocr.ts):

1. Decode with `createImageBitmap` (handles PNG, JPEG, WebP, GIF, AVIF,
   and HEIC/HEIF on platforms where Chrome supports it).
2. Apply EXIF orientation (`imageOrientation: "from-image"`) so phone
   photos come out the right way up without shipping an EXIF parser.
3. Downscale to ≤ 2,560 px on the longest edge — vision models tile at
   ~768 px patches internally, so anything past that spends bytes for
   no accuracy gain.
4. Re-encode as JPEG @ 0.92 (white background fill so transparent PNGs
   become black-on-white instead of black-on-black).

The raw-input cap (`MAX_OCR_INPUT_BYTES = 32 MB`) is roomy because the
preprocessor brings everything down well under the 8 MB backend cap.
The right-click context-menu flow has its own canvas-based capture
path in [`background/index.ts`](../../frontend/packages/extension/src/background/index.ts)
and doesn't share this helper.

### Response: `application/json` (default)

```json
{ "text": "...recognised text...", "model": "gpt-4o-mini" }
```

When `OPENAI_API_KEY` is unset, a deterministic mock placeholder is
returned so the extension's UX path is testable without secrets.

### Response: `text/event-stream`

```
event: token
data: {"delta":"# Heading\n\n"}

event: token
data: {"delta":"First bullet "}

event: done
data: {"ok":true}
```

Same heartbeat (`: keep-alive\n\n`) and `error` frames as `/complete`:

```
event: error
data: {"code":"UPSTREAM_ERROR","message":"...","retryable":true}
```

The OCR system prompt asks the model to preserve the document's
structure as Markdown — pipe tables, fenced code blocks, lists,
headings, LaTeX math — and to read multi-column layouts left-to-right
per column. See
[`backend/src/inkwell_backend/domain/prompts.py`](../../backend/src/inkwell_backend/domain/prompts.py).

#### Cache hits on the SSE path

A repeat call for the same image (same `model` + same canonical
base64) is served from the in-process result cache (sha256-keyed,
256-entry TTL+LRU, 24 h TTL). On the SSE path the full cached text
arrives as a **single** `token` frame followed by `done` — the client
parser doesn't need to branch on cache state. Cache hits skip the
upstream call entirely but still respect per-IP rate limiting.

### Errors

Same envelope and codes as `/complete`. Notable cases:

| Code | When |
| --- | --- |
| `ORIGIN_NOT_ALLOWED` | `Origin` missing on POST, or not in the allowlist. |
| `VALIDATION_FAILED` | Body fails Pydantic validation / not JSON. |
| `PAYLOAD_TOO_LARGE` | Body > 12 MB. |
| `RATE_LIMITED` | Client IP exceeded the per-minute / per-day quota. Includes `Retry-After`. |
| `UPSTREAM_ERROR` | OpenAI returned an error or the vision call timed out. |
| `STREAM_ABORTED` | Client closed the connection mid-stream (SSE path only). |

### Observability

Every terminal outcome — success, cache hit, validation failure,
rate-limited, abort, upstream error — emits exactly one
`log.ocr` structured log line carrying `model`, `request_bytes`,
`duration_ms`, `status`, `response_chars`, `cache_hit`, `streamed`,
`error_code`, `client_request_id`, and `via_portkey`. The fields
mirror `log.completion` so operators can slice OCR and chat metrics
the same way. Definitions live in
[`backend/src/inkwell_backend/services/audit.py`](../../backend/src/inkwell_backend/services/audit.py).

## See also

- [Error codes](./error-codes.md)
- [Environment](./environment.md)
- [Architecture](./architecture.md)
