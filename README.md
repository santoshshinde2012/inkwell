# Inkwell

A multilingual writing assistant that lives inside every text field on
the web. Reply to messages, fix grammar, translate, and rewrite — in 15
languages — without ever leaving the page you're on.

---

## Repository layout

The project is split top-level by language so each subtree owns its own
toolchain:

```
extension-reply/
├── backend/         Python (FastAPI) service — /api/v1/{health,live,ready,version,models,complete,ocr}
├── frontend/        TypeScript pnpm workspace
│   └── packages/
│       ├── extension/   Chrome MV3 extension (the Inkwell UI)
│       └── shared/      shared schemas + types
├── docs/            Diátaxis-structured project documentation
├── Makefile         repo-root orchestration (install / dev / test / lint)
└── .github/         CI for both backends
```

The two halves are independent: changes to `backend/` don't touch the
Node toolchain and vice versa. CI runs them in parallel jobs.

## What you can do with Inkwell

### 1. Reply to customer messages in their language
A support ticket arrives in Japanese. You open the reply box, press
`Cmd+Shift+K`, and Inkwell:

- detects the incoming language,
- translates the customer's message so you understand it,
- drafts a reply in Japanese (or English, or both side-by-side).

Review, click **Insert**, and the reply lands in the field. Nothing is
ever sent automatically.

### 2. Reply to emails with the right tone
On Gmail or Outlook, Inkwell reads the email thread, then drafts a
reply in your chosen tone — **Professional**, **Friendly**, **Concise**,
or **Detailed** — or any freeform instruction you type ("apologetic but
firm", "ask for a meeting next week").

### 3. Fix grammar without losing your voice
Type a message, choose **Grammar**, and Inkwell corrects spelling,
punctuation, and grammar while keeping your wording and style intact.
Works in any of the 15 supported languages.

### 4. Rewrite — or compose from a brief
**Rewrite** is two tools in one:

- Have a draft? It polishes, shortens, expands, or changes the tone.
- Have only an idea? Type a one-line brief ("decline the meeting
  politely, suggest Friday instead") and it writes the full message.

### 5. Translate anything you're reading or writing
Open the popover on any field to translate to or from any of the 15
supported languages. Every translation is saved to an on-device history
you can search later.

### 6. Post on LinkedIn, X, or anywhere
LinkedIn posts, X (Twitter) replies, Slack threads, WhatsApp Web,
GitHub comments, Notion docs, plain `<textarea>`s — anywhere you can
type, Inkwell works. Built-in adapters pull thread context on the major
platforms; a generic adapter handles everything else.

### 7. Extract text from screenshots and images
Pull text out of any image, then keep working on it with the other
tools. Four ways in:

- paste a screenshot into the side panel's input,
- click the image button in the input bar to pick an image file,
- drag-drop an image onto the panel,
- or right-click any image on a page and choose **Extract text with
  Inkwell** — the result opens directly in the in-page popover (no
  side-panel detour), pre-filled and ready for Reply / Translate /
  Grammar / Rewrite.

Recognition runs through `/api/v1/ocr`, which forwards the image to a
vision model (gpt-4o-mini by default). Fast, multilingual, handles
messy screenshots well. The image leaves your browser to reach your
backend; the backend doesn't store it. The extracted text lands
wherever you started — input bar or popover — ready to reply to,
translate, fix, or rewrite.

### 8. Keep a searchable history of what you wrote
Every draft, translation, and rewrite is saved locally in your browser
(`chrome.storage.local`) — never sent to a server, never tied to an
account. Open the **History** tab in the options page to find that
reply you sent last week.

---

## Why people use it

- **No sign-up, no account, no database.** Install and use.
- **Streaming previews.** Tokens appear as the model writes them — you
  can stop a response early if it's heading the wrong way.
- **Preview-before-insert.** Nothing is auto-inserted, auto-sent, or
  silently changed.
- **Your data stays yours.** Settings and history live on your device.
  The backend doesn't log message content.
- **Bring your own backend.** Point the extension at any server that
  speaks the documented API — your own OpenAI key, your own infra.

---

## Get started

```bash
make install     # installs both halves (pnpm + .venv)
make dev         # runs backend + extension watcher together
```

Or run each half explicitly:

```bash
# Python backend (FastAPI on :8000)
make -C backend install
make -C backend dev

# TypeScript frontend (extension watcher → frontend/packages/extension/dist/)
cd frontend && pnpm install
cd frontend && pnpm dev
```

Load `frontend/packages/extension/dist/` in `chrome://extensions`
(Developer mode → Load unpacked). Full walk-through:
[docs/getting-started.md](./docs/getting-started.md).

## License

UNLICENSED — see [LICENSE](./LICENSE).
