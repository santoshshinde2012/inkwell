# Reference: Architecture

_What runs where, what talks to what, and why._

Inkwell has **no authentication and no database**. The Chrome extension
calls the backend anonymously; the backend's only external dependency is
OpenAI; all user settings live in `chrome.storage.local`.

## High-level

```
┌─────────────────────────┐   HTTPS + SSE        ┌──────────────────────────┐
│ Chrome MV3 Extension    │ ───(no auth)───────▶ │ Next.js 15 (Vercel)      │
│                         │                      │                          │
│  ┌───────────────────┐  │                      │  ┌────────────────────┐  │
│  │ Content script    │  │                      │  │ Edge middleware    │  │
│  │  • detects fields │  │                      │  │  CORS only         │  │
│  │  • Shadow-DOM UI  │  │                      │  └────────┬───────────┘  │
│  │  • adapters       │  │                      │           ▼              │
│  └───────┬───────────┘  │                      │  ┌────────────────────┐  │
│          │ runtime msg  │                      │  │ Route handlers     │  │
│  ┌───────▼───────────┐  │                      │  │  /api/v1/health    │  │
│  │ Background SW     │  │                      │  │  /api/v1/complete  │  │
│  │  • only network   │  │                      │  └─────────┬──────────┘  │
│  └───────────────────┘  │                      │            ▼             │
│                         │                      │   OpenAI (mocked if      │
│  ┌───────┐  ┌────────┐  │                      │   OPENAI_API_KEY unset)  │
│  │ Popup │  │Options │  │                      └──────────────────────────┘
│  └───────┘  └────────┘  │
│  settings: chrome.storage.local
└─────────────────────────┘
```

## Components

### Extension

| File | Role |
| --- | --- |
| [`manifest.config.ts`](../../packages/extension/manifest.config.ts) | MV3 manifest. CSP, minimal permissions, host_permissions, commands, brand icons. |
| [`src/background/index.ts`](../../packages/extension/src/background/index.ts) | Service worker. Only component making network calls. Message handler registry. |
| [`src/background/api-client.ts`](../../packages/extension/src/background/api-client.ts) | HTTP + SSE client. Reads the user-configured backend URL + optional API key from storage per request; attaches the optional local profile. |
| [`src/content/index.ts`](../../packages/extension/src/content/index.ts) | Content script. Detects editable fields, mounts the trigger. |
| [`src/content/popover.ts`](../../packages/extension/src/content/popover.ts) | Vanilla-DOM popover in a closed Shadow DOM. Reply / Translate / Grammar / Rewrite, language pickers, streaming preview. |
| [`src/content/adapters/`](../../packages/extension/src/content/adapters/) | Per-site context extractors (Gmail, Outlook, LinkedIn, X, Slack, WhatsApp Web) + a generic fallback. |
| [`src/lib/storage.ts`](../../packages/extension/src/lib/storage.ts) | Typed wrapper around `chrome.storage.local` — the ONLY persistence. Holds profile, tone/model defaults, language preferences, the configurable backend URL + API key, and site policy. |
| [`src/lib/languages.ts`](../../packages/extension/src/lib/languages.ts) | Local language detection via `chrome.i18n.detectLanguage`. |
| [`src/lib/history.ts`](../../packages/extension/src/lib/history.ts) | Bounded on-device translation & action history (`chrome.storage.local`). |
| [`src/sidepanel/`](../../packages/extension/src/sidepanel/) | React Side Panel — the persistent assistant. Three views (Assistant / History / Settings) behind a hamburger overlay drawer; bottom-sheet options; per-action color theming. Same actions and persisted state as the popover. |
| [`src/options/`](../../packages/extension/src/options/) | React options page — profile, defaults, languages, history, backend, site allow/blocklist. Forced dark to match the Side Panel. |

### Backend (Next.js 15)

| File | Role |
| --- | --- |
| [`middleware.ts`](../../packages/backend/middleware.ts) | Edge middleware. CORS preflight + origin allowlist. No auth. |
| [`app/api/v1/health/route.ts`](../../packages/backend/app/api/v1/health/route.ts) | Edge runtime. Liveness probe. |
| [`app/api/v1/complete/route.ts`](../../packages/backend/app/api/v1/complete/route.ts) | Node runtime. Thin HTTP wrapper over the completion pipeline. |
| [`lib/completion-pipeline.ts`](../../packages/backend/lib/completion-pipeline.ts) | Domain orchestration: validate → IP rate-limit → sanitize → injection check → build prompt → stream → log. |
| [`lib/rate-limit.ts`](../../packages/backend/lib/rate-limit.ts) | In-memory per-IP sliding-window limiter. |
| [`lib/prompt-builder.ts`](../../packages/backend/lib/prompt-builder.ts) | Strategy registry per action; wraps page context in `<UNTRUSTED_CONTEXT>`. |
| [`lib/sanitizer.ts`](../../packages/backend/lib/sanitizer.ts) | Strips role markers, caps length, flags injection payloads. |
| [`lib/providers/`](../../packages/backend/lib/providers/) | Provider abstraction — `CompletionProvider` interface, the OpenAI implementation (real + mock fallback), and a registry keyed by `ModelProvider`. The pipeline dispatches via `getProviderForModel`. See [model-providers.md](../explanation/model-providers.md). |
| [`lib/audit-log.ts`](../../packages/backend/lib/audit-log.ts) | Metadata-only structured logging to stdout. |
| [`lib/cors.ts`](../../packages/backend/lib/cors.ts) | Origin allowlist + CORS headers. |
| [`lib/env.ts`](../../packages/backend/lib/env.ts) | Validated env (OpenAI + extension allowlist only). |

### Shared

`packages/shared/src/` — zod schemas, the `chrome.runtime` message union,
error codes, action/tone enums, the model catalog, the language catalog,
and hard limits.

## Request lifecycle (`POST /api/v1/complete`)

```
extension popover  → generates streamId, packs payload
extension background SW  → reads local profile + default model
                         → POST (no Authorization header) with SSE
edge middleware  → CORS check (extension origin allowlist)
route handler (Node)  → completion-pipeline.runCompletion()
   ↓ enforce body-size cap
   ↓ zod validate
   ↓ IP rate-limit (in-memory, fail = 429)
   ↓ sanitize untrusted page context
   ↓ refuse on prompt-injection pattern
   ↓ build prompt (system + untrusted user)
OpenAI (or mock)  → streams chat.completions
   ↓ per token: SSE 'token' event
   ↓ on completion: 'usage' + 'done' events
   ↓ metadata logged to stdout (no content)
extension background SW  → parses SSE, dispatches to content script
extension content script → appends tokens to the popover preview
user clicks Insert  → popover writes the text into the field
```

## Trade-offs

### No authentication

The `/api/v1/complete` endpoint is unauthenticated by design. CORS
restricts *browser* callers to the extension origin, and an in-memory
per-IP rate limit blunts abuse, but a determined non-browser client can
still reach the endpoint. This is an accepted trade-off for a zero-
friction, no-sign-in product. The OpenAI key still never leaves the
server. See [security.md](../security.md).

### Node runtime for `/complete`

The route runs on Node (not Edge) so the in-memory IP rate limiter keeps
state across requests while the function is warm — Edge isolates are too
short-lived for that. Node functions on Vercel stream natively.

### Settings in `chrome.storage.local`

`local` (not `session` or `sync`): `session` would clear on browser
restart; `sync` would expose settings to other extensions. `local` keeps
everything on-device. There is no server-side profile store.

## See also

- [Reference: API](./api.md)
- [Reference: Environment](./environment.md)
- [Explanation: Streaming design](../explanation/streaming-design.md)
- [Security](../security.md)
