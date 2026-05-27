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
            shared/src/models.ts            backend/.../providers/
          ┌──────────────────────┐         ┌──────────────────────────┐
          │ MODEL_CATALOG        │         │ CompletionProvider       │  (Protocol)
          │  • id                │         │  • openai_provider.py    │  (impl)
          │  • label             │         │  • registry.py           │  (dispatch)
          │  • provider ─────────┼───┐     └──────────┬───────────────┘
          │  • description       │   │                │
          │  • tier              │   │  provider_for_model(id)
          └──────────┬───────────┘   │     resolves a provider
                     │               └────────────────┘
        extension picker + request   backend dispatch
        validation (z.enum(MODEL_IDS))
```

### 1. The catalog (`@inkwell/shared`)

[`models.ts`](../../frontend/packages/shared/src/models.ts) is the single source
of truth for the extension. Every model is one `ModelInfo` entry in
`MODEL_CATALOG`:

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

The Python backend keeps a mirror of the catalog in
[`domain/models.py`](../../backend/src/inkwell_backend/domain/models.py)
with identical shape. Keep both copies aligned when you add a model.

### 2. The provider registry (backend)

A [`CompletionProvider`](../../backend/src/inkwell_backend/providers/base.py)
is one upstream:

```python
class CompletionProvider(Protocol):
    id: ModelProvider

    @property
    def configured(self) -> bool: ...   # real credentials present?

    def stream_completion(self, args: ProviderCompletionArgs) -> AsyncIterator[CompletionChunk]: ...
```

[`providers/registry.py`](../../backend/src/inkwell_backend/providers/registry.py)
holds a `dict[ModelProvider, CompletionProvider]`. The completion
pipeline calls `get_provider_for_model(model_id)` and streams from
whatever it gets back — it never names a concrete provider.

The registry is typed `dict[ModelProvider, CompletionProvider]`, so
widening the `ModelProvider` enum (step 1 below) produces a **type
error** until you register the matching provider. You can't ship a
model whose provider doesn't exist.

## How a request flows

1. Extension popover: the user picks a model from the catalog-driven
   `<select>` (defaulting to their saved `defaultModel`).
2. The chosen `model` rides in the `COMPLETE_START` message → the
   background attaches it to the `POST /api/v1/complete` body.
3. The backend validates `model` against the catalog — unknown ids
   are rejected as `VALIDATION_FAILED`.
4. `services/completion.py` resolves `get_provider_for_model(model)` and
   streams from it.

## Recipe: add another OpenAI model

Pure data change — one entry in `MODEL_CATALOG` on each side.

In `frontend/packages/shared/src/models.ts`:

```ts
{
  id: "gpt-4o",
  label: "GPT-4o",
  provider: "openai",
  description: "Higher quality, a little slower.",
  tier: "quality",
}
```

In `backend/src/inkwell_backend/domain/models.py`:

```python
ModelInfo(
    id="gpt-4o",
    label="GPT-4o",
    provider=ModelProvider.OPENAI,
    description="Higher quality, a little slower.",
    tier="quality",
),
```

The picker, the request schema, and validation all update automatically.

## Recipe: add a new provider (e.g. Anthropic)

1. **Widen the `ModelProvider` enum** on both sides:
   - `frontend/packages/shared/src/models.ts`:
     ```ts
     export type ModelProvider = "openai" | "anthropic";
     ```
   - `backend/src/inkwell_backend/domain/models.py`:
     ```python
     class ModelProvider(StrEnum):
         OPENAI = "openai"
         ANTHROPIC = "anthropic"
     ```
   The backend registry now fails to type-check — good, it's reminding
   you.

2. **Add the models** to `MODEL_CATALOG` on both sides with the new
   provider.

3. **Implement the provider** —
   `backend/src/inkwell_backend/providers/anthropic_provider.py`
   exposing a module-level `anthropic_provider: CompletionProvider`
   (mirror `openai_provider.py`: a real async stream + a non-configured
   fallback delegating to `mock_provider.mock_stream`).

4. **Register it** in `providers/registry.py`:
   ```python
   _PROVIDERS: dict[ModelProvider, CompletionProvider] = {
       ModelProvider.OPENAI: openai_provider,
       ModelProvider.ANTHROPIC: anthropic_provider,
   }
   ```
   Type error resolved.

5. Add any new credential to `settings.py` and `.env.example`.

Nothing else changes — not the route handler, not `services/completion.py`,
not the schema, not the extension UI.

## See also

- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete)
- [Reference: Architecture](../reference/architecture.md)
- [How-to: Add a site adapter](../how-to/add-a-site-adapter.md) — the same
  registry pattern, applied to context extraction.
- [Multilingual support](./multilingual-support.md) — the language
  catalog mirrors this same single-source-of-truth pattern.
