# Streaming design

_Why `/api/v1/complete` is the way it is — runtime choice, SSE event
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

The shapes are zod-validated on both ends. See
[shared/src/schemas.ts § SSE payloads](../../packages/shared/src/schemas.ts).

## Runtime choice (Node, not Edge)

The backend runs `/api/v1/complete` on the **Node** runtime.

### Why Edge would be tempting

- Lower TTFB (~50ms vs ~300ms cold start)
- Native streaming
- Runs near the user's region

### Why we chose Node

Rate limiting is done with an **in-memory per-IP sliding window** (see
[`lib/rate-limit.ts`](../../packages/backend/lib/rate-limit.ts)). For that
counter to mean anything it has to survive between requests — and Node
functions on Vercel stay warm for several minutes, whereas Edge isolates
are recreated aggressively and would reset the map almost every request.

Trade-off:

- **Pro of Node:** the in-memory rate limiter actually blunts bursts.
- **Con of Node:** ~200ms additional cold-start latency.

Node functions on Vercel stream `ReadableStream` responses natively, so
the user-facing streaming UX is identical to the Edge variant.

### If you need Edge-level TTFB

Move rate limiting to a shared store (Vercel KV / Upstash / Cloudflare
KV) keyed by IP, then `/complete` becomes stateless and can run on Edge.
We haven't done this because the in-memory limiter is adequate for the
current scale and adds no external dependency.

## Backpressure and cancellation

The Node handler wires a `ReadableStream` to OpenAI's stream:

```ts
const abort = new AbortController();
request.signal.addEventListener("abort", () => abort.abort());

const stream = new ReadableStream({
  async start(controller) {
    for await (const chunk of streamCompletion({ ..., signal: abort.signal })) {
      if (chunk.delta) sseToken(controller, { delta: chunk.delta });
      // ...
    }
  },
  cancel() { abort.abort(); }
});
```

When the client disconnects, `request.signal` aborts. That cascades into
the OpenAI request, freeing server resources. The SDK catches the
`AbortError`, the `finally` block emits the metadata log line (with
`status: 500, errorCode: STREAM_ABORTED`), and `controller.close()` ends
the stream cleanly.

## Completion logging

Inside the stream's `finally` block we emit one structured JSON line to
stdout via [`logCompletion`](../../packages/backend/lib/audit-log.ts) —
metadata only (action, model, token counts, latency, status, client IP
key). It is synchronous and never throws, so logging can't break the
response. There is no database; logs are picked up by Vercel and any log
drain you attach.

## Client consumption (extension)

The background service worker holds the `fetch().body.getReader()` and
parses SSE events itself rather than using `EventSource`. Why?

- `EventSource` doesn't support custom headers — we need
  `Authorization: Bearer …`.
- The MV3 service worker can be terminated; an active SSE connection
  keeps it alive for the duration of the stream.
- Manual parsing lets us validate every event with the shared zod
  schemas before forwarding to the content script.

See [`background/api-client.ts`](../../packages/extension/src/background/api-client.ts).

## See also

- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete)
- [Reference: Architecture](../reference/architecture.md)
- [Three rewrite modes](./three-rewrite-modes.md)
