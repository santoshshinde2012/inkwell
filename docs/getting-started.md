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
# {"ok":true,"version":"1.1.0","runtime":"edge","timestamp":"..."}
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

Inkwell has two surfaces — they share the same actions, options, and
persisted settings:

**In-page popover.** Open any site with a text field (Gmail compose, a
tweet box, a plain `<textarea>`). Click into the field — a small Inkwell
button appears. Click it (or press `Cmd+Shift+K` / `Ctrl+Shift+K`).

**Chrome Side Panel.** Click the Inkwell toolbar icon. The assistant
docks on the right of the window and stays open while you browse.
A hamburger menu opens a slide-out drawer that switches between three
views: **Assistant** (the writing view), **History** (a searchable log
of past actions), and **Settings** (Profile, Default tone, Default
model, Working language, Frequent languages — all saved on change). The
*Open advanced settings* button in the drawer jumps to the full options
page for backend config, per-site allow/block and reset. Press
`Cmd/Ctrl+B` to toggle the drawer; press the `+` button next to the
message field to pull the active tab's highlighted text into the input.

Either way:

1. The surface opens with **Reply**, **Translate**, **Grammar**, and
   **Rewrite**. The configured defaults (tone, model, languages) work
   for most cases — so most flows are just *pick action → Generate →
   Insert / Copy*.
2. To customise, open **Options** — in the side panel it slides up as a
   bottom sheet from the action bar; in the popover it's an inline
   disclosure. Tone, model, source/target language, and a freeform
   instruction box all live there. Your last-used action, tone, model,
   source language, and target language are remembered across opens —
   and shared between the popover and the Side Panel — so both open
   where you left off. (Instruction is per-request, so it isn't
   persisted.)
3. Click **Generate** (or the send arrow in the side panel) — the
   backend streams a paragraph token-by-token.
4. Click **Insert** (popover, field mode only) to write into the field,
   **Copy**, or **Regenerate** to retry.

Nothing is auto-sent.

## 7. (Optional) Set a profile and languages

Open the side panel (toolbar icon) → hamburger menu → **Settings** for
the everyday preferences, or **Open advanced settings** in the drawer
for the full options page.

- **Profile** — a display name and "about me", attached to requests to
  personalize replies.
- **Languages** — your working language and the languages you handle
  often (surfaced first in the popover's and side panel's language
  pickers; a search filter helps when the list grows).
- **History** — every translation and draft, grouped by day, searchable.

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
| The Inkwell button never appears | Site is on the default blocklist (banks/healthcare/password managers). Try another site, or allow it in options. |
| Side panel shows "Backend offline" | The backend isn't running. Start it with `pnpm dev`, then reopen the side panel. The drawer's profile chip will turn green when it's reachable. |
| `Couldn't reach the backend …` when generating | Same as above — start `pnpm dev`, or set a reachable backend URL in Options → Backend. |
| `403 ORIGIN_NOT_ALLOWED` | Only happens against a **production** backend — add the extension ID to `ALLOWED_EXTENSION_IDS` and redeploy. Dev (`pnpm dev`) accepts any extension. |
| `Generate` does nothing | Check the side panel top bar (it shows "Backend offline" when unreachable) and `http://localhost:3000/api/v1/health`. |
