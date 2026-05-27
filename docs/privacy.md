# Privacy Policy

_Last updated: 2026-05-27_

This document explains what Inkwell does and does not collect. If you
spot a contradiction with the actual behavior, please report it as a
security issue — see [security.md](./security.md).

## TL;DR

- **No account, no sign-in, no user database.** Inkwell works
  anonymously.
- All your settings live **only in your browser** (`chrome.storage.local`).
- When you generate text, the page content and your instruction are sent
  to our backend, which forwards them to OpenAI. **We never persist that
  content.** Our logs hold metadata only.
- You can disable Inkwell on any site. Banking, healthcare, and password
  manager sites are blocked by default.

## What we collect

### On your device only (never sent to a server)

Stored in `chrome.storage.local`:

- Your optional profile (display name, "about me").
- Default tone and model.
- Your working language and frequently-used languages.
- Your per-site allowlist / blocklist.
- **Translation & action history** — the input and output text of every
  completed translation and draft, kept so you have an auditable record.
  Bounded to the 250 most recent entries.

This data never leaves your browser — **except** the profile subset
(display name, "about me"), which is attached to a completion request
*if you set it*, purely to personalize that reply. It is not stored
server-side.

### Sent to the backend in real time (NOT stored)

- The page text you're replying to (sanitized, length-bounded).
- Your instruction / tone choice.
- The optional profile, if set.

Held in memory only for the duration of the request. Not written to our
database (there is none), our logs, or anywhere else.

### Operational logs (metadata only)

For each request the backend logs a single JSON line containing:

- Timestamp, action (`reply`/`grammar`/`rewrite`/`translate`), model.
- Source and target language **ids** (e.g. `fr`, `zh-Hans`) — never the
  text that was translated.
- Token counts, request size, latency, HTTP status.
- The client IP-derived rate-limit key.

**No prompt content, no completion content, no account identifiers** —
there are no accounts. Logs are retained per the hosting provider's
defaults wherever the FastAPI service is deployed.

### What we never collect

- Prompt or completion content in logs.
- Page content from sites not in your active allowlist.
- Keystrokes outside an explicit Generate / Fix / Rewrite action.
- Browsing history or tabs you haven't interacted with.

## Third parties

| Vendor | Purpose | Data |
| --- | --- | --- |
| **OpenAI** | LLM completion + vision OCR | Prompt + page context + images (in-flight only) |
| **Hosting provider** | Where the FastAPI service is deployed | API traffic + metadata logs |

OpenAI API traffic is configured with training opt-out. OpenAI's own
30-day abuse-monitoring retention is outside our control — don't put
highly sensitive data in prompts.

There is no auth provider and no database vendor — Inkwell has neither.

## Your data, your control

Because all settings and history live on your device, you control them
directly: edit settings in the options page, delete individual history
entries or clear the whole log from the **History** tab, or remove
everything by clicking **Reset** there or uninstalling the extension.
There is no server-side account to delete.

## Children

Not intended for users under 13.

## Changes to this policy

Material changes update the "Last updated" date and show a notice in the
extension on first launch afterward.

## Contact

privacy@example.com

## See also

- [Security policy](./security.md)
- [Reference: Architecture](./reference/architecture.md)
