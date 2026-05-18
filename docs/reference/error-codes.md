# Reference: Error codes

_Every code emitted by the API. Defined in
[`packages/shared/src/errors.ts`](../../packages/shared/src/errors.ts) so
both ends agree._

Errors use a consistent envelope:

```jsonc
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable summary",
    "retryable": false,
    "details": { /* optional, never user content */ }
  }
}
```

Streaming responses (`/api/v1/complete`) emit errors as SSE events:

```
event: error
data: {"code":"UPSTREAM_ERROR","message":"...","retryable":true}
```

## Codes

There are no auth-related codes — Inkwell has no authentication.

### Authorization / policy (403)

| Code | When | Retryable |
| --- | --- | --- |
| `FORBIDDEN` | Policy refusal (e.g. prompt-injection pattern detected). | no |
| `ORIGIN_NOT_ALLOWED` | `Origin` header not in `ALLOWED_EXTENSION_IDS`. | no |
| `SITE_BLOCKED` | Site blocked by policy (enforced extension-side). | no |

### Input (400 / 413)

| Code | When | Retryable |
| --- | --- | --- |
| `VALIDATION_FAILED` | Body / query failed zod validation, or not JSON. | no |
| `PAYLOAD_TOO_LARGE` | Body > 32 KB. | no |

### Limits / availability (429 / 502 / 503 / 504)

| Code | When | Retryable |
| --- | --- | --- |
| `RATE_LIMITED` | Client IP exceeded 20/min or 500/day. | no (within window) |
| `QUOTA_EXCEEDED` | Reserved for future quota enforcement. | no |
| `UPSTREAM_ERROR` | OpenAI returned an error. | yes |
| `TIMEOUT` | Upstream call exceeded the deadline. | yes |
| `NETWORK_ERROR` | Network fault (also used by the extension's client). | yes |

### Streaming

| Code | When | Retryable |
| --- | --- | --- |
| `STREAM_ABORTED` | Client closed the connection mid-stream. | yes |

### Catch-all

| Code | When | Retryable |
| --- | --- | --- |
| `INTERNAL_ERROR` | Unexpected backend failure. | no |

## HTTP status mapping

From [`lib/responses.ts`](../../packages/backend/lib/responses.ts):

| Code | HTTP |
| --- | --- |
| `FORBIDDEN` / `ORIGIN_NOT_ALLOWED` / `SITE_BLOCKED` | 403 |
| `VALIDATION_FAILED` | 400 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `RATE_LIMITED` / `QUOTA_EXCEEDED` | 429 |
| `UPSTREAM_ERROR` | 502 |
| `TIMEOUT` | 504 |
| `NETWORK_ERROR` | 503 |
| `STREAM_ABORTED` | 499 (nginx convention) |
| `INTERNAL_ERROR` | 500 |

## See also

- [API reference](./api.md)
- [`packages/shared/src/errors.ts`](../../packages/shared/src/errors.ts) — the source of truth.
