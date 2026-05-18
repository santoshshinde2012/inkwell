# Getting started

_Tutorial — clone the repo and have the extension talking to a local
backend in under ten minutes._

By the end you'll have:

- The Next.js backend on `http://localhost:3000` (mocked OpenAI — no key
  needed).
- The Chrome extension loaded and pointing at the local backend.
- A working "Generate reply" flow on any text field.

There is **no sign-in** — Inkwell works anonymously.

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | ≥ 20.10 | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` |
| Chrome / Chromium | recent | `chrome://version` |

No pnpm? `npm i -g pnpm` or use [corepack](https://nodejs.org/api/corepack.html).

## 1. Install

```bash
pnpm install
```

## 2. Build the shared types package

The other packages depend on `@inkwell/shared` via `workspace:*`:

```bash
pnpm --filter @inkwell/shared build
```

Repeat only when you change shared schemas/types.

## 3. Boot the dev servers

```bash
pnpm dev
```

Starts the backend (`http://localhost:3000`) and the extension Vite
watcher (writes `packages/extension/dist/`). The log line
`[inkwell] features: openai=false` confirms the backend is in mock mode.

## 4. Confirm the backend

```bash
curl http://localhost:3000/api/v1/health
# {"ok":true,"version":"1.0.0","runtime":"edge","timestamp":"..."}
```

## 5. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select `packages/extension/dist/`.

That's it for local development. When the backend runs in dev mode
(`pnpm dev`), its CORS layer accepts **any** `chrome-extension://` origin,
so the extension works the moment it is loaded — no extra step.

> **For production only:** a deployed backend keeps a strict allowlist.
> Set `ALLOWED_EXTENSION_IDS=chrome-extension://<your-extension-id>` in the
> deploy environment, or requests get `403 ORIGIN_NOT_ALLOWED`. See
> [Deploy to Vercel](./how-to/deploy-to-vercel.md).

## 6. Use it

Open any site with a text field (Gmail compose, a tweet box, a plain
`<textarea>`). Click into the field — a small ✨ trigger appears. Click
it (or press `Cmd+Shift+K` / `Ctrl+Shift+K`):

1. The popover opens with **Reply**, **Translate**, **Grammar**, and
   **Rewrite**.
2. Pick a tone, choose source/target languages, or type an instruction.
3. Click **Generate** — the mock backend streams a paragraph
   token-by-token.
4. Click **Insert** to write it into the field, **Copy**, or
   **Regenerate** to retry.

Nothing is auto-sent.

## 7. (Optional) Set a profile and languages

Open the extension's options page (popup → gear icon).

- **General → Profile** — a display name and "about me", attached to
  requests to personalize replies.
- **Languages** — your working language and the languages you handle
  often (surfaced first in the popover's language pickers).
- **History** — a searchable log of every translation and draft.

Everything is stored only in `chrome.storage.local`. No account required.

## What's next?

| To… | Read |
| --- | --- |
| Use a real OpenAI key locally | [How-to: Local development](./how-to/local-development.md) |
| Deploy the backend | [How-to: Deploy to Vercel](./how-to/deploy-to-vercel.md) |
| Understand the architecture | [Reference: Architecture](./reference/architecture.md) |
| Understand multilingual support | [Explanation: Multilingual support](./explanation/multilingual-support.md) |
| Add an adapter for another site | [How-to: Add a site adapter](./how-to/add-a-site-adapter.md) |

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Could not find @inkwell/shared` | You skipped step 2; run it. |
| The ✨ trigger never appears | Site is on the default blocklist (banks/healthcare/password managers). Try another site, or allow it in options. |
| The popup says "Backend unreachable" | The backend isn't running. Start it with `pnpm dev`, then reopen the popup. |
| `Couldn't reach the backend …` when generating | Same as above — start `pnpm dev`, or set a reachable backend URL in Options → Backend. |
| `403 ORIGIN_NOT_ALLOWED` | Only happens against a **production** backend — add the extension ID to `ALLOWED_EXTENSION_IDS` and redeploy. Dev (`pnpm dev`) accepts any extension. |
| `Generate` does nothing | Check the popup's backend indicator, and `http://localhost:3000/api/v1/health`. |
