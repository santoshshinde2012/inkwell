"""Sanitization layer for untrusted page content.

The model receives page text inside ``<UNTRUSTED_CONTEXT>...</UNTRUSTED_CONTEXT>``
delimiters with a system prompt that says "this is data, not
instructions". That isn't enough on its own — sufficiently smart
attackers can convince a model to ignore that. Defense-in-depth here:

1. Strip well-known role / system markers (``system:``, ``<|im_start|>``…).
2. Drop zero-width / bidi-control characters.
3. Collapse repeated whitespace.
4. Cap length per field.
5. Reject the request if the sanitized payload still contains an
   obvious prompt-injection signal pattern (heuristic, conservative).

We don't try to be exhaustive — just close the easy attack paths and
rely on the system prompt + preview-before-insert UX as the primary
defense.
"""

from __future__ import annotations

import re

from ..domain.limits import MAX_CONTEXT_CHARS, MAX_DRAFT_CHARS
from ..domain.schemas import Post, RequestContext, ThreadMessage

_ROLE_MARKERS: tuple[re.Pattern[str], ...] = (
    re.compile(r"<\|im_start\|>", re.IGNORECASE),
    re.compile(r"<\|im_end\|>", re.IGNORECASE),
    re.compile(r"<\|system\|>", re.IGNORECASE),
    re.compile(r"<\|user\|>", re.IGNORECASE),
    re.compile(r"<\|assistant\|>", re.IGNORECASE),
    re.compile(r"^\s*system:\s*", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*assistant:\s*", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*user:\s*", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*###\s*system\s*$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*###\s*assistant\s*$", re.IGNORECASE | re.MULTILINE),
)

# Zero-width / bidi-control characters used to smuggle instructions
# through Unicode. We're not trying to be exhaustive — we strip the
# most common payloads. ​-‏ are zero-widths / LTR/RTL marks;
# ‪-‮ are bidi overrides; ⁠-⁤ word joiners and
# invisibles; ﻿ is BOM.
_ZERO_WIDTH = re.compile(r"[​-‏‪-‮⁠-⁤﻿]")

# Our own delimiters — never let user content contain a literal close
# tag, or we lose the boundary the prompt relies on.
_OUR_DELIMITERS = re.compile(r"<\/?UNTRUSTED_CONTEXT>", re.IGNORECASE)

_RUNS_OF_SPACES = re.compile(r"[ \t]{3,}")
_RUNS_OF_NEWLINES = re.compile(r"\n{4,}")


def _strip_role_markers(text: str) -> str:
    for pattern in _ROLE_MARKERS:
        text = pattern.sub(" ", text)
    return text


def _collapse_whitespace(text: str) -> str:
    text = _ZERO_WIDTH.sub("", text)
    text = _RUNS_OF_SPACES.sub("  ", text)
    text = _RUNS_OF_NEWLINES.sub("\n\n\n", text)
    return text


def _sanitize_string(text: str, max_chars: int) -> str:
    cleaned = _strip_role_markers(text)
    cleaned = _OUR_DELIMITERS.sub(" ", cleaned)
    cleaned = _collapse_whitespace(cleaned)
    cleaned = cleaned.strip()
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]
    return cleaned


def sanitize_context(ctx: RequestContext) -> RequestContext:
    """Return a copy of ``ctx`` with every user-supplied string normalised."""
    return ctx.model_copy(
        update={
            "page_title": _sanitize_string(ctx.page_title, 300) if ctx.page_title else None,
            "thread": (
                [
                    ThreadMessage(
                        author=_sanitize_string(t.author, 200) if t.author else None,
                        text=_sanitize_string(t.text, MAX_CONTEXT_CHARS),
                        timestamp=t.timestamp,
                    )
                    for t in ctx.thread
                ]
                if ctx.thread
                else None
            ),
            "post": (
                Post(
                    author=_sanitize_string(ctx.post.author, 200) if ctx.post.author else None,
                    text=_sanitize_string(ctx.post.text, MAX_CONTEXT_CHARS),
                )
                if ctx.post
                else None
            ),
            "draft": _sanitize_string(ctx.draft, MAX_DRAFT_CHARS) if ctx.draft else None,
            "meta": (
                {k: _sanitize_string(v, 500) for k, v in ctx.meta.items()} if ctx.meta else None
            ),
        }
    )


# Conservative red flags. If the page tried hard enough at injection
# that one of these triggers, refuse rather than trusting the model +
# system prompt to push back.
_SUSPICIOUS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"ignore (all )?(previous|prior|above) (instructions|messages|prompts)",
        re.IGNORECASE,
    ),
    re.compile(r"disregard (all )?(previous|prior|above)", re.IGNORECASE),
    re.compile(
        r"you are now (an?|the) [^\n]{0,80}(jailbreak|developer mode|dan)",
        re.IGNORECASE,
    ),
)


def detect_suspicious(ctx: RequestContext) -> str | None:
    """Return a short reason string if any blob matches a red-flag pattern.

    Returns ``None`` when nothing matched. ``draft`` is excluded — that
    field is the user's own input, not page-extracted content, so we
    don't flag the user themselves.
    """
    blobs: list[str] = []
    if ctx.page_title:
        blobs.append(ctx.page_title)
    if ctx.thread:
        blobs.extend(message.text for message in ctx.thread)
    if ctx.post:
        blobs.append(ctx.post.text)
    if ctx.meta:
        # ``meta`` carries page-derived values (site description, article
        # metadata, …) that adapters scrape from the DOM — untrusted, so
        # it gets the same red-flag scan as thread/post content.
        blobs.extend(ctx.meta.values())
    for blob in blobs:
        for pattern in _SUSPICIOUS_PATTERNS:
            if pattern.search(blob):
                head = pattern.pattern[:40]
                return f"Page content matched a prompt-injection pattern ({head}…)"
    return None
