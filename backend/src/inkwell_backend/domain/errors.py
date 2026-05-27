"""Stable, machine-readable error codes.

Returned in JSON error bodies and re-emitted as SSE ``error`` events.
The extension UI maps codes → user-friendly copy. Raw exception details
must never leak to the client. Mirrors `@inkwell/shared/errors`.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, assert_never

from pydantic import BaseModel, ConfigDict, Field


class ErrorCode(StrEnum):
    """Stable codes the extension switches on."""

    # Authorization / policy
    FORBIDDEN = "FORBIDDEN"
    ORIGIN_NOT_ALLOWED = "ORIGIN_NOT_ALLOWED"
    SITE_BLOCKED = "SITE_BLOCKED"

    # Input
    VALIDATION_FAILED = "VALIDATION_FAILED"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"

    # Limits / availability
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"
    TIMEOUT = "TIMEOUT"

    # Streaming
    STREAM_ABORTED = "STREAM_ABORTED"

    # Catch-alls
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"


_RETRYABLE: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.UPSTREAM_ERROR,
        ErrorCode.TIMEOUT,
        ErrorCode.NETWORK_ERROR,
        ErrorCode.STREAM_ABORTED,
    }
)


def is_retryable(code: ErrorCode) -> bool:
    return code in _RETRYABLE


class ApiError(BaseModel):
    """The shape returned in JSON error bodies and SSE ``error`` events.

    Use the :func:`api_error` factory below — it derives ``retryable``
    from the code, so callers can't accidentally set the wrong combo.
    """

    model_config = ConfigDict(frozen=True)

    code: ErrorCode
    message: str
    retryable: bool
    details: dict[str, Any] | None = Field(default=None)


def api_error(
    code: ErrorCode,
    message: str,
    details: dict[str, Any] | None = None,
) -> ApiError:
    """Construct an :class:`ApiError` with ``retryable`` derived from ``code``."""
    return ApiError(
        code=code,
        message=message,
        retryable=is_retryable(code),
        details=details,
    )


def status_for_code(code: ErrorCode) -> int:
    """HTTP status corresponding to a given :class:`ErrorCode`.

    The match is exhaustive; ``assert_never`` makes mypy --strict fail
    at type-check time when a new ``ErrorCode`` member is added without
    a status mapping. Easier to catch in CI than at runtime.
    """
    match code:
        case ErrorCode.FORBIDDEN | ErrorCode.ORIGIN_NOT_ALLOWED | ErrorCode.SITE_BLOCKED:
            return 403
        case ErrorCode.VALIDATION_FAILED:
            return 400
        case ErrorCode.PAYLOAD_TOO_LARGE:
            return 413
        case ErrorCode.RATE_LIMITED | ErrorCode.QUOTA_EXCEEDED:
            return 429
        case ErrorCode.UPSTREAM_ERROR:
            return 502
        case ErrorCode.TIMEOUT:
            return 504
        case ErrorCode.STREAM_ABORTED:
            return 499  # client-closed-request, nginx convention
        case ErrorCode.NETWORK_ERROR:
            return 503
        case ErrorCode.INTERNAL_ERROR:
            return 500
        case _:  # pragma: no cover — guarded by assert_never below
            assert_never(code)
