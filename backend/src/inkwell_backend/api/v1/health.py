"""Health + meta endpoints.

Three endpoints with three jobs:

* ``GET /health`` — back-compat liveness probe. Same shape as before.
* ``GET /live``   — pure process-alive check. Always 200 once Python is
  running; this is what a Kubernetes ``livenessProbe`` should hit.
* ``GET /ready``  — readiness gate. Returns 503 until the FastAPI
  lifespan startup has completed, so rolling deploys / load balancers
  don't route traffic into a worker that hasn't finished warming up.
  Once warm, returns 200.

Readiness state is a single module-level flag flipped in the lifespan
hook (see ``main.py``). No background tasks, no async polling.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ... import __version__
from ...domain.schemas import Health
from ..deps import origin_header
from ..responses import json_error, json_ok

router = APIRouter()

# Flipped to True from the FastAPI lifespan startup hook in main.py.
# Read by /ready; never used elsewhere.
_ready: bool = False


def mark_ready() -> None:
    """Flag the process as ready to accept traffic. Called from the
    lifespan startup hook in :mod:`inkwell_backend.main`."""
    global _ready
    _ready = True


def mark_unready() -> None:
    """Flag the process as draining. Called from the lifespan shutdown
    hook so in-flight readiness probes flip to 503 before the worker
    actually stops accepting connections."""
    global _ready
    _ready = False


def _health_payload() -> Health:
    return Health(
        ok=True,
        version=__version__,
        runtime="fastapi",
        timestamp=datetime.now(tz=UTC).isoformat(),
    )


@router.get(
    "/health",
    response_model=Health,
    summary="Liveness probe (legacy /health)",
    tags=["health"],
)
async def health(origin: str | None = Depends(origin_header)) -> JSONResponse:
    return json_ok(_health_payload().model_dump(mode="json"), origin)


@router.get(
    "/live",
    response_model=Health,
    summary="Process liveness probe",
    tags=["health"],
)
async def live(origin: str | None = Depends(origin_header)) -> JSONResponse:
    return json_ok(_health_payload().model_dump(mode="json"), origin)


@router.get(
    "/ready",
    response_model=Health,
    summary="Process readiness probe",
    tags=["health"],
    responses={503: {"description": "Not ready yet"}},
)
async def ready(origin: str | None = Depends(origin_header)) -> JSONResponse:
    if not _ready:
        # 503 before lifespan-startup completes; rolling deploys read
        # this to delay traffic until the worker has warmed up.
        from ...domain.errors import ErrorCode, api_error

        return json_error(
            api_error(ErrorCode.NETWORK_ERROR, "Not ready"),
            origin,
        )
    return json_ok(_health_payload().model_dump(mode="json"), origin)
