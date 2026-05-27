# Getting started

_Tutorial — clone the repo and have the extension talking to a local
backend in under ten minutes._

By the end you'll have:

- The FastAPI backend on `http://localhost:8000` (mocked OpenAI — no key
  needed).
- The Chrome extension loaded and pointing at the local backend.
- A working "Generate reply" flow on any text field.

There is **no sign-in** — Inkwell works anonymously.

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | ≥ 20.10 | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` |
| Python | ≥ 3.12 | `python3 --version` |
| Chrome / Chromium | recent | `chrome://version` |

No pnpm? `npm i -g pnpm` or use [corepack](https://nodejs.org/api/corepack.html).

## 1. Install the JS workspace

```bash
pnpm install
```

## 2. Build the shared types package

The extension depends on `@inkwell/shared` via `workspace:*`:

```bash
pnpm --filter @inkwell/shared build
```

Repeat only when you change shared schemas/types.

## 3. Install the Python backend

```bash
cd backend
make install     # creates .venv with all dev extras
cd ../..
```

`make install` is a one-off — subsequent runs of `make dev` reuse the
existing virtualenv.

## 4. Boot both dev servers

Two terminals (or two `tmux` panes):

```bash
# Terminal 1 — backend on :8000
make backend

# Terminal 2 — extension watcher (writes frontend/packages/extension/dist/)
make frontend
```

The backend's startup log line ends with `has_openai=False`, which
confirms it's in mock mode.

## 5. Confirm the backend

```bash
curl http://localhost:8000/api/v1/health
# {"ok":true,"version":"1.1.0","runtime":"fastapi","timestamp":"..."}
```

While you're iterating the auto-generated OpenAPI docs are also live at
<http://localhost:8000/docs>.

## 6. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select `frontend/packages/extension/dist/`.

That's it for local development. When the backend runs in dev mode, its
CORS layer accepts **any** `chrome-extension://` origin, so the
extension works the moment it is loaded — no extra step.

> **For production only:** a deployed backend keeps a strict allowlist.
> Set `ALLOWED_EXTENSION_IDS=chrome-extension://<your-extension-id>` in
> the deploy environment, or requests get `403 ORIGIN_NOT_ALLOWED`.

## 7. Use it

Inkwell has two surfaces — they share the same actions, options, and
persisted settings:

**In-page popover.** Open any site with a text field (Gmail compose, a
tweet box, a plain `<textarea>`). Click into the field — a small Inkwell
button appears. Click it (or press `Cmd+Shift+K` / `Ctrl+Shift+K`).

**Chrome Side Panel.** Click the Inkwell toolbar icon. The assistant
docks on the right of the window and stays open while you browse. Each
of the three views has its own slim top bar showing where you are and
a live backend-status dot: **Assistant** (the writing view, with
filter chips and a sticky chat-input bar), **History** (per-action
filter chips, sticky day headers, hover-Copy on every row), and
**Settings** (Profile, Default tone, Default model, Working language,
Frequent languages — all saved on change). The hamburger on the left
of every top bar opens a drawer with the same three nav items plus
*Open advanced settings*, which jumps to the full options page for
backend config, per-site allow/block, and reset. Press `Cmd/Ctrl+B`
to toggle the drawer; press the image button next to the message
field to pull text out of a pasted/dropped/picked image.

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

## 8. (Optional) Set a profile and languages

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
| Understand the architecture | [Reference: Architecture](./reference/architecture.md) |
| Understand multilingual support | [Explanation: Multilingual support](./explanation/multilingual-support.md) |
| Add an adapter for another site | [How-to: Add a site adapter](./how-to/add-a-site-adapter.md) |

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Could not find @inkwell/shared` | You skipped step 2; run it. |
| `make install` complains about Python version | Need Python 3.12+; check `python3 --version` and install via `brew install python@3.12` / `apt install python3.12`. |
| The Inkwell button never appears | Site is on the default blocklist (banks/healthcare/password managers). Try another site, or allow it in options. |
| Side panel shows "Backend offline" | The backend isn't running. Start it with `make backend`, then reopen the side panel. The top-bar status dot turns green and the drawer's profile chip flips to "Backend online" when it's reachable. |
| `Couldn't reach the backend …` when generating | Same as above — start `make backend`, or set a reachable backend URL in Options → Backend. |
| `403 ORIGIN_NOT_ALLOWED` | Only happens against a **production** backend — add the extension ID to `ALLOWED_EXTENSION_IDS` and restart the service. Dev mode accepts any extension. |
| `Generate` does nothing | Check the side panel top bar (it shows "Backend offline" when unreachable) and `http://localhost:8000/api/v1/health`. |
