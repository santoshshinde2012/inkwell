"""FastAPI app factory.

``app`` is the module-level instance Uvicorn (and the Dockerfile) load
via ``inkwell_backend.main:app``. :func:`create_app` exists for tests
that want a fresh instance per case.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .api.middleware import install as install_middleware
from .api.v1 import router as v1_router
from .api.v1.health import mark_ready, mark_unready
from .logging_setup import configure_logging
from .providers import aclose_all_providers
from .settings import Settings, get_settings

_logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hooks.

    Two jobs:

    * Flip the readiness flag so ``GET /api/v1/ready`` starts returning
      200 once the worker has finished warming up. Rolling deploys
      hold traffic off until this fires.
    * Close every registered provider's upstream resources on shutdown
      so a graceful SIGTERM doesn't leave dangling connections. The
      provider package decides what "close" means per vendor — this
      hook stays vendor-neutral.
    """
    settings: Settings = app.state.settings
    _logger.info(
        "inkwell-backend ready",
        extra={
            "version": __version__,
            "environment": settings.environment,
            "has_openai": settings.has_openai,
        },
    )
    mark_ready()
    try:
        yield
    finally:
        # mark unready BEFORE we close upstream resources so in-flight
        # readiness probes flip to 503 first.
        mark_unready()
        await aclose_all_providers()
        _logger.info("inkwell-backend shutting down")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a fully configured FastAPI app.

    Tests can pass a custom :class:`Settings` to override values
    without monkey-patching env vars.
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Inkwell API",
        version=__version__,
        description="Backend for the Inkwell extension — chat completion + OCR.",
        # /docs and /openapi.json are useful in dev but expose internals;
        # disable in production unless explicitly needed.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=_lifespan,
    )
    app.state.settings = settings

    install_middleware(app)
    app.include_router(v1_router)

    return app


# Module-level instance for `uvicorn inkwell_backend.main:app`.
app = create_app()
