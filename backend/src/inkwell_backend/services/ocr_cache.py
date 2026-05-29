"""In-memory OCR result cache.

Cache key is ``sha256(model || 0x00 || canonical_base64)``: the same
image OCR'd with the same model is deterministic, so re-running the
right-click context menu on the same screenshot (or re-uploading a
file the user already extracted from in this side panel session)
returns instantly without billing another vision-model call.

Why this lives here and not in a Redis layer: a process-local TTL+LRU
covers the dominant cost case — a user re-clicking the same image —
with zero infra. The interface is intentionally small so swapping in a
shared cache later is mechanical (a new implementation behind the same
two methods).

Concurrency note: a single asyncio event loop runs cooperatively, and
neither ``get`` nor ``put`` ``await`` between the dict lookup and the
mutation, so the operations are atomic with respect to other
coroutines. The cache is therefore safe to use without an asyncio
lock.
"""

from __future__ import annotations

import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Final

from ..domain.schemas import OcrResponse

# Tuned for a single-process, single-tenant deployment. ~256 entries at
# a few KB each is well under a megabyte, and 24 h is short enough that
# screenshots of dashboards / chat threads that change daily don't
# return stale text.
_DEFAULT_MAX_ENTRIES: Final[int] = 256
_DEFAULT_TTL_SECONDS: Final[int] = 24 * 60 * 60


def make_cache_key(model: str, canonical_image_base64: str) -> str:
    """Cache key for an (model, image) pair.

    ``canonical_image_base64`` must already have whitespace stripped —
    we hash the bytes as-is, so a stray newline would produce a cache
    miss. The OCR pipeline canonicalises the base64 before calling
    this function (and before calling the provider), so both paths see
    the same input.
    """
    digest = hashlib.sha256()
    digest.update(model.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(canonical_image_base64.encode("utf-8"))
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class _Entry:
    """One cache entry. ``inserted_at`` is monotonic seconds — robust
    against wall-clock jumps (NTP adjust, container time skew)."""

    inserted_at: float
    value: OcrResponse


class OcrResultCache:
    """Bounded TTL+LRU mapping from ``(model, image)`` → ``OcrResponse``."""

    def __init__(
        self,
        *,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
        ttl_seconds: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be >= 1")
        if ttl_seconds < 1:
            raise ValueError("ttl_seconds must be >= 1")
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._entries: OrderedDict[str, _Entry] = OrderedDict()

    def get(self, key: str) -> OcrResponse | None:
        """Return the cached response for ``key`` or ``None`` on miss /
        expiry. Expired entries are dropped lazily on access."""
        entry = self._entries.get(key)
        if entry is None:
            return None
        if time.monotonic() - entry.inserted_at > self._ttl_seconds:
            # Lazy eviction — cheaper than a sweeping timer and good
            # enough for a per-process LRU.
            self._entries.pop(key, None)
            return None
        # Touch — LRU bookkeeping.
        self._entries.move_to_end(key)
        return entry.value

    def put(self, key: str, value: OcrResponse) -> None:
        """Insert (or refresh) an entry. Evicts the oldest entries when
        the cache is over capacity."""
        self._entries[key] = _Entry(inserted_at=time.monotonic(), value=value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        """Drop every entry. Primarily for tests."""
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


# Process-wide singleton. The OCR pipeline imports this directly; tests
# can construct their own ``OcrResultCache`` to keep state isolated.
ocr_result_cache: Final[OcrResultCache] = OcrResultCache()
