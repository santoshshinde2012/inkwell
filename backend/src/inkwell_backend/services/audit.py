"""Metadata-only request logging.

There is no database. Logs go to stdout as structured JSON, picked up by
whatever log drain the operator attaches.

We log ONLY metadata: action, model, token counts, request size,
latency, status. Prompt content, completion content, user-supplied free
text — never logged. ``client_key`` is the IP-derived rate-limit key
(there are no user accounts); it exists so abuse can be correlated.
"""

from __future__ import annotations

import contextlib
import logging
from dataclasses import asdict, dataclass

from ..domain.actions import Action

_logger = logging.getLogger("inkwell.audit")


@dataclass(frozen=True, slots=True)
class CompletionLogEvent:
    """One row in the completion audit stream."""

    client_key: str
    action: Action
    model: str
    request_bytes: int
    duration_ms: int
    status: int
    source_language: str | None = None
    target_language: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    error_code: str | None = None
    client_request_id: str | None = None


def log_completion(event: CompletionLogEvent) -> None:
    """Record a completion event as a single structured log line.

    Never raises — logging must not break the user-visible response.
    A failure inside the logging stack itself is unrecoverable from
    here (and unimportant for correctness), so we suppress it rather
    than tear down a perfectly good response stream.

    The payload is wrapped in a single ``event`` key on the LogRecord
    so it can't collide with reserved attributes (``message``,
    ``args``, ``module``, …) the stdlib uses, and the JSON formatter
    can lift it cleanly into the output line.
    """
    with contextlib.suppress(Exception):
        payload = {k: v for k, v in asdict(event).items() if v is not None}
        _logger.info("log.completion", extra={"kind": "log.completion", "event": payload})
