"""Top-level /api/v1 router.

Composes the per-endpoint routers into a single APIRouter mounted by
the FastAPI app factory.
"""

from __future__ import annotations

from fastapi import APIRouter

from .complete import router as complete_router
from .health import router as health_router
from .meta import router as meta_router
from .ocr import router as ocr_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(meta_router)
router.include_router(complete_router)
router.include_router(ocr_router)
