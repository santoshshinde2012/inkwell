# Streaming design

_Why `/api/v1/complete` is the way it is — server choice, SSE event
shape, and how the extension consumes it._

## Why streaming

Token-by-token streaming is core to the UX:

- Users see the model "typing" within ~200ms instead of waiting 5–10s
  for the full reply.
- Users can `Cancel` mid-stream if the response is going wrong.
- Long replies feel responsive rather than frozen.

Streaming is implemented with **Server-Sent Events** (SSE) — a one-way
HTTP stream that's simpler than WebSockets and works across CDNs and
corporate proxies that block other transports.

## Event shape

```
event: token
data: {"delta":"Hi Bob, "}

event: token
data: {"delta":"happy to "}

event: usage
data: {"promptTokens":204,"completionTokens":36,"totalTokens":240,"model":"gpt-4o-mini"}

event: done
data: {"ok":true}
```

Three event types:

- `token` — model output delta (one chunk per OpenAI token, more or less)
- `usage` — final accounting; emitted once
- `done` — terminator; the stream ends after this

A fourth — `error` — replaces `done` if the upstream call fails:

```
event: error
data: {"code":"UPSTREAM_ERROR","message":"Upstream model error","retryable":true}
```

The encoder names these events with a `Literal` type so an SSE event
with a typo (e.g. `event: tokeen`) fails at type-check time, not at
runtime; the extension's parser refuses unknown event names too.

### Heartbeats

During long generations the backend emits an SSE *comment* every 15 s
of model silence so idle nginx / Cloudflare / load-balancer proxies
don't reap the connection mid-stream:

```
: keep-alive

```

Comment lines starting with `:` are part of the SSE spec — every
conforming parser (including the extension's) silently ignores them.
You'll never see them as a tokenised event. Custom clients should
drop any line whose first character is `:`.

The shapes are Pydantic-validated server-side and zod-validated on the
extension. See
[`backend/src/inkwell_backend/domain/schemas.py`](../../backend/src/inkwell_backend/domain/schemas.py)
and [`frontend/packages/shared/src/schemas.ts`](../../frontend/packages/shared/src/schemas.ts).

### Request correlation

The extension sends `X-Client-Request-Id: <uuid>` on every `/complete`
call. The backend reads it via the `client_request_id` FastAPI
dependency, propagates it through the completion pipeline, and
includes it in the structured `audit.log_completion` line. One UUID
ties together: the popover's local state, the SSE messages routed
through the background service worker, and the server-side log entry
for that generation. When the optional Portkey gateway is on, the
same UUID is forwarded as the `x-portkey-trace-id` per-call header,
so the gateway-side request log joins the same id. Custom backends
should accept and log it.

## Server: FastAPI + StreamingResponse

The completion route returns FastAPI's `StreamingResponse` wrapping an
`AsyncIterator[bytes]` from
[`services.completion`](../../backend/src/inkwell_backend/services/completion.py).
Each yield is a pre-encoded SSE event (the encoder lives in
[`domain.sse`](../../backend/src/inkwell_backend/domain/sse.py));
the route handler never touches business logic.

Rate limiting is done with an **in-memory per-IP sliding window** (see
[`services/rate_limit.py`](../../backend/src/inkwell_backend/services/rate_limit.py)).
For that counter to mean anything it has to survive between requests —
which is fine for a long-running uvicorn process. If you scale to
multiple replicas or want a hard quota, swap the in-process store for
Redis without changing any caller.

## Backpressure and cancellation

The pipeline polls `request.is_disconnected()` between every chunk
emitted by the provider stream. Starlette flips that flag the moment
the underlying ASGI server sees a TCP RST / half-close, so client
hang-ups free OpenAI's stream immediately rather than after the next
network event:

```python
async for chunk in provider_stream:
    if await input_.is_disconnected():
        # User cancelled; tear down the upstream stream cleanly.
        break
    if chunk.delta:
        yield token_event({"delta": chunk.delta})
```

The `finally` block calls the provider stream's `aclose()` so the SDK's
underlying httpx connection is released, then emits a single metadata
log line via
[`services.audit.log_completion`](../../backend/src/inkwell_backend/services/audit.py)
with `status: 500, error_code: STREAM_ABORTED` when the disconnect
happens mid-stream.

## Completion logging

`log_completion` writes one structured JSON line to stdout — metadata
only (action, model, token counts, latency, status, client IP key). It
is synchronous and never throws, so logging can't break the response.
There is no database; the JSON lines are picked up by whatever log
drain you attach to the host.

## Client consumption (extension)

The background service worker holds the `fetch().body.getReader()` and
parses SSE events itself rather than using `EventSource`. Why?

- `EventSource` doesn't support custom headers — we need
  `Authorization: Bearer …` when the user has configured one.
- The MV3 service worker can be terminated; an active SSE connection
  keeps it alive for the duration of the stream.
- Manual parsing lets us validate every event with the shared zod
  schemas before forwarding to the content script.

See [`background/api-client.ts`](../../frontend/packages/extension/src/background/api-client.ts).

## See also

- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete)
- [Reference: Architecture](../reference/architecture.md)
- [Three rewrite modes](./three-rewrite-modes.md)
