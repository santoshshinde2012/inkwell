# How-to: Deploy the backend to Vercel

_For someone with the repo cloned. Estimated time: 10 minutes._

Inkwell's backend has **no database and no authentication** — the only
thing to provision is an OpenAI key. Deployment is correspondingly
simple.

## At a glance

```
1. Get an OpenAI API key
2. Push to GitHub, import in Vercel
3. Set two env vars
4. Deploy
5. Rebuild the extension pointing at the Vercel URL, reload it
```

## 1. OpenAI key

Generate a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
Restrict it to:
- Models: `gpt-4o-mini`, `gpt-4o`
- Endpoint: `/v1/chat/completions`

## 2. Import the repo in Vercel

**Add New… → Project → Import** the GitHub repo. Vercel auto-detects
[`vercel.json`](../../vercel.json):

| Field | Value |
| --- | --- |
| Framework | Next.js |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm --filter @inkwell/shared build && pnpm --filter @inkwell/backend exec next build` |
| Output directory | `packages/backend/.next` |
| Region | `iad1` (change in `vercel.json` if you like) |

## 3. Environment variables

Under **Settings → Environment Variables** (Production + Preview):

```
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
ALLOWED_EXTENSION_IDS=chrome-extension://abcdef...
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini
```

That's the complete list — see
[reference/environment.md](../reference/environment.md). There are no
Clerk, Turso, or database variables.

## 4. Deploy

Click **Deploy**. The build takes ~1 minute:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @inkwell/shared build`
3. `next build`

Confirm:

```bash
curl https://your-app.vercel.app/api/v1/health
# {"ok":true,"version":"1.0.0","runtime":"edge","timestamp":"..."}
```

`POST /api/v1/complete` from a non-allowed origin returns
`403 ORIGIN_NOT_ALLOWED` — expected; the extension is the only client.

## 5. Wire up the extension

Edit `packages/extension/.env.local`:

```
VITE_BACKEND_URL=https://your-app.vercel.app
```

Rebuild and reload:

```bash
pnpm --filter @inkwell/extension build
```

In Chrome: `chrome://extensions` → reload Inkwell → copy the extension ID
→ add it to `ALLOWED_EXTENSION_IDS` in Vercel → redeploy.

## Post-deploy checklist

- [ ] `GET /api/v1/health` → `200`
- [ ] `POST /api/v1/complete` from the extension streams tokens
- [ ] Vercel logs show `[inkwell] features: openai=true`
- [ ] Logs show `kind:log.completion` lines (metadata only, no content)
- [ ] Sensitive sites (e.g. chase.com) don't show the ✨ trigger
- [ ] Prompt-injection refusal works (`403 FORBIDDEN`)
- [ ] Rate limit triggers at the 21st request in a minute (`429`)
- [ ] CORS rejects `https://evil.example.com`

## Operational notes

### Runtime & `maxDuration`

`/api/v1/complete` runs on the **Node runtime** (so the in-memory IP
rate limiter keeps state while warm) and declares `maxDuration = 60`. On
Vercel: Hobby caps at 10s, Pro at 60s. If completions get cut off on
Hobby, stick to `gpt-4o-mini` or upgrade.

### Rate limiting

The limiter is in-memory and per-IP — counters reset on cold start and
aren't shared across regions. It's a best-effort burst guard, not a hard
quota. For a hard quota you'd add a shared store; see
[architecture.md](../reference/architecture.md#trade-offs).

### Logs

`kind:log.completion` JSON lines carry metadata only (action, model,
token counts, latency) — never prompt or completion content. Attach a
[log drain](https://vercel.com/docs/observability/log-drains) for
production.

### Secrets

Only one secret: `OPENAI_API_KEY`. See
[How-to: Rotate secrets](./rotate-secrets.md).

## Rollback

In the Vercel dashboard, find a previous successful deploy and
**Promote to Production**. There's no database, so rollbacks are
unconditional and instant.

## See also

- [Reference: Environment](../reference/environment.md)
- [How-to: Rotate secrets](./rotate-secrets.md)
- [Security](../security.md)
