# Model providers

_Why model selection is built the way it is, and how to add a new model
or a whole new provider._

Users pick a model in the extension; the backend serves the request with
that model. The design goal: **adding a model — or an entire non-OpenAI
provider — should be a data change plus one new file, with no edits to
the route handler, the request schema, or the UI logic.** Today we ship
OpenAI models only, but the seams are in place.

## The two halves

```
            shared/src/models.ts                backend/lib/providers/
          ┌──────────────────────┐            ┌──────────────────────┐
          │ MODEL_CATALOG        │            │ CompletionProvider   │  (interface)
          │  • id                │            │  • openai.ts         │  (impl)
          │  • label             │            │  • index.ts registry │
          │  • provider ─────────┼──────┐     └──────────┬───────────┘
          │  • description       │      │                │
          │  • tier              │      │  providerForModel(id)
          └──────────┬───────────┘      │     resolves a provider
                     │                  └────────────────┘
        extension picker + request      backend dispatch
        validation (z.enum(MODEL_IDS))
```

### 1. The catalog (`@inkwell/shared`)

[`models.ts`](../../packages/shared/src/models.ts) is the single source of
truth. Every model is one `ModelInfo` entry in `MODEL_CATALOG`:

```ts
{
  id: "gpt-4o-mini",          // sent in requests, stored in settings
  label: "GPT-4o mini",       // shown in the picker
  provider: "openai",         // which upstream serves it
  description: "...",         // blurb under the label
  tier: "fast",               // fast | balanced | quality
}
```

Derived from it:

- `ModelId` — the union of valid ids.
- `MODEL_IDS` — a tuple fed straight into `z.enum(...)`, so the request
  schema and the catalog can never drift.
- `DEFAULT_MODEL_ID` — the first catalog entry.
- `getModelInfo(id)` / `isModelId(id)` / `providerForModel(id)`.

Because the catalog is shared, the extension renders its model picker
directly from it and the backend validates the request `model` against
the same list.

### 2. The provider registry (backend)

A [`CompletionProvider`](../../packages/backend/lib/providers/types.ts)
is one upstream:

```ts
interface CompletionProvider {
  readonly id: ModelProvider;
  readonly configured: boolean;          // real credentials present?
  streamCompletion(args): AsyncGenerator<CompletionChunk>;
}
```

[`providers/index.ts`](../../packages/backend/lib/providers/index.ts) holds
a `Record<ModelProvider, CompletionProvider>` registry. The completion
pipeline calls `getProviderForModel(modelId)` and streams from whatever it
gets back — it never names a concrete provider.

The registry is typed `Record<ModelProvider, …>`, so widening the
`ModelProvider` union (step 2 below) produces a **compile error** until
you register the matching provider. You can't ship a model whose provider
doesn't exist.

## How a request flows

1. Extension popover: the user picks a model from the catalog-driven
   `<select>` (defaulting to their saved `defaultModel`).
2. The chosen `model` rides in the `COMPLETE_START` message → the
   background attaches it to the `POST /api/v1/complete` body.
3. The backend validates `model` with `z.enum(MODEL_IDS)` — unknown ids
   are rejected as `VALIDATION_FAILED`.
4. `completion-pipeline.ts` resolves `getProviderForModel(model)` and
   streams from it.

## Recipe: add another OpenAI model

Pure data change — one entry in `MODEL_CATALOG`:

```ts
{
  id: "gpt-4o",
  label: "GPT-4o",
  provider: "openai",
  description: "Higher quality, a little slower.",
  tier: "quality",
}
```

The picker, the request schema, and validation all update automatically.

## Recipe: add a new provider (e.g. Anthropic)

1. **Widen the union** in `shared/src/models.ts`:
   ```ts
   export type ModelProvider = "openai" | "anthropic";
   ```
   The backend registry now fails to compile — good, it's reminding you.

2. **Add the models** to `MODEL_CATALOG` with `provider: "anthropic"`.

3. **Implement the provider** —
   `backend/lib/providers/anthropic.ts` — a class implementing
   `CompletionProvider` (mirror `openai.ts`: a real stream + a
   non-configured fallback).

4. **Register it** in `providers/index.ts`:
   ```ts
   const PROVIDERS: Record<ModelProvider, CompletionProvider> = {
     openai: openAiProvider,
     anthropic: anthropicProvider,
   };
   ```
   Compile error resolved.

5. Add any new credential to `lib/env.ts` and `.env.example`.

Nothing else changes — not the route handler, not `completion-pipeline.ts`,
not the schema, not the extension UI.

## See also

- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete)
- [Reference: Architecture](../reference/architecture.md)
- [How-to: Add a site adapter](../how-to/add-a-site-adapter.md) — the same
  registry pattern, applied to context extraction.
- [Multilingual support](./multilingual-support.md) — the language
  catalog mirrors this same single-source-of-truth pattern.
