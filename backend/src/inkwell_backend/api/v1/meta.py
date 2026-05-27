"""Read-only metadata endpoints.

* ``GET /version`` — backend version + runtime + boot time. Useful
  for confirming a rolling deploy actually rolled.
* ``GET /models``  — the model catalog the backend recognises. The
  extension embeds its own copy today; this endpoint exists so a
  future build can fetch the live catalog and stop drifting.

Both are anonymous and unmetered (cheap reads, no provider call).
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from ... import __version__
from ...domain.models import DEFAULT_MODEL_ID, MODEL_CATALOG
from ..deps import origin_header
from ..responses import json_ok

router = APIRouter()

# Captured once at module import — used so /version can report
# how long the process has been alive. Wall clock is fine here;
# the value is for humans, not duration math.
_BOOT_AT: str = datetime.now(tz=UTC).isoformat()


class VersionInfo(BaseModel):
    """Shape of the /version response."""

    model_config = ConfigDict(extra="forbid")
    version: str
    runtime: str
    boot_at: str


@router.get(
    "/version",
    response_model=VersionInfo,
    summary="Backend version + boot timestamp",
    tags=["meta"],
)
async def version(origin: str | None = Depends(origin_header)) -> JSONResponse:
    body = VersionInfo(version=__version__, runtime="fastapi", boot_at=_BOOT_AT)
    return json_ok(body.model_dump(mode="json"), origin)


@router.get(
    "/models",
    summary="Model catalog the backend recognises",
    tags=["meta"],
)
async def models(origin: str | None = Depends(origin_header)) -> JSONResponse:
    # ``MODEL_CATALOG`` is a tuple of frozen dataclasses; ``asdict``
    # converts each entry to a JSON-friendly dict. The StrEnum
    # ``provider`` field serialises to its string value automatically.
    return json_ok(
        {
            "default": DEFAULT_MODEL_ID,
            "models": [asdict(m) for m in MODEL_CATALOG],
        },
        origin,
    )
