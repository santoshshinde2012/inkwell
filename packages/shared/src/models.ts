// Model catalog — the single source of truth for which models the product
// supports, what to call them in the UI, and which provider serves each.
//
// This is the contract that makes the system provider-agnostic:
//   - The extension renders a model picker straight from MODEL_CATALOG.
//   - The backend validates the requested model against MODEL_IDS and
//     dispatches to the provider named in the model's `provider` field.
//
// Adding a new provider's models later is a pure data change here plus a
// new provider implementation in the backend — no schema, route, or UI
// logic needs to change. Today we ship OpenAI models only.

/**
 * Every distinct upstream a model can be served by. Extend this union to
 * onboard a new integration (e.g. "anthropic" | "google"); the backend's
 * provider registry is keyed on it, so TypeScript will then force you to
 * register a matching provider.
 */
export type ModelProvider = "openai";

export interface ModelInfo {
  /** Stable id sent in API requests and stored in extension settings. */
  readonly id: string;
  /** Human-readable name shown in the extension's model picker. */
  readonly label: string;
  /** Which upstream serves this model. */
  readonly provider: ModelProvider;
  /** One-line blurb shown under the label in the picker. */
  readonly description: string;
  /** Coarse speed/quality bucket — lets the UI sort/group sensibly. */
  readonly tier: "fast" | "balanced" | "quality";
}

// The catalog. Order matters: the first entry is the product default.
export const MODEL_CATALOG = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    description: "Fast and economical — great for everyday replies.",
    tier: "fast",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    description:
      "Higher quality, a little slower — for nuanced or long-form writing.",
    tier: "quality",
  },
] as const satisfies readonly ModelInfo[];

/** Union of every valid model id, e.g. "gpt-4o-mini" | "gpt-4o". */
export type ModelId = (typeof MODEL_CATALOG)[number]["id"];

/** Non-empty tuple of model ids — shaped for `z.enum(...)`. */
export const MODEL_IDS = MODEL_CATALOG.map((m) => m.id) as [
  ModelId,
  ...ModelId[],
];

/** Product default — the first catalog entry. */
export const DEFAULT_MODEL_ID: ModelId = MODEL_CATALOG[0].id;

/** Look up a model's metadata by id. Returns undefined for unknown ids. */
export const getModelInfo = (id: string): ModelInfo | undefined =>
  MODEL_CATALOG.find((m) => m.id === id);

/** Type guard: is this string a known model id? */
export const isModelId = (id: unknown): id is ModelId =>
  typeof id === "string" && MODEL_CATALOG.some((m) => m.id === id);

/** The provider that serves a given model id (falls back to the default). */
export const providerForModel = (id: string): ModelProvider =>
  getModelInfo(id)?.provider ?? MODEL_CATALOG[0].provider;
