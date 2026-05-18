# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses semantic versioning.

## [Unreleased]

### Fixed

- **Clipboard copy now works on restrictive pages.** "Copy" used only
  `navigator.clipboard`, which the host page's `Permissions-Policy` can
  block outright (Medium, among others), so the result silently failed to
  copy. Copy now uses an `execCommand`-based path that is not gated by the
  page's policy, with `navigator.clipboard` as a fallback.
- **Actionable backend errors.** A failed request used to surface the raw
  "Failed to fetch". It now names the backend URL and how to fix it; an
  origin rejection now tells the user the exact `chrome-extension://…`
  value to add to `ALLOWED_EXTENSION_IDS`.

- **Clear field-mode guidance.** Focusing a text field on a site with no
  conversation context (a helpdesk with no adapter) and choosing Reply
  used to fail with a generic schema error. The popover now explains what
  to do — select the customer's message, then click ✨.

### Added

- **Backend connectivity indicator in the popup.** The popup probes
  `/api/v1/health` and shows "Backend connected / unreachable", with a
  shortcut to the options page — so the most common "it isn't working"
  cause is visible at a glance.
- **Outlook, Slack, and WhatsApp Web site adapters.** Context extraction
  now covers all six platforms the manifest grants host permission for
  (Gmail, Outlook, LinkedIn, X, Slack, WhatsApp Web); every other site
  still works through the generic adapter. Each adapter degrades to
  draft-only if the host's DOM changes.

### Changed

- **Cleaner, less cluttered popover.** The configuration controls used to
  be three mismatched widget styles across three rows (a language row of
  dropdowns, a row of tone pills, and a wide model dropdown that truncated
  its own text). They are now one consistent set: From / To / Tone /
  Model are all the same compact select, in two tidy rows, with matching
  labels. The model picker shows just the short name ("GPT-4o mini") with
  the description on hover. Plus a visual refresh — softer card, flat
  header, accent-coloured active tab, calmer preview area.
- **Development CORS accepts any extension origin.** In `pnpm dev` the
  backend now accepts any `chrome-extension://` origin, so a freshly
  loaded unpacked extension works immediately — no need to copy its ID
  into `ALLOWED_EXTENSION_IDS` first. Production keeps the strict
  allowlist.

## [1.0.0] — 2026-05-16

First production release. Bundles the multilingual support feature with
all the previously-unreleased work since `0.1.0`.

### Added

- **Integrated multilingual support.** A new shared **language catalog**
  (`@inkwell/shared/languages.ts`) — 15 languages (English, French,
  German, Spanish, Italian, Portuguese, Dutch, Polish, Russian, Japanese,
  Chinese Simplified & Traditional, Korean, Arabic, Hindi) — is the single
  source of truth that the request schema, the popover pickers, and the
  prompt builder all derive from. Adding a language is a one-line change.
- **Translate action.** A fourth popover action translates an incoming
  customer query (or any text) into a chosen language. The model is
  instructed to translate faithfully and never act on the content, which
  also hardens it against prompt injection in the translated text.
- **Inline language detection.** The extension detects the source language
  locally via `chrome.i18n.detectLanguage` — no network call, no extra
  permission — and shows it in the popover ("From · French"). Detection
  also seeds the request's `sourceLanguage`; the backend model still
  verifies it, so a miss only costs a hint.
- **Context-aware reply languages.** The reply action can produce the
  draft in the customer's language, the agent's working language, any
  catalog language, or **bilingual** (both at once).
- **Cross-language grammar & rewrite.** Grammar correction stays in the
  text's own language (never translates); rewrite can optionally output
  into another language.
- **Translation & action history.** Every completed translation and draft
  is recorded in a new on-device store (`extension/src/lib/history.ts`,
  `chrome.storage.local`, bounded to 250 entries). A new **History** tab
  in the options page makes it searchable and filterable by action,
  language, and conversation.
- **Agent language preferences.** A new **Languages** tab lets each agent
  set a working language and frequently-used languages; the latter are
  surfaced first in the popover's language pickers.
- Request/response contract gained `sourceLanguage`, `targetLanguage`, and
  `bilingual` fields; the audit log records language ids (never content)
  for per-language quality metrics.
- **Configurable backend (bring your own backend).** The backend URL is
  a runtime setting in the options page ("Backend" tab), with an optional
  API key sent as `Authorization: Bearer`. The extension can be pointed
  at any server implementing the Inkwell API contract — no rebuild. Uses
  MV3 `optional_host_permissions` so Chrome grants access to exactly the
  configured origin; includes a "Save & test" health-check flow. See
  `docs/how-to/use-your-own-backend.md`.
- **User-selectable model.** The popover has a model picker; the chosen
  model is sent per-request and used to serve it. The options page lets
  you set a default model.
- **Model catalog** (`@inkwell/shared/models.ts`) — single source of truth
  for supported models (id, label, provider, description, tier).
- **Provider abstraction** (`backend/lib/providers/`) — a
  `CompletionProvider` interface + registry keyed on `ModelProvider`.
  Adding a non-OpenAI provider is a new file + registry entry, no
  pipeline/route/schema/UI changes. See
  `docs/explanation/model-providers.md`. Today only OpenAI ships.
- LICENSE, .editorconfig, .prettierrc, .prettierignore, and a GitHub
  Actions CI workflow (`.github/workflows/ci.yml`) gating merges on a
  clean install + typecheck + build.

### Removed

- **Authentication (Clerk) removed entirely.** The extension calls the
  backend anonymously — no sign-in, no tokens, no JWT verification.
  Deleted: `/auth/*` pages, `lib/auth.ts`, all `@clerk/nextjs` usage.
- **Database (Turso/libSQL + Drizzle ORM) removed entirely.** No
  server-side profile store, no audit-log table. Deleted: `db/`,
  `drizzle/`, `lib/db.ts`, `drizzle.config.ts`, the `/api/v1/profile`
  and `/api/v1/usage` routes, and the `@libsql/client` / `drizzle-orm` /
  `drizzle-kit` / `tsx` dependencies.

### Changed

- The product is a **multilingual** writing assistant — manifest, popup,
  options, and landing copy updated accordingly.
- The extension works **without an account**. All user settings
  (profile, default tone/model, languages, site allow/blocklist) live in
  `chrome.storage.local` only.
- Rate limiting is an **in-memory per-IP sliding window**
  (`lib/rate-limit.ts`), not Turso-backed per-user counters.
- Audit logging is **stdout-only structured JSON** (`lib/audit-log.ts`);
  no database sink.
- `middleware.ts` reduced to CORS only (no JWT, no `clerkMiddleware`).
- The backend API surface is just `/api/v1/health` and
  `/api/v1/complete`.
- Optional personalization is carried on the completion request itself
  (`profile` field) instead of a server-side profile store.
- Renamed the project from "AI Writing Assistant" / `@aiwa/*` to
  **Inkwell** / `@inkwell/*`.

## [0.1.0] — 2026-05-09

### Added

- **Monorepo scaffolding** with pnpm workspaces (`shared`, `backend`,
  `extension`) and TypeScript strict mode everywhere.
- **Backend** (Next.js 15 App Router):
  - `/api/v1/health` (Edge), `/api/v1/complete` (Node, streaming),
    `/api/v1/profile` (Node), `/api/v1/usage` (Node).
  - `/auth/sign-in`, `/auth/sign-up`, `/auth/extension-callback` powered
    by Clerk (`@clerk/nextjs`) — Google OAuth + email/password.
  - Edge middleware: CORS lockdown to extension IDs, JWT verification
    via `jose` + Clerk SPKI, request-header injection (x-inkwell-user-id).
  - **Turso (libSQL) + Drizzle ORM** for profile storage and
    metadata-only audit logs. Migrations committed.
  - **Rate limiting** computed against the `audit_logs` table — no
    separate Redis. 20 req/min, 500 req/day per user, fail-closed in
    production.
  - **Prompt-injection defense**: `<UNTRUSTED_CONTEXT>` delimiters,
    role-marker stripping, heuristic refusal, length caps,
    preview-before-insert.
  - Three rewrite modes (transform / light edit / compose-from-brief).
  - Vercel build pipeline with auto-migrations (`tsx db/migrate.ts &&
    next build`).
- **Extension** (Manifest V3 + Vite + CRXJS):
  - Content script with site adapters: generic, Gmail, LinkedIn, X.
  - Closed Shadow-DOM popover with persistent DOM (no re-renders),
    streaming caret, keyboard shortcuts (Esc / Cmd+Enter), full
    accessibility (role="dialog", aria-live), dark-mode via
    prefers-color-scheme.
  - Floating ✨ trigger with Lucide-style SVG, hover tooltip, fade-in
    animation, hide-while-typing.
  - Background service worker: silent token refresh via the auth-callback
    page so Clerk's short-lived JWTs don't force re-sign-in.
  - Refresh tokens AES-256-GCM encrypted at rest in `chrome.storage.local`.
  - Site policy: default-blocked banking/healthcare/password-manager
    sites; user allow/blocklist editor in options.
  - Polished React popup (avatar, current-site quick toggle, keyboard
    hint) and tabbed options page.
- **Documentation** under `docs/` following the
  [Diátaxis](https://diataxis.fr) framework: tutorial, how-to,
  reference, and explanation. Sections: getting-started, deployment,
  database, secrets rotation, site adapters, auth config, API, error
  codes, environment, architecture, prompt-injection defense, streaming
  design, rewrite modes, security, privacy, contributing.

[Unreleased]: https://example.com/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/compare/v0.1.0...v1.0.0
[0.1.0]: https://example.com/releases/v0.1.0
