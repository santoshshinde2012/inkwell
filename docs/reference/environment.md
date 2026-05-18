# Reference: Environment variables

_Every env var the backend reads. Inkwell has no auth and no database —
the only external dependency is OpenAI, so the list is short._

The schema lives in [`packages/backend/lib/env.ts`](../../packages/backend/lib/env.ts).
Vars are validated at process start; an invalid env aborts the boot.

For local dev, copy [`packages/backend/.env.example`](../../packages/backend/.env.example)
to `packages/backend/.env.local`. For Vercel, set them under
**Settings → Environment Variables**.

## Backend

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes (prod) | `http://localhost:3000` | Backend's own origin; used by CORS for same-origin checks. |
| `ALLOWED_EXTENSION_IDS` | yes (prod) | empty | Comma-separated `chrome-extension://<id>` origins permitted to call the API. **Production** requires it — without it, only same-origin is allowed. **Development** ignores the gap: any `chrome-extension://` origin is accepted so the unpacked extension works with no setup. |
| `OPENAI_API_KEY` | yes (prod) | — | Server-side only. If absent, `/complete` serves a mock streaming response. |
| `OPENAI_DEFAULT_MODEL` | no | `gpt-4o-mini` | Model used when the request doesn't specify one. |

> **Never** prefix `OPENAI_API_KEY` with `NEXT_PUBLIC_` — that would inline
> it into client bundles. If you do so by accident, rotate the key.

## Extension (build-time)

Belongs in `packages/extension/.env.local`, not the backend env.

| Var | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_BACKEND_URL` | no | `http://localhost:3000` | The **default** backend baked into the extension at build time — it seeds the initial value and the static `host_permissions` entry. Users can override the backend at runtime in the options page (Backend tab), so a rebuild is only needed to change the *default*. See [How-to: Use your own backend](../how-to/use-your-own-backend.md). |

## What there is NOT

There are no Clerk, Turso, Upstash, or database variables — Inkwell
removed authentication and the database. User settings live entirely in
the extension's `chrome.storage.local`.

## Health check

The startup banner tells you whether OpenAI is live:

```
[inkwell] features: openai=true
```

If that reads `openai=false` in production, `OPENAI_API_KEY` is missing
and the backend is serving the mock response.

## See also

- [How-to: Deploy to Vercel](../how-to/deploy-to-vercel.md)
- [How-to: Rotate secrets](../how-to/rotate-secrets.md)
- [Security](../security.md)
