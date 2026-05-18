# Reference: API

_HTTP API exposed by the Next.js backend. All routes are versioned under
`/api/v1/`._

Base URL in dev: `http://localhost:3000`. In prod: your Vercel URL.

> **The API is a portable contract.** The extension's backend URL is a
> runtime setting — anyone can point Inkwell at their own server that
> implements this contract. If you're *building* a compatible backend,
> read [How-to: Use your own backend](../how-to/use-your-own-backend.md);
> this page is the endpoint-by-endpoint reference.

**The bundled backend has no authentication.** It accepts an optional
`Authorization: Bearer` header (the extension sends one only if the user
configured an API key) but ignores it; a custom backend may require it.
CORS restricts browser callers to the extension origin; the `/complete`
route additionally rate-limits by client IP.

## Conventions

- Requests with bodies use JSON (`Content-Type: application/json`).
- The extension sends `Authorization: Bearer <key>` **only** when the
  user has configured an API key for a custom backend. The bundled
  backend ignores it.
- Every request must send an `Origin` header matching one of:
  - the deployed app origin (same-origin), or
  - an entry in `ALLOWED_EXTENSION_IDS`, or
  - `http://localhost:3000` / `127.0.0.1:3000` (dev only).
- Errors use a consistent envelope:
  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "...", "retryable": false } }
  ```
  See [Error codes](./error-codes.md).

## Endpoints

| Method | Path | Runtime | Body limit |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Edge | — |
| `POST` | `/api/v1/complete` | Node | 32 KB |

That's the entire surface. There are no profile, usage, or auth
endpoints — user settings live in the extension's `chrome.storage.local`.

---

## `GET /api/v1/health`

Liveness probe. Unauthenticated.

```bash
curl https://your-app.vercel.app/api/v1/health
```

```json
{ "ok": true, "version": "1.0.0", "runtime": "edge", "timestamp": "..." }
```

## `POST /api/v1/complete`

Streaming completion. Returns `text/event-stream`.

### Request

```jsonc
{
  "action": "reply" | "grammar" | "rewrite" | "translate",
  "context": {
    "site": "string?",
    "pageTitle": "string?",
    "pageUrl": "string?",
    "thread": [{ "author": "string?", "text": "string", "timestamp": "string?" }],
    "post": { "author": "string?", "text": "string" },
    "draft": "string?",
    "meta": { "key": "value" }
  },
  "tone": "professional" | "friendly" | "concise" | "detailed",
  "instruction": "string?",
  "model": "<catalog model id>",  // see MODEL_CATALOG; e.g. "gpt-4o-mini"
  // Language controls — see LANGUAGE_CATALOG in shared/src/languages.ts.
  "sourceLanguage": "auto" | "<catalog language id>",  // e.g. "fr", "zh-Hans"
  "targetLanguage": "<catalog language id>?",          // output language
  "bilingual": "boolean?",                             // reply in both languages
  // Optional personalization, sourced from chrome.storage.local by the
  // extension. Never persisted server-side.
  "profile": { "displayName": "string?", "aboutMe": "string?" },
  "clientRequestId": "uuid?"
}
```

Validation ([shared/src/schemas.ts](../../packages/shared/src/schemas.ts)):

- `reply` requires `context.thread` or `context.post`.
- `grammar` requires `context.draft`.
- `translate` requires text (`context.draft` or page context) **and** a
  `targetLanguage`.
- `rewrite` requires at least one of `context.draft`, `instruction`, or
  page context — see [three-rewrite-modes.md](../explanation/three-rewrite-modes.md).
- `model`, if present, must be an id in the shared model catalog
  (`z.enum(MODEL_IDS)`); unknown ids are rejected. When omitted, the
  backend uses `OPENAI_DEFAULT_MODEL` then the catalog default. The
  extension always sends the user's selected model. See
  [model-providers.md](../explanation/model-providers.md).
- `sourceLanguage` / `targetLanguage`, if present, must be ids in the
  shared language catalog (`sourceLanguage` also accepts `"auto"`).
  `sourceLanguage` is a hint — the model still detects the language from
  the text. See [multilingual-support.md](../explanation/multilingual-support.md).
- Body ≤ 32 KB.

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

### Errors

| Code | When |
| --- | --- |
| `ORIGIN_NOT_ALLOWED` | `Origin` not in the allowlist. |
| `VALIDATION_FAILED` | Body fails zod validation / not JSON. |
| `PAYLOAD_TOO_LARGE` | Body > 32 KB. |
| `RATE_LIMITED` | Client IP exceeded 20/min or 500/day. |
| `FORBIDDEN` | Page content matched a prompt-injection pattern. |
| `UPSTREAM_ERROR` | OpenAI returned an error. |
| `STREAM_ABORTED` | Client closed the connection. |

## See also

- [Error codes](./error-codes.md)
- [Environment](./environment.md)
- [Architecture](./architecture.md)
