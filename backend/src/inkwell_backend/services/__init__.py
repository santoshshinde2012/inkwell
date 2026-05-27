"""Domain orchestration — pure logic with no HTTP coupling.

Each pipeline takes a typed input (already validated at the boundary),
runs sanitization + injection checks + rate limits + provider calls,
and produces either a streaming response (completion) or a final
payload (OCR). The route handlers in ``api/v1/`` are thin wrappers.
"""
