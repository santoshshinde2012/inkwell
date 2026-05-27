"""POST /api/v1/ocr — image-to-text via a vision model.

The route handler is a thin wrapper; all logic is in
:mod:`inkwell_backend.services.ocr`.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ...domain.errors import ApiError, ErrorCode, api_error
from ...domain.limits import MAX_OCR_REQUEST_BYTES
from ...domain.schemas import OcrRequest, OcrResponse
from ...services.ocr import OcrInput, run_ocr
from ..deps import client_ip, client_request_id, origin_header
from ..responses import json_error, json_ok

_logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/ocr",
    summary="Recognise text from an image",
    responses={
        200: {"model": OcrResponse},
        400: {"description": "Validation failed", "model": ApiError},
        413: {"description": "Image too large", "model": ApiError},
        429: {"description": "Rate limited", "model": ApiError},
    },
    tags=["ocr"],
)
async def ocr(
    request: Request,
    origin: str | None = Depends(origin_header),
    ip: str = Depends(client_ip),
    request_id: str | None = Depends(client_request_id),
) -> JSONResponse:
    del request_id  # reserved for future audit logging on OCR
    content_bytes = int(request.headers.get("content-length") or 0)

    # Short-circuit grossly oversized bodies before parsing them — we
    # don't want to materialise a 50 MB JSON object in memory just to
    # validate it. The pipeline also enforces the cap on the parsed
    # body; this just saves the allocation.
    if content_bytes > MAX_OCR_REQUEST_BYTES:
        return json_error(
            api_error(ErrorCode.PAYLOAD_TOO_LARGE, "Image is too large for OCR."),
            origin,
        )

    try:
        raw = await request.body()
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return json_error(
            api_error(ErrorCode.VALIDATION_FAILED, "Body is not valid JSON"),
            origin,
        )

    try:
        parsed = OcrRequest.model_validate(payload)
    except ValidationError:
        return json_error(
            api_error(
                ErrorCode.VALIDATION_FAILED,
                "OCR request is missing or malformed.",
            ),
            origin,
        )

    try:
        result = await run_ocr(
            OcrInput(
                client_key=ip,
                request=parsed,
                content_bytes=content_bytes,
                is_disconnected=request.is_disconnected,
            )
        )
    except Exception:
        _logger.exception("ocr pipeline failed")
        return json_error(
            api_error(ErrorCode.INTERNAL_ERROR, "Internal error"),
            origin,
        )

    if isinstance(result, OcrResponse):
        return json_ok(result.model_dump(mode="json", exclude_none=True), origin)

    extra: dict[str, str] = {}
    if result.code == ErrorCode.RATE_LIMITED and result.details:
        ms = result.details.get("retryAfterMs")
        if isinstance(ms, int) and ms > 0:
            extra["Retry-After"] = str(max(1, ms // 1000))
    return json_error(result, origin, extra_headers=extra or None)
