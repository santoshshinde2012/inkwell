"""In-process sliding-window rate limiter.

There is no authentication and no database, so we cannot rate-limit per
user account. The next-best key is the client IP, extracted from
``X-Forwarded-For`` / ``X-Real-IP`` (set by every reverse proxy worth
running in front of this service).

The store is in-memory. Caveats, accepted deliberately:

* Counters reset on cold start.
* Counters are not shared across workers / replicas.

This is a best-effort burst guard for the OpenAI key, not a hard quota.
A serverless instance stays warm for a few minutes, which is enough to
blunt a runaway client. For a hard quota you would need a shared store
(Redis, KV, etc.); plug it in here without changing any caller.

Two sliding windows are enforced together: 20/min and 500/day.

Why two clocks: timestamps are recorded in ``time.monotonic()`` ms so
the window math is immune to wall-clock jumps (DST, NTP slew). The
``reset_ms`` we return to the client is wall-clock ms because that's
what client code converts back to a human-readable "try again at…".
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RateLimitVerdict:
    """Result of a single ``check_rate_limit`` call."""

    success: bool
    limit: int
    remaining: int
    reset_ms: int


PER_MINUTE_LIMIT: int = 20
PER_DAY_LIMIT: int = 500

_MINUTE_MS: int = 60_000
_DAY_MS: int = 24 * 60 * 60 * 1_000
_SWEEP_INTERVAL_MS: int = 5 * _MINUTE_MS

# Mapping of client-ip → deque of monotonic-ms timestamps within the
# last day, newest-last. A deque lets the per-call prune be O(stale
# entries) rather than O(window size).
_hits: dict[str, deque[int]] = {}
_last_sweep_ms: int = 0
_lock = threading.Lock()  # protects _hits + _last_sweep_ms


def _now_ms() -> int:
    return int(time.monotonic() * 1_000)


def _wall_now_ms() -> int:
    # Wall clock — used for the "reset" hint we hand back to the client.
    return int(time.time() * 1_000)


def _drop_stale(timestamps: deque[int], cutoff_ms: int) -> None:
    """Drop entries older than ``cutoff_ms`` from the left."""
    while timestamps and timestamps[0] < cutoff_ms:
        timestamps.popleft()


def _sweep(now_ms: int) -> None:
    """Opportunistically drop fully-expired buckets.

    Caller MUST hold ``_lock``. Keeps the map bounded for one-shot IPs
    without a separate background thread.
    """
    global _last_sweep_ms
    if now_ms - _last_sweep_ms < _SWEEP_INTERVAL_MS:
        return
    _last_sweep_ms = now_ms
    day_cutoff = now_ms - _DAY_MS
    stale_keys: list[str] = []
    for key, timestamps in _hits.items():
        _drop_stale(timestamps, day_cutoff)
        if not timestamps:
            stale_keys.append(key)
    for key in stale_keys:
        del _hits[key]


def check_rate_limit(client_key: str) -> RateLimitVerdict:
    """Record one hit against ``client_key`` and report whether it's allowed."""
    now_ms = _now_ms()
    with _lock:
        _sweep(now_ms)

        timestamps = _hits.setdefault(client_key, deque())
        _drop_stale(timestamps, now_ms - _DAY_MS)

        # Count how many of the remaining hits are within the last
        # minute. The deque is newest-last, so we walk from the tail.
        minute_cutoff = now_ms - _MINUTE_MS
        in_minute = 0
        for ts in reversed(timestamps):
            if ts < minute_cutoff:
                break
            in_minute += 1

        wall = _wall_now_ms()
        if in_minute >= PER_MINUTE_LIMIT:
            return RateLimitVerdict(
                success=False,
                limit=PER_MINUTE_LIMIT,
                remaining=0,
                reset_ms=wall + _MINUTE_MS,
            )
        if len(timestamps) >= PER_DAY_LIMIT:
            return RateLimitVerdict(
                success=False,
                limit=PER_DAY_LIMIT,
                remaining=0,
                reset_ms=wall + _DAY_MS,
            )

        timestamps.append(now_ms)
        return RateLimitVerdict(
            success=True,
            limit=PER_MINUTE_LIMIT,
            remaining=PER_MINUTE_LIMIT - in_minute - 1,
            reset_ms=wall + _MINUTE_MS,
        )


def reset_for_tests() -> None:
    """Drop all counters. Used only by tests — not part of the public API."""
    with _lock:
        _hits.clear()
        global _last_sweep_ms
        _last_sweep_ms = 0
