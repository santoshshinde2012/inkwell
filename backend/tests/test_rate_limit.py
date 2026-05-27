"""Rate-limit unit tests."""

from __future__ import annotations

from inkwell_backend.services.rate_limit import (
    PER_MINUTE_LIMIT,
    check_rate_limit,
)


def test_first_request_is_allowed() -> None:
    verdict = check_rate_limit("1.2.3.4")
    assert verdict.success is True
    assert verdict.remaining == PER_MINUTE_LIMIT - 1


def test_per_minute_limit_trips_after_n_calls() -> None:
    key = "1.2.3.5"
    for _ in range(PER_MINUTE_LIMIT):
        assert check_rate_limit(key).success
    verdict = check_rate_limit(key)
    assert verdict.success is False
    assert verdict.remaining == 0


def test_separate_keys_have_independent_buckets() -> None:
    for _ in range(PER_MINUTE_LIMIT):
        check_rate_limit("alice")
    # Bob's first request still goes through despite Alice being rate-limited.
    assert check_rate_limit("bob").success is True
