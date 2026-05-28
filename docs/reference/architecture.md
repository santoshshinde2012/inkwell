# Reference: Architecture

_What runs where, what talks to what, and why._

Inkwell has **no authentication and no database**. The Chrome extension
calls the backend anonymously; the backend's default upstream is OpenAI,
optionally routed through the Portkey AI gateway as a transport-level
toggle; all user settings live in `chrome.storage.local`.

## High-level

```
┌─────────────────────────┐   HTTPS + SSE        ┌──────────────────────────┐
│ Chrome MV3 Extension    │ ───(no auth)───────▶ │ FastAPI (Python 3.12)    │
│                         │                      │                          │
│  ┌───────────────────┐  │                      │  ┌────────────────────┐  │
│  │ Content script    │  │                      │  │ CORS middleware    │  │
│  │  • detects fields │  │                      │  │  /api/v1/* only    │  │
│  │  • Shadow-DOM UI  │  │                      │  │  Origin required   │  │
│  │  • adapters       │  │                      │  │   on writes        │  │
│  └───────┬───────────┘  │                      │  └────────┬───────────┘  │
│          │ runtime msg  │                      │           ▼              │
│  ┌───────▼───────────┐  │                      │  ┌────────────────────┐  │
│  │ Background SW     │  │                      │  │ Route handlers     │  │
│  │  • only network   │  │                      │  │  GET  /health      │  │
│  └───────────────────┘  │                      │  │  GET  /live        │  │
│                         │                      │  │  GET  /ready       │  │
│  ┌───────┐  ┌────────┐  │                      │  │  GET  /version     │  │
│  │ Side  │  │Options │  │                      │  │  GET  /models      │  │
│  │ panel │  │        │  │                      │  │  POST /complete    │  │
│  └───────┘  └────────┘  │                      │  │  POST /ocr         │  │
│  settings: chrome.storage.local                │  └─────────┬──────────┘  │
└─────────────────────────┘                      │            ▼             │
                                                 │   AsyncOpenAI client     │
                                                 │   (mocked if no key,     │
                                                 │   pointed at Portkey if  │
                                                 │   USE_PORTKEY=true)      │
                                                 │            │             │
                                                 │            ▼             │
                                                 │   Portkey gateway ──▶    │
                                                 │   OpenAI (direct when    │
                                                 │   gateway off)           │
                                                 └──────────────────────────┘
```

## Components

### Extension

The extension source lives at `frontend/packages/extension/src/`.

| File / dir | Role |
| --- | --- |
| [`manifest.config.ts`](../../frontend/packages/extension/manifest.config.ts) | MV3 manifest. CSP, minimal permissions, host_permissions, commands, brand icons. |
| [`src/background/index.ts`](../../frontend/packages/extension/src/background/index.ts) | Service worker. Only component making network calls. Message handler registry. Right-click OCR pipeline. |
| [`src/background/api-client.ts`](../../frontend/packages/extension/src/background/api-client.ts) | HTTP + SSE client. Reads the user-configured backend URL + optional API key from storage per request; attaches the optional local profile. |
| [`src/content/index.ts`](../../frontend/packages/extension/src/content/index.ts) | Content script. Detects editable fields, mounts the trigger, dispatches the OCR popover. |
| [`src/content/trigger.ts`](../../frontend/packages/extension/src/content/trigger.ts) | The floating ink-drop button that opens the popover. Closed Shadow DOM. |
| [`src/content/popover.ts`](../../frontend/packages/extension/src/content/popover.ts) | The in-page popover itself — vanilla DOM in a closed Shadow root. Reply / Translate / Grammar / Rewrite, language pickers, streaming preview. Composed from the popover.\* siblings below. |
| [`src/content/popover.styles.ts`](../../frontend/packages/extension/src/content/popover.styles.ts) | All popover CSS as a single template literal, applied once at mount. |
| [`src/content/popover.icons.ts`](../../frontend/packages/extension/src/content/popover.icons.ts) | Lucide SVG icon strings + per-action labels / hints / placeholders. |
| [`src/content/popover.drag.ts`](../../frontend/packages/extension/src/content/popover.drag.ts) | Header drag handler — pointer-capture move/up logic. Returns a disposer. |
| [`src/content/popover.detect.ts`](../../frontend/packages/extension/src/content/popover.detect.ts) | Local language detection via `chrome.i18n.detectLanguage`, with a debounce timer + field-mode adapter cache. |
| [`src/content/ocr-loader.ts`](../../frontend/packages/extension/src/content/ocr-loader.ts) | Fixed-position loader card shown while the right-click OCR pipeline runs. |
| [`src/content/adapters/`](../../frontend/packages/extension/src/content/adapters/) | Per-site context extractors (Gmail, Outlook, LinkedIn, X, Slack, WhatsApp Web) + a generic fallback. |
| [`src/lib/storage.ts`](../../frontend/packages/extension/src/lib/storage.ts) | Typed wrapper around `chrome.storage.local` — the ONLY persistence. Holds profile, tone/model defaults, language preferences, the configurable backend URL + API key, and site policy. |
| [`src/lib/useStorageChange.ts`](../../frontend/packages/extension/src/lib/useStorageChange.ts) | React hook over `chrome.storage.onChanged`. Subscribes to a fixed key list and dispatches a filtered change set to the handler. |
| [`src/lib/messaging.ts`](../../frontend/packages/extension/src/lib/messaging.ts) | Typed `chrome.runtime.sendMessage` wrapper + `ExtensionContextInvalidatedError` for orphaned content scripts. |
| [`src/lib/ocr.ts`](../../frontend/packages/extension/src/lib/ocr.ts) | Side-panel paste / drop / file-picker OCR — POSTs the image to `/api/v1/ocr`. |
| [`src/lib/languages.ts`](../../frontend/packages/extension/src/lib/languages.ts) | Local language detection via `chrome.i18n.detectLanguage`. |
| [`src/lib/history.ts`](../../frontend/packages/extension/src/lib/history.ts) | Bounded on-device translation & action history (`chrome.storage.local`). |
| [`src/lib/site-policy.ts`](../../frontend/packages/extension/src/lib/site-policy.ts) | Allow / block evaluator (banks / healthcare / password managers default-blocked). |
| [`src/ui/ErrorBoundary.tsx`](../../frontend/packages/extension/src/ui/ErrorBoundary.tsx) | Crash guard wrapped around both React surfaces (Side Panel + Options page). |
| [`src/sidepanel/`](../../frontend/packages/extension/src/sidepanel/) | React Side Panel — the persistent assistant. Three views (Assistant / History / Settings) behind a hamburger overlay drawer; bottom-sheet options; per-action color theming. Same actions and persisted state as the popover. |
| [`src/options/`](../../frontend/packages/extension/src/options/) | React options page. `App.tsx` is the shell; layout primitives (Header / Tabs / Card / Toast) + the shared `TabProps` shape live in `components.tsx`; each tab body has its own file under `tabs/{Name}Tab.tsx`. |

### Backend (FastAPI, Python 3.12)

The backend follows a hexagonal-ish layout: `domain/` holds pure types
and DTOs (no I/O), `services/` is the application layer, `providers/`
wraps external integrations behind a `Protocol`, and `api/` is the only
package that imports FastAPI.

| Path | Role |
| --- | --- |
| [`src/inkwell_backend/main.py`](../../backend/src/inkwell_backend/main.py) | FastAPI app factory + lifespan banner. |
| [`src/inkwell_backend/settings.py`](../../backend/src/inkwell_backend/settings.py) | `pydantic-settings` env validation. Inkwell aborts at boot on bad env. |
| [`src/inkwell_backend/logging_setup.py`](../../backend/src/inkwell_backend/logging_setup.py) | JSON-structured stdlib logging. |
| [`src/inkwell_backend/api/middleware.py`](../../backend/src/inkwell_backend/api/middleware.py) | CORS lockdown for `/api/v1/*` + preflight handling + Origin-required-on-write gate. |
| [`src/inkwell_backend/api/deps.py`](../../backend/src/inkwell_backend/api/deps.py) | FastAPI dependency providers: `client_ip`, `origin_header`, `client_request_id`. |
| [`src/inkwell_backend/api/v1/health.py`](../../backend/src/inkwell_backend/api/v1/health.py) | `/health`, `/live`, `/ready` probes + the lifespan-driven ready flag. |
| [`src/inkwell_backend/api/v1/meta.py`](../../backend/src/inkwell_backend/api/v1/meta.py) | `/version` + `/models` catalog endpoints — read-only metadata. |
| [`src/inkwell_backend/api/v1/complete.py`](../../backend/src/inkwell_backend/api/v1/complete.py) | Thin HTTP wrapper over the completion pipeline. Emits `Retry-After` on 429. |
| [`src/inkwell_backend/api/v1/ocr.py`](../../backend/src/inkwell_backend/api/v1/ocr.py) | Thin HTTP wrapper over the OCR pipeline. |
| [`src/inkwell_backend/services/completion.py`](../../backend/src/inkwell_backend/services/completion.py) | Domain orchestration: validate → IP rate-limit → sanitize → injection check → build prompt → stream → log. Emits SSE heartbeat comments every 15 s of model silence. |
| [`src/inkwell_backend/services/ocr.py`](../../backend/src/inkwell_backend/services/ocr.py) | Validate → rate-limit → call vision model → return text. |
| [`src/inkwell_backend/services/rate_limit.py`](../../backend/src/inkwell_backend/services/rate_limit.py) | In-memory per-IP sliding-window limiter (20/min, 500/day), `deque`-backed. |
| [`src/inkwell_backend/services/prompt.py`](../../backend/src/inkwell_backend/services/prompt.py) | Strategy registry per action; wraps page context in `<UNTRUSTED_CONTEXT>`. |
| [`src/inkwell_backend/services/sanitizer.py`](../../backend/src/inkwell_backend/services/sanitizer.py) | Strips role markers, caps length, flags injection payloads. |
| [`src/inkwell_backend/services/audit.py`](../../backend/src/inkwell_backend/services/audit.py) | Metadata-only structured logging — propagates `X-Client-Request-Id` for end-to-end correlation; carries `via_portkey` dimension when a real upstream was hit. |
| [`src/inkwell_backend/providers/openai_client.py`](../../backend/src/inkwell_backend/providers/openai_client.py) | Process-wide `AsyncOpenAI` singleton with explicit httpx timeouts; closed on graceful shutdown. Picks up Portkey overrides automatically when the toggle is on. |
| [`src/inkwell_backend/providers/portkey.py`](../../backend/src/inkwell_backend/providers/portkey.py) | Portkey AI gateway helpers — base URL, header builder, per-request trace forwarding. Single place that knows about the gateway; vendor client factories call into it. |
| [`src/inkwell_backend/providers/`](../../backend/src/inkwell_backend/providers/) | Provider abstraction — `CompletionProvider` Protocol (chat + vision + lifecycle), the OpenAI implementation (real + mock fallback), and a registry keyed by `ModelProvider`. The pipeline dispatches via `get_provider_for_model`. See [model-providers.md](../explanation/model-providers.md). |
| [`src/inkwell_backend/domain/`](../../backend/src/inkwell_backend/domain/) | Pure types: actions, tones, models, languages, limits, prompts, errors, Pydantic schemas, SSE encoders. |

### Shared

`frontend/packages/shared/src/` — zod schemas, the `chrome.runtime` message union,
error codes, action/tone enums, the model catalog, the language catalog,
and hard limits. Imported by the extension. The backend keeps an
independent Python mirror in `backend/src/inkwell_backend/domain/`
— keep both copies aligned when you add a model, language, or action.

## Request lifecycle (`POST /api/v1/complete`)

```
extension popover  → generates streamId, packs payload
extension background SW  → reads local profile + default model
                         → POST (no Authorization header) with SSE
ASGI middleware  → CORS check (extension origin allowlist)
route handler  → services.completion.run_completion()
   ↓ enforce body-size cap
   ↓ Pydantic validate
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

### In-process rate limit

The limiter is a `dict[str, list[int]]` in module memory. Counters reset
when the worker recycles and aren't shared across replicas. For a hard
quota, swap the store in `services/rate_limit.py` for Redis or another
shared backend — none of the callers change.

### Settings in `chrome.storage.local`

`local` (not `session` or `sync`): `session` would clear on browser
restart; `sync` would expose settings to other extensions. `local` keeps
everything on-device. There is no server-side profile store.

## See also

- [Reference: API](./api.md)
- [Reference: Environment](./environment.md)
- [Explanation: Streaming design](../explanation/streaming-design.md)
- [Security](../security.md)
