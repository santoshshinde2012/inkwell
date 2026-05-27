# Reference: Error codes

_Every code emitted by the API. Defined in
[`frontend/packages/shared/src/errors.ts`](../../frontend/packages/shared/src/errors.ts)
(extension) and mirrored in
[`backend/src/inkwell_backend/domain/errors.py`](../../backend/src/inkwell_backend/domain/errors.py)
(backend) so both ends agree._

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
| `VALIDATION_FAILED` | Body / query failed Pydantic validation, or not JSON. | no |
| `PAYLOAD_TOO_LARGE` | Body too large (32 KB for `/complete`, 12 MB for `/ocr`). | no |

### Limits / availability (429 / 502 / 503 / 504)

| Code | When | Retryable |
| --- | --- | --- |
| `RATE_LIMITED` | Client IP exceeded 20/min or 500/day. | no (within window) |
| `QUOTA_EXCEEDED` | Reserved for future quota enforcement. | no |
| `UPSTREAM_ERROR` | OpenAI returned an error. | yes |
| `TIMEOUT` | Upstream call exceeded the deadline. | yes |
| `NETWORK_ERROR` | Network fault (also used by the extension's client). | yes |

#### `RATE_LIMITED` response shape

429 responses always carry a `Retry-After` header (RFC 9110, seconds)
and a `error.details.retryAfterMs` field (delta from now, milliseconds):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"error":{"code":"RATE_LIMITED","message":"Too many requests; please wait.","retryable":false,"details":{"retryAfterMs":60000}}}
```

`retryable` is `false` because the request shouldn't be re-issued
immediately — the client must wait the indicated interval. The
distinction matters: callers may show different UI for a temporary
rate-limit (`Retry-After`) vs an `UPSTREAM_ERROR` (immediately
retryable).

### Streaming

| Code | When | Retryable |
| --- | --- | --- |
| `STREAM_ABORTED` | Client closed the connection mid-stream. | yes |

### Catch-all

| Code | When | Retryable |
| --- | --- | --- |
| `INTERNAL_ERROR` | Unexpected backend failure. | no |

## HTTP status mapping

From [`status_for_code` in `domain/errors.py`](../../backend/src/inkwell_backend/domain/errors.py):

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
- [`frontend/packages/shared/src/errors.ts`](../../frontend/packages/shared/src/errors.ts) — the source of truth.
