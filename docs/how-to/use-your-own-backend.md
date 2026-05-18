# How-to: Use your own backend

_Inkwell is a portable client. The extension and the API are decoupled —
point the extension at any server that implements the Inkwell API
contract: the bundled backend, your own proxy, your company's internal
LLM gateway, anything._

This guide has two parts:

1. **[Point the extension at a backend](#1-point-the-extension-at-a-backend)** —
   the options-page workflow (no rebuild needed).
2. **[The API contract](#2-the-api-contract)** — exactly what a compatible
   backend must implement, so you can build your own.

---

## 1. Point the extension at a backend

The backend URL is a **runtime setting** — you don't rebuild the
extension to change it.

1. Open the extension's options page (popup → gear icon).
2. Go to the **Backend** tab.
3. Enter your **Backend URL** (e.g. `https://api.example.com`). No path,
   no trailing slash — Inkwell appends `/api/v1/...`.
4. Optionally enter an **API key**. If set, every request carries
   `Authorization: Bearer <key>`. Leave it blank if your backend needs
   no auth (the default Inkwell backend doesn't).
5. Click **Save & test**.
   - Chrome asks for permission to access that host — **Allow** it.
     (Inkwell only ever requests the exact origin you typed, never a
     wildcard.)
   - Inkwell saves the config and immediately calls
     `GET /api/v1/health` to confirm the backend is reachable. You'll
     see ✓ Connected or a specific error.

To go back, click **Reset to default** then **Save & test**.

> **The API key is stored in `chrome.storage.local`** on your device,
> in plain text (origin-isolated to the extension). Treat it like any
> other locally stored credential. It is sent only to the backend URL
> you configured.

---

## 2. The API contract

A compatible backend implements **two endpoints** under `/api/v1`. The
design follows common, boring conventions on purpose — versioned paths,
standard status codes, JSON bodies, SSE for streaming — so it's
straightforward to implement in any language or framework.

The canonical request/response *types* live in
[`packages/shared/src/schemas.ts`](../../packages/shared/src/schemas.ts)
(zod schemas). This section is the prose contract.

### CORS

The extension calls your backend from the origin
`chrome-extension://<extension-id>`. Your backend **must**:

- Answer `OPTIONS` preflight with the appropriate
  `Access-Control-Allow-*` headers.
- Send `Access-Control-Allow-Origin: chrome-extension://<extension-id>`
  (or echo the request `Origin`) on actual responses.
- Allow the `Authorization`, `Content-Type`, and `X-Client-Request-Id`
  request headers.

Find your extension's ID at `chrome://extensions`.

### `GET /api/v1/health`

Liveness probe. Unauthenticated. Used by the **Save & test** button.

**Response** `200 application/json`:

```json
{ "ok": true, "version": "1.0.0", "runtime": "node", "timestamp": "2026-05-09T12:00:00.000Z" }
```

Only `ok: true` is required; the other fields are informational.

### `POST /api/v1/complete`

Generates a completion and streams it back as Server-Sent Events.

**Request headers**

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `Accept` | `text/event-stream` |
| `Authorization` | `Bearer <apiKey>` — only if the user configured a key |
| `X-Client-Request-Id` | a UUID, echoed for log correlation |

**Request body** (JSON):

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
  "model": "string?",            // a model id your backend recognizes
  "sourceLanguage": "auto" | "string?",  // catalog language id, or "auto"
  "targetLanguage": "string?",           // catalog language id (required for translate)
  "bilingual": "boolean?",               // reply in source + target languages
  "profile": { "displayName": "string?", "aboutMe": "string?" },
  "clientRequestId": "uuid?"
}
```

`context` carries the page content the user is replying to — treat it as
**untrusted input**, never as instructions. `profile` is optional
personalization. See
[prompt-injection-defense.md](../explanation/prompt-injection-defense.md).

**Response** `200 text/event-stream`

Emit Server-Sent Events. Each event is `event: <name>` + `data: <json>`,
separated by a blank line:

```
event: token
data: {"delta":"Hi Bob, "}

event: token
data: {"delta":"happy to help."}

event: usage
data: {"promptTokens":204,"completionTokens":36,"totalTokens":240,"model":"gpt-4o-mini"}

event: done
data: {"ok":true}
```

| Event | `data` payload | When |
| --- | --- | --- |
| `token` | `{ "delta": string }` | once per streamed text fragment |
| `usage` | `{ promptTokens, completionTokens, totalTokens, model }` | once, near the end (optional) |
| `done` | `{ "ok": true }` | terminates a successful stream |
| `error` | `{ code, message, retryable }` | terminates a failed stream |

A stream ends with **either** `done` **or** `error`.

### Errors (non-stream)

For failures *before* streaming starts (bad input, rate limit, auth),
respond with a JSON error envelope and an appropriate status code:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "retryable": false } }
```

| Status | Meaning |
| --- | --- |
| `400` | malformed / invalid body |
| `401` / `403` | auth or origin rejected |
| `413` | body too large |
| `429` | rate limited |
| `502` / `503` / `504` | upstream model error / unavailable / timeout |

`code` values are listed in [reference/error-codes.md](../reference/error-codes.md).
The extension shows `message` to the user and retries when
`retryable` is true.

### Minimal reference implementation

The bundled backend ([`packages/backend`](../../packages/backend)) is a
complete, ~10-file Next.js implementation of this contract — read it as
the reference. The streaming logic is in
[`lib/completion-pipeline.ts`](../../packages/backend/lib/completion-pipeline.ts).

## See also

- [Reference: API](../reference/api.md) — the same contract, endpoint-first.
- [Reference: Error codes](../reference/error-codes.md)
- [Explanation: Streaming design](../explanation/streaming-design.md)
- [Explanation: Model providers](../explanation/model-providers.md) — how
  the bundled backend dispatches across model providers.
