"""Structured logging setup.

Logs go to stdout as one JSON object per line, which is the shape every
log drain (GCP Cloud Logging, AWS CloudWatch, Datadog, Loki, …) consumes
natively. No content from prompts or completions is ever logged — only
request metadata. See ``services.audit`` for the schema of completion
events.

A single ``configure_logging()`` call from the app factory replaces the
root handler with our JSON formatter; everything else uses
``logging.getLogger(__name__)`` as normal.
"""

from __future__ import annotations

import logging
import logging.config
import sys
from typing import Any, Final

from pythonjsonlogger import jsonlogger

_DEFAULT_FIELDS: Final[str] = (
    "%(asctime)s %(name)s %(levelname)s %(message)s %(module)s %(funcName)s %(lineno)d"
)


class _Formatter(jsonlogger.JsonFormatter):
    """Stable JSON shape with ISO-8601 timestamps."""

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        # ``asctime`` lands as an arbitrary local-time string by default —
        # swap to ISO-8601 UTC so log drains can sort/filter on it.
        log_record["ts"] = self.formatTime(record, "%Y-%m-%dT%H:%M:%S.%fZ")
        log_record.pop("asctime", None)
        # Make the level name lowercase ("info") to match the convention
        # in audit logs and most log-drain UIs.
        log_record["level"] = record.levelname.lower()
        log_record.pop("levelname", None)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger.

    Idempotent — calling twice (e.g. from tests + the app factory) is
    safe; previous handlers are replaced.
    """
    root = logging.getLogger()
    # Clear any handlers Uvicorn or pytest may have already attached so
    # we don't end up writing every log line twice in different formats.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    # `python-json-logger`'s base class has an untyped __init__; the
    # ignore is the one concession we make for the third-party stub.
    handler.setFormatter(_Formatter(_DEFAULT_FIELDS))  # type: ignore[no-untyped-call]
    root.addHandler(handler)
    root.setLevel(level)

    # Tone down libraries that log per-request at INFO. The metadata we
    # care about is emitted by ``services.audit`` at INFO; Uvicorn's
    # access log adds noise on top of that for no extra signal.
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
