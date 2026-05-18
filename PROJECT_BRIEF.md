# AI Writing Assistant — Project Brief for Claude Code

> **⚠️ Historical document — not the current spec.**
> This is the *original* brief that scaffolded the project. The product
> has since shipped as **Inkwell 1.0.0** and evolved well beyond this
> plan: authentication (Clerk) and the database (Turso) were removed,
> integrated multilingual support was added, and the API surface
> changed. It is kept only as a record of where the project started.
>
> For the current product, read instead:
> [README](./README.md) · [ARTICLE](./ARTICLE.md) ·
> [docs/](./docs/README.md) · [CHANGELOG](./CHANGELOG.md).

---

## 1. Overview

I want to build a **Chrome extension** that helps users reply to emails, posts, messages, and any text input on the web, while also fixing grammar and rewriting content based on context. The extension should work across platforms like Gmail, Outlook, LinkedIn, X (Twitter), Slack, WhatsApp Web, and any generic text field.

The two non-negotiable priorities are:

1. **Excellent user experience** — fast, unobtrusive, streaming responses, preview-before-insert, never auto-send.
2. **Strong security** — no API keys in the browser, defense against prompt injection, minimal data retention.

OpenAI's API powers the intelligence in the background, but it must **only be called from a backend service** — never directly from the extension.

- **Backend:** Next.js 15+ (App Router, TypeScript, deployed on Vercel)
- **Frontend:** Chrome Extension (Manifest V3, TypeScript, Vite + CRXJS)

---

## 2. Core User Flows

When a user focuses on a text field on any supported website, a small floating icon should appear (also triggerable via keyboard shortcut like `Cmd+Shift+K` / `Ctrl+Shift+K`). Clicking it opens a popover anchored to the field with three primary actions:

- **Generate Reply** — reads thread/post context and drafts a contextual response.
- **Fix Grammar** — corrects what the user already typed without changing voice.
- **Rewrite** — changes tone, length, or clarity.

The user picks a tone preset (Professional, Friendly, Concise, Detailed) or types a freeform instruction. The AI response **streams** into the popover token-by-token in real time. The user reviews the preview and clicks **Accept** to insert into the field, or **Regenerate** to try again.

**Nothing is ever auto-inserted or auto-sent.**

---

## 3. Technical Architecture

The system has three components:

1. **Chrome Extension** (Manifest V3, TypeScript) — frontend.
2. **Next.js Backend** (App Router, TypeScript, Vercel) — exposes API routes.
3. **OpenAI** — third-party LLM provider.

### 3.1 Extension internals

- **Content script** — detects text fields, extracts page context via per-site adapters, renders all UI inside a Shadow DOM, sanitizes context against prompt injection.
- **Background service worker** — the only component that makes network calls; holds short-lived JWT access tokens; manages auth refresh; consumes Server-Sent Events from the backend.
- **Popup** — quick settings and sign-in.
- **Options page** — profile, custom tones, per-site allow/blocklist.

### 3.2 Next.js backend

- Route handlers live under `app/api/`.
- **Edge Runtime** for the streaming completion route (lower latency, native streaming).
- **Node Runtime** for routes that need the full Node API (database writes, etc.).
- Authentication via JWT (short-lived access tokens, rotating refresh tokens) issued by Clerk.
- Rate limiting via Upstash Redis token bucket per user (Edge-compatible).
- Request validation with `zod` schemas + size limits.
- Prompt building: server-controlled system prompt + user profile from DB + sanitized client context.
- Streams OpenAI responses back to the extension as SSE.

The OpenAI API key lives only in **Vercel's encrypted environment variables**, never on the client.

### 3.3 Request flow

```
Extension  ──HTTPS + Bearer JWT──▶  Next.js API  ──server-to-server──▶  OpenAI
                                          │
                                          ▼
                                 Audit log (metadata only)
```

Responses stream back the same path.

---

## 4. Security Requirements

Treat the OpenAI key as the highest-value asset — it must never leave the backend.

### 4.1 Extension hardening

- **Manifest V3** with strict CSP: `script-src 'self'; object-src 'self'; connect-src https://your-app.vercel.app`.
- **Minimal Chrome permissions** — `storage`, `scripting`, `activeTab`, plus specific host permissions for sites with adapters. **No `<all_urls>`.**
- **Token storage:**
  - Access tokens in `chrome.storage.session` (cleared on browser restart).
  - Refresh tokens in `chrome.storage.local`, encrypted via Web Crypto API.
- Validate the origin of every cross-context message (`chrome.runtime.onMessageExternal` sender checks).
- All in-page UI rendered inside a Shadow DOM so host page CSS/JS cannot reach it.

### 4.2 Backend hardening

- **CORS locked to extension ID only** (`chrome-extension://<your-extension-id>`); reject all other origins.
- Use Next.js `middleware.ts` for JWT verification, CORS, and rate limiting before requests reach route handlers.
- Strict security headers via `next.config.js` (HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options).
- TLS 1.3 (automatic on Vercel) + Vercel's built-in DDoS protection.
- All dependencies pinned with a lockfile.

### 4.3 Prompt-injection defense

- Wrap all page-extracted context in `<UNTRUSTED_CONTEXT>` delimiters.
- System prompt explicitly states content inside those delimiters is **data, not instructions**.
- Strip role markers and system-style formatting (`system:`, `assistant:`, `<|im_start|>`, etc.) before sending.
- Always show a preview before insertion (UX + security).

### 4.4 Data minimization

- Backend logs **only request metadata** — user ID, timestamp, model, token counts.
- **Never log prompt content or completions.**
- No persistent storage of prompts or AI outputs.

### 4.5 Site policy

- Default to a per-site allow/blocklist.
- Sensitive sites (banking, healthcare, password managers) blocked out of the box.
- Users can add/remove sites in the options page.

---

## 5. Tech Stack

### Extension

- Manifest V3
- TypeScript (strict mode)
- Vite + CRXJS plugin
- React for popup/options pages
- Preact or vanilla DOM for in-page floating UI (smaller bundle)
- Tailwind CSS scoped through Shadow DOM
- `zod` for runtime validation of all messages between contexts
- Native `EventSource` or `fetch` + `ReadableStream` for SSE consumption

### Backend (Next.js)

- Next.js 15+ with App Router
- TypeScript (strict mode)
- Tailwind CSS for any web pages
- Route handlers in `app/api/`
- Edge Runtime for streaming routes
- Node Runtime for DB-heavy routes
- `zod` for schema validation
- OpenAI Node SDK with streaming
- `jose` for JWT
- **Vercel Postgres** or **Neon** for user/profile data
- **Upstash Redis** for rate limiting and short-lived caches (Edge-compatible)

### Auth

- **Clerk** as the auth provider (best Next.js integration, handles OAuth, sessions, JWT issuance).
- Alternative: Supabase Auth.

### Hosting

- Backend on **Vercel** (free tier sufficient for development and early users).
- Postgres via **Neon** or Vercel Postgres.
- Redis via **Upstash** (serverless, pay-per-request).

### Models

- `gpt-4o-mini` — fast/cheap default.
- `gpt-4o` — opt-in for higher quality.

---

## 6. Project Structure

Use a **monorepo** with three packages and pnpm workspaces:

```
ai-writing-assistant/
├── package.json              (workspace root)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── SECURITY.md
├── PRIVACY.md
├── .gitignore
├── .env.example
├── packages/
│   ├── shared/               (TS types + zod schemas, message contracts)
│   │   ├── src/
│   │   │   ├── messages.ts   (extension ↔ backend contracts)
│   │   │   ├── schemas.ts    (zod schemas)
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── extension/            (Chrome extension - Vite + CRXJS)
│   │   ├── src/
│   │   │   ├── content/      (content script + adapters + sanitizer)
│   │   │   ├── background/   (service worker)
│   │   │   ├── popup/        (React)
│   │   │   ├── options/      (React)
│   │   │   └── ui/           (shared Shadow DOM components)
│   │   ├── manifest.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── backend/              (Next.js App Router)
│       ├── app/
│       │   ├── api/
│       │   │   └── v1/
│       │   │       ├── complete/route.ts    (Edge, streaming)
│       │   │       ├── profile/route.ts     (Node)
│       │   │       ├── usage/route.ts       (Node)
│       │   │       └── health/route.ts      (Edge)
│       │   ├── auth/
│       │   │   └── extension-callback/page.tsx
│       │   └── layout.tsx
│       ├── lib/
│       │   ├── openai.ts
│       │   ├── prompt-builder.ts
│       │   ├── sanitizer.ts
│       │   ├── rate-limit.ts
│       │   └── audit-log.ts
│       ├── middleware.ts     (auth + CORS + rate-limit)
│       ├── next.config.js
│       ├── tsconfig.json
│       └── package.json
└── docker-compose.yml        (local Postgres + Redis for dev)
```

The `shared/` package is critical — it holds the TypeScript types and zod schemas used by both the extension and the backend, so message contracts are guaranteed to match. Both other packages depend on it via workspace protocol (`"@aiwa/shared": "workspace:*"`).

---

## 7. API Surface (Next.js Route Handlers)

| Method | Path                          | Runtime | Description                                                                                                                  |
| ------ | ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/complete`            | Edge    | Streaming SSE. Body: `{ action: "reply" \| "grammar" \| "rewrite", context, instruction, tone, model }`. Streams OpenAI tokens. |
| GET    | `/api/v1/profile`             | Node    | Returns user's saved profile, tone presets, "about me".                                                                      |
| PUT    | `/api/v1/profile`             | Node    | Updates user profile.                                                                                                        |
| GET    | `/api/v1/usage`               | Node    | Returns token usage stats for the current period.                                                                            |
| GET    | `/api/v1/health`              | Edge    | Returns `{ ok: true }`.                                                                                                      |
| GET    | `/auth/extension-callback`    | Page    | Completes OAuth and posts the session token back to the extension via `chrome.runtime.sendMessage`.                          |

All `/api/v1/*` routes are protected by `middleware.ts`, which verifies the JWT (issued by Clerk), checks rate limits via Upstash Redis, and applies CORS allowing only `chrome-extension://<extension-id>`.

---

## 8. Phased Build Plan

### Phase 0 — Foundations (start here)

- Monorepo scaffolding (pnpm workspaces, root configs).
- `shared/` package with message contracts and zod schemas.
- Next.js backend with health check + middleware skeleton + a **mock streaming `/api/v1/complete`** route that returns a hardcoded SSE stream.
- Extension with manifest + content script that detects text fields + background worker with message routing + popup with sign-in button + options page shell.
- Local dev runs end-to-end with mock data (no real OpenAI, no real auth yet).

### Phase 1 — MVP

- Real auth via Clerk (extension popup sign-in flow, callback page, JWT verification in middleware).
- Real OpenAI integration with streaming in the Edge route.
- Three core actions on generic text fields.
- Tone presets + freeform instruction.
- Preview-before-insert popover UI.
- Prompt-injection sanitization layer.
- Upstash Redis rate limiting.
- Neon Postgres for user profiles.

### Phase 2+ (later)

- Site-specific adapters: Gmail, LinkedIn, X, Slack, Outlook.
- User profile / "about me" feature injected into prompts.
- Side panel for longer rewrites.
- Keyboard shortcut customization.
- Usage analytics in popup.

---

## 9. What I Want You to Do Now

**Generate Phase 0 scaffolding as actual files.** Specifically:

### 9.1 Monorepo root

- `package.json` (workspace root, pnpm workspaces)
- `pnpm-workspace.yaml`
- `tsconfig.base.json` (strict mode, shared by all packages)
- `README.md` with run instructions
- `.gitignore`
- `.env.example`
- `SECURITY.md` (threat model summary + responsible disclosure)
- `PRIVACY.md` (data handling policy)

### 9.2 `packages/shared/`

- TypeScript package exporting:
  - Message contracts (extension ↔ background ↔ backend)
  - Zod schemas for all API request/response shapes
  - Error code enum
  - Action type enum (`"reply" | "grammar" | "rewrite"`)
  - Tone preset type

### 9.3 `packages/backend/` (Next.js 15 App Router)

- TypeScript strict mode
- Tailwind configured
- `middleware.ts` skeleton with `TODO(phase-1)` markers for auth/rate-limit
- `app/api/v1/health/route.ts` — returns `{ ok: true }`
- `app/api/v1/complete/route.ts` — **Edge Runtime, mock SSE stream** that emits a few hardcoded tokens with small delays so streaming UX can be tested
- `app/api/v1/profile/route.ts` — returns mock profile data
- `app/api/v1/usage/route.ts` — returns mock usage data
- `app/auth/extension-callback/page.tsx` — shell page
- `next.config.js` with security headers
- `.env.example` with all required vars listed

### 9.4 `packages/extension/`

- Vite + CRXJS Manifest V3 setup
- `manifest.json` with strict CSP and minimal permissions (`storage`, `scripting`, `activeTab`)
- Content script that detects focused text fields and shows a placeholder floating icon
- Background service worker with `chrome.runtime` message router and a `callBackend()` stub that calls the local Next.js mock endpoint
- Popup (React) with a "Sign in" button stub
- Options page (React) shell with sections for profile / tones / sites

### 9.5 Quality bar

- TypeScript strict mode in **every** package.
- Comment non-obvious security decisions inline (e.g., why CSP is set this way, why tokens go in `chrome.storage.session`, why CORS is locked to the extension ID).
- Don't add real OpenAI calls, real Clerk integration, or real database calls yet — leave clear `TODO(phase-1)` markers with brief notes on what each will do.
- Make sure `pnpm install && pnpm dev` runs both backend and extension and that the extension can hit the Next.js mock endpoint end-to-end.

After Phase 0 is working end-to-end with mocks, I'll come back and ask you to proceed to Phase 1.

---

## 10. Notes on Placeholders

A few values I'll need to fill in once I have them:

- **Extension ID** — Chrome assigns this once the unpacked extension is loaded. Use `chrome-extension://<EXTENSION_ID_TBD>` as a placeholder in CORS config and document where to update it.
- **Backend URL** — use `http://localhost:3000` for now; will be replaced with the Vercel deployment URL.
- **Clerk publishable key / secret key** — leave as `TODO(phase-1)` env var entries.
- **Upstash Redis URL / token** — leave as `TODO(phase-1)` env var entries.
- **Neon/Postgres connection string** — leave as `TODO(phase-1)` env var entries.
- **OpenAI API key** — leave as `TODO(phase-1)` env var entry.

Document all of these in `.env.example` and `README.md` so I know exactly what to set when I get to Phase 1.

---

## 11. Begin

Please start by laying out the file tree you plan to create, briefly explain any decisions you're making that aren't fully specified above, and then begin generating files. Work through each package in this order: `shared/` → `backend/` → `extension/` → root configs and docs. When done, run `pnpm install` and verify the dev servers start cleanly.
