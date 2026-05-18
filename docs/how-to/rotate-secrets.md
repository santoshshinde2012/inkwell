# How-to: Rotate secrets

_For an operator rotating the OpenAI key — on a schedule or because it
leaked._

Inkwell has exactly **one secret**: `OPENAI_API_KEY`. There are no auth
keys, database tokens, or Redis credentials to manage.

## OpenAI key

Rotate without downtime — OpenAI lets old and new keys be valid at once.

```
1. Generate a new key in the OpenAI console.
2. Update OPENAI_API_KEY in Vercel (Settings → Environment Variables).
3. Redeploy (Vercel does not restart functions on env change alone).
4. Verify: a /api/v1/complete request succeeds.
5. Revoke the old key in the OpenAI console.
6. Verify again: another /api/v1/complete still succeeds.
```

If any step takes more than 5 minutes you have an operational gap — fix
the bottleneck and document it.

## Cadence

| Secret | Cadence | Sooner if… |
| --- | --- | --- |
| `OPENAI_API_KEY` | quarterly | suspected leak; staffing change |

## Redeploy semantics

Vercel does not restart running functions when you change an env var.
After updating `OPENAI_API_KEY` you must redeploy: Deployments → ⋯ on the
latest → **Redeploy**, or push any commit.

## See also

- [Reference: Environment](../reference/environment.md)
- [Security](../security.md)
