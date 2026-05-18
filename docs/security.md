# Security Policy

_Last updated: 2026-05-16_

This document states our security guarantees, threat model, mitigations,
and how to report a vulnerability.

For deeper detail:
[Prompt-injection defense](./explanation/prompt-injection-defense.md) ·
[Rotate secrets](./how-to/rotate-secrets.md).

## Reporting a vulnerability

Email **security@example.com** (replace with your real address) with a
description, reproduction steps, and the commit you tested. We aim to
acknowledge within 3 business days and ship fixes for high-severity
issues within 90 days. Please don't open public issues for security
reports or run automated scans against production without permission.

## Guarantees

1. **The OpenAI API key never leaves the backend.** Server-to-server only.
2. **Untrusted page content never confuses the model into running
   instructions.** Page text is data, not commands.
3. **No prompt content is ever logged or persisted.**

## What changed: no auth, no database

Inkwell deliberately has **no authentication and no database**. The
extension calls the backend anonymously; all user settings live in the
extension's `chrome.storage.local`. This removes whole categories of
risk (no tokens to steal, no account takeover, no user data at rest on a
server) — but it also means the `/api/v1/complete` endpoint is
unauthenticated. See "Accepted risks" below.

## Threat model

### Assets we protect

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| OpenAI API key | Vercel encrypted env var (server only) | Direct billing exposure |
| Page context the user is replying to | TLS in flight; never persisted server-side | May contain private content |
| User settings (profile, languages, site lists) | `chrome.storage.local`, on-device | Personal preferences |
| Translation & action history | `chrome.storage.local`, on-device | Holds customer-query text; never leaves the device |

### Attackers we consider

1. **Malicious website** running JS in the same tab. Goal: read settings,
   inject prompt instructions.
2. **Other browser extensions** with overlapping permissions.
3. **Network attacker** with a TLS bypass.
4. **Prompt-injection attacker** controlling the email/post the user is
   replying to.
5. **Endpoint abuser** hitting `/api/v1/complete` directly to burn the
   OpenAI key.

## Mitigations

### Extension (Manifest V3)

- **Strict CSP:** `script-src 'self'; object-src 'self'`. No remote code.
- **Minimal permissions:** `storage`, `scripting`, `activeTab`, plus
  per-site host permissions for adapters. No `<all_urls>` host
  permissions.
- **Shadow DOM isolation** for all in-page UI (closed mode).
- **Settings in `chrome.storage.local`** — on-device only, never synced,
  never sent to a server (except the optional `profile` subset attached
  to a completion request to personalize the reply).
- **Cross-context messages** are zod-validated; the background worker
  rejects messages whose sender isn't this extension.
- **Site policy:** banking, healthcare, and password-manager sites are
  blocked by default; the trigger never appears there unless the user
  explicitly opts in.

### Backend (Next.js)

- **CORS locked** to extension IDs in `ALLOWED_EXTENSION_IDS` in
  production. In development the backend additionally accepts any
  `chrome-extension://` origin, so the unpacked extension works without
  setup — this relaxation never applies when `NODE_ENV=production`.
- **IP rate limiting** — in-memory per-IP sliding window (20/min,
  500/day) blunts abuse of the unauthenticated endpoint.
- **Body size cap** (32 KB) bounds prompt cost and DoS surface.
- **zod validation** on every request body.
- **Strict security headers** via `next.config.js` (HSTS,
  X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
  Permissions-Policy).
- **Metadata-only logging** — action, model, token counts, latency,
  client IP. Never prompt or completion content.

### Prompt-injection defense

See [explanation/prompt-injection-defense.md](./explanation/prompt-injection-defense.md).
In summary: page text wrapped in `<UNTRUSTED_CONTEXT>` delimiters; system
prompt declares it data, not instructions; sanitizer strips role markers
and zero-width characters; heuristic refusal of obvious payloads; length
caps; preview-before-insert (the user always reviews the output).

## Accepted risks

- **Unauthenticated `/complete` endpoint.** CORS restricts *browser*
  callers to the extension origin, and the per-IP rate limit blunts
  abuse, but a determined non-browser client can still reach the
  endpoint and consume OpenAI budget. This is an accepted trade-off for
  a zero-friction, no-sign-in product. The key itself is never exposed.
  If endpoint abuse becomes a problem, add a lightweight signed-request
  scheme or a shared-store quota.
- **In-memory rate limit** resets on cold start and isn't shared across
  regions — best-effort, not a hard quota.

## Defense-in-depth checklist

- ✅ Key isolation (server-only)
- ✅ Transport security (TLS 1.3, Vercel)
- ✅ CORS + origin allowlist
- ✅ IP rate limiting (best-effort)
- ✅ Input validation (zod) + body size cap
- ✅ Prompt sandboxing (`<UNTRUSTED_CONTEXT>`)
- ✅ Output validation / preview-before-insert
- ✅ CSP + Shadow DOM isolation
- ✅ Minimal permissions
- ✅ Metadata-only logging, no PII / no prompt content

## Production hardening checklist

On every prod deploy verify:

- `OPENAI_API_KEY` and `ALLOWED_EXTENSION_IDS` are set; logs show
  `[inkwell] features: openai=true`.
- `ALLOWED_EXTENSION_IDS` contains only legitimate extension IDs.
- A `/complete` request from a foreign origin returns
  `403 ORIGIN_NOT_ALLOWED`.
- An "ignore previous instructions" payload returns `403 FORBIDDEN`.
- The 21st request in a minute from one IP returns `429 RATE_LIMITED`.
- Logs contain no prompt/completion content.

## See also

- [Privacy policy](./privacy.md)
- [How-to: Rotate secrets](./how-to/rotate-secrets.md)
- [Reference: Error codes](./reference/error-codes.md)
