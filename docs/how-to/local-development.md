# How-to: Local development

_Once you've finished [Getting started](../getting-started.md), this is
how to use a real OpenAI key and work on one layer at a time._

## Using a real OpenAI key

By default the backend serves a mock streaming response. To use the real
model locally, put your key in `packages/backend/.env.local`:

```
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini
```

Restart `pnpm dev`. The banner should read `[inkwell] features: openai=true`.

That's the only external service — there is no database or auth to set
up. See [reference/environment.md](../reference/environment.md).

## Working on one package

```bash
pnpm --filter @inkwell/backend dev          # backend only
pnpm --filter @inkwell/extension dev        # extension only (writes dist/)
pnpm --filter @inkwell/shared build --watch # rebuild shared types on save
```

> When you change `packages/shared/`, rebuild it before the consuming
> packages see the change. `--watch` does this automatically.

## Useful curl recipes

No auth header is needed — the API is anonymous.

```bash
# Health
curl http://localhost:3000/api/v1/health

# Streaming completion
curl -N http://localhost:3000/api/v1/complete \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"author":"Bob","text":"hi"}}}'

# Translate a customer query into English
curl -N http://localhost:3000/api/v1/complete \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"action":"translate","context":{"post":{"text":"Bonjour, ma commande est en retard."}},
       "sourceLanguage":"fr","targetLanguage":"en"}'

# Reply to a French customer, in French (targetLanguage omitted = match source)
curl -N http://localhost:3000/api/v1/complete \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"text":"Ma commande est en retard."}},
       "sourceLanguage":"fr"}'

# With personalization (what the extension attaches from local storage)
curl -N http://localhost:3000/api/v1/complete \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"action":"reply","context":{"post":{"text":"hi"}},
       "profile":{"displayName":"Alex","aboutMe":"PM, prefers concise"}}'
```

## Iterating on the extension

`pnpm --filter @inkwell/extension dev` rebuilds `dist/` on save. Chrome
doesn't auto-reload extensions — click the reload icon on
`chrome://extensions` after a rebuild.

- **Popover (in-page UI):** DevTools on whatever site you're testing.
- **Background service worker:** "Inspect views: service worker" on the
  extension card.
- **Popup:** right-click the extension icon → Inspect popup.
- **Stored settings:** the service-worker DevTools console —
  `chrome.storage.local.get(console.log)`.

## See also

- [Getting started](../getting-started.md)
- [How-to: Add a site adapter](./add-a-site-adapter.md)
- [Reference: API](../reference/api.md)
