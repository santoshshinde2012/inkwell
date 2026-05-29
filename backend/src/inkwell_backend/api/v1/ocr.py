"""POST /api/v1/ocr — image-to-text via a vision model.

The route handler is a thin wrapper; all logic is in
:mod:`inkwell_backend.services.ocr`.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from ...domain.errors import ApiError, ErrorCode, api_error
from ...domain.limits import MAX_OCR_REQUEST_BYTES
from ...domain.schemas import OcrRequest, OcrResponse
from ...services.ocr import OcrInput, OcrStream, run_ocr, run_ocr_stream
from ..deps import client_ip, client_request_id, origin_header
from ..responses import json_error, json_ok, sse_headers

_logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/ocr",
    summary="Recognise text from an image",
    # The endpoint content-negotiates: clients sending
    # ``Accept: text/event-stream`` get a streamed SSE response; the
    # default JSON contract is preserved for callers (like the
    # right-click context-menu path) that want the whole text in one
    # shot. ``response_model`` is suppressed because the success body
    # has two possible shapes.
    response_class=JSONResponse,
    response_model=None,
    responses={
        200: {
            "description": "Recognised text (JSON) or SSE stream of deltas",
            "content": {
                "application/json": {"schema": OcrResponse.model_json_schema()},
                "text/event-stream": {},
            },
        },
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
) -> JSONResponse | StreamingResponse:
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

    pipeline_input = OcrInput(
        client_key=ip,
        request=parsed,
        content_bytes=content_bytes,
        is_disconnected=request.is_disconnected,
        request_id=request_id,
    )

    if _wants_event_stream(request):
        try:
            stream_result = run_ocr_stream(pipeline_input)
        except Exception:
            _logger.exception("ocr stream pipeline failed")
            return json_error(
                api_error(ErrorCode.INTERNAL_ERROR, "Internal error"),
                origin,
            )
        if isinstance(stream_result, OcrStream):
            return StreamingResponse(
                stream_result.chunks,
                status_code=200,
                headers=sse_headers(origin),
                media_type="text/event-stream",
            )
        # Pre-flight error (size / rate limit) — surface as JSON even on
        # the SSE-accepting path. Streaming clients fall back to their
        # JSON-error parser; nobody has to invent a synthetic SSE error
        # frame.
        return _json_error_with_retry_after(stream_result, origin)

    try:
        result = await run_ocr(pipeline_input)
    except Exception:
        _logger.exception("ocr pipeline failed")
        return json_error(
            api_error(ErrorCode.INTERNAL_ERROR, "Internal error"),
            origin,
        )

    if isinstance(result, OcrResponse):
        return json_ok(result.model_dump(mode="json", exclude_none=True), origin)

    return _json_error_with_retry_after(result, origin)


def _wants_event_stream(request: Request) -> bool:
    """True when the client opted into SSE via the Accept header.

    Loose substring match — we don't need RFC-9110 q-value parsing;
    real clients either set ``Accept: text/event-stream`` exactly or
    list it alongside JSON. Anything not asking for the SSE shape
    falls through to the JSON contract.
    """
    accept = request.headers.get("accept", "")
    return "text/event-stream" in accept.lower()


def _json_error_with_retry_after(error: ApiError, origin: str | None) -> JSONResponse:
    extra: dict[str, str] = {}
    if error.code == ErrorCode.RATE_LIMITED and error.details:
        ms = error.details.get("retryAfterMs")
        if isinstance(ms, int) and ms > 0:
            extra["Retry-After"] = str(max(1, ms // 1000))
    return json_error(error, origin, extra_headers=extra or None)
