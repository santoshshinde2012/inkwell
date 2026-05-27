"""Server-Sent Events encoders.

The /api/v1/complete stream emits four named events — `token`, `usage`,
`done`, and `error` — that the extension's stream parser consumes
directly. A fifth control frame (an SSE comment) is emitted as a
periodic heartbeat so idle reverse proxies don't reap the connection
mid-generation.

Format on the wire is plain SSE::

    event: token
    data: {"delta": "Hello"}

    event: done
    data: {"ok": true}

We pre-encode each event to ``bytes`` because FastAPI's
``StreamingResponse`` expects bytes / strings; bytes save one decode hop
per token.
"""

from __future__ import annotations

import json
from typing import Any, Final, Literal

# The full set of named events. Typed as a ``Literal`` so the encoder
# can't be called with a fresh string at the call site (mypy would
# catch ``_encode("tokeen", ...)`` immediately).
SseEventName = Literal["token", "usage", "done", "error"]

# Heartbeat is an SSE *comment* line — clients ignore it, but it keeps
# the TCP pipe warm so an idle reverse-proxy timeout doesn't cut the
# stream during long generations. 15s is well under the default 30-60s
# nginx / Cloudflare idle window.
HEARTBEAT_INTERVAL_S: Final[float] = 15.0
_HEARTBEAT_BYTES: Final[bytes] = b": keep-alive\n\n"


def _encode(event_name: SseEventName, payload: dict[str, Any]) -> bytes:
    # SSE spec: each field on its own line, blank line terminates a
    # message. JSON-compact (no whitespace) shaves bytes off every token.
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event_name}\ndata: {body}\n\n".encode()


def token_event(payload: dict[str, Any]) -> bytes:
    return _encode("token", payload)


def usage_event(payload: dict[str, Any]) -> bytes:
    return _encode("usage", payload)


def error_event(payload: dict[str, Any]) -> bytes:
    return _encode("error", payload)


def done_event() -> bytes:
    return _encode("done", {"ok": True})


def heartbeat_event() -> bytes:
    """A no-op SSE comment that keeps idle proxies from closing the
    stream. The client's parser drops lines starting with ``:`` per the
    SSE spec, so this is invisible to the application layer."""
    return _HEARTBEAT_BYTES
