// Model catalog — the bundled fallback the extension ships with.
//
// The actual catalog data is **not** literal in this file. It comes
// from a single source-of-truth JSON owned by the backend at
//   backend/src/inkwell_backend/config/models.catalog.json
// and is copied (unchanged) into this package's source tree by
//   packages/shared/scripts/sync-config.mjs
// which runs automatically as `prebuild` / `predev` / `pretypecheck`.
//
// At runtime the extension prefers the backend's live catalog
// (`GET /api/v1/models`); this bundled list only kicks in:
//   - on first run, before the backend has been reached;
//   - when the backend is unreachable.
//
// Adding a model is therefore a single change to the JSON file —
// the backend reads it at startup, the frontend bakes the same file
// into its bundle, and a matching provider must exist on the backend
// (`backend/src/inkwell_backend/providers/...`).

import { z } from "zod";
// The generated copy is gitignored; the prebuild step keeps it in
// step with the backend's source-of-truth file. A fresh checkout
// must run `pnpm sync-config` (or any of the wired pnpm scripts)
// before tsc can resolve this import.
import catalogJson from "./_generated/models.catalog.json" with { type: "json" };
import { LIMITS } from "./constants";

/**
 * Every distinct upstream a model can be served by. Kept narrow at
 * the type level for the bundled catalog. The runtime catalog
 * (`RemoteModelInfo`) widens this to `string` so a new provider
 * added on the backend doesn't need a frontend rebuild.
 *
 * To onboard a new vendor: add a member here AND register a matching
 * provider on the backend; the backend's `ModelProvider` enum is the
 * authoritative gate.
 */
export type ModelProvider = "openai";

const TIERS = ["fast", "balanced", "quality"] as const;

// JSON-shape validation. Runs once at module load — catches a
// malformed generated file (the sync script can be skipped, edited
// by mistake, or land mid-way through a partial write) before any
// caller observes corrupted data.
const ModelInfoSchema = z.object({
  id: z.string().min(1).max(LIMITS.MAX_MODEL_ID_CHARS),
  label: z.string().min(1).max(80),
  // Bundled provider field is constrained to the type-level union so
  // a rebuild-required mismatch surfaces at module load rather than
  // silently rendering a card with no provider behind it. The
  // remote-catalog path is permissive — see RemoteModelInfo below.
  provider: z.enum(["openai"]),
  description: z.string().max(300),
  tier: z.enum(TIERS),
});

const CatalogSchema = z.object({
  default: z.string().min(1),
  // `.min(1)` (not `.nonempty()`) so the inferred type is `T[]`
  // rather than `[T, ...T[]]` — the non-empty tuple is technically
  // more precise but forces every consumer that builds a fallback
  // catalog to construct a tuple. `.min(1)` keeps the runtime
  // invariant without that ceremony.
  models: z.array(ModelInfoSchema).min(1),
});

const parsed = CatalogSchema.parse(catalogJson);

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
  readonly tier: (typeof TIERS)[number];
}

/** Bundled catalog. Order matches the JSON file; the first entry is
 *  the product default. */
export const MODEL_CATALOG: readonly ModelInfo[] = parsed.models;

/** A model id at the wire boundary. The live catalog is fetched from
 *  the backend (see `ModelCatalogResponse`) so any id the backend
 *  returns must round-trip through the extension's settings and
 *  pickers — a narrow union over the bundled list would force a
 *  rebuild whenever a model was added on the server. Stays as
 *  `string` and is validated where rendering happens. */
export type ModelId = string;

/** Product default — the backend's `default` field. */
export const DEFAULT_MODEL_ID: string = parsed.default;

/** Look up a model's metadata by id. Returns undefined for unknown
 *  ids. Resolves against the *bundled* fallback; UI surfaces that
 *  need the live catalog should use the cached `/api/v1/models`
 *  response instead. */
export const getModelInfo = (id: string): ModelInfo | undefined =>
  MODEL_CATALOG.find((m) => m.id === id);

// ---------------------------------------------------------------------------
// Remote catalog — shape of `GET /api/v1/models`
// ---------------------------------------------------------------------------
//
// The bundled `ModelInfo` keeps `provider` typed to the closed union
// for build-time safety. The remote shape uses `string` so a backend
// that adds a new vendor doesn't trip frontend type checking. UI
// surfaces render `label`, `description`, and `tier`; the `provider`
// field is opaque from the extension's perspective.

// Row schema is an internal building block — `ModelCatalogResponseSchema`
// is the only thing callers need. Kept un-exported so the public
// surface of @inkwell/shared stays small.
const RemoteModelInfoSchema = z.object({
  id: z.string().min(1).max(LIMITS.MAX_MODEL_ID_CHARS),
  label: z.string().min(1).max(80),
  provider: z.string().min(1),
  description: z.string().max(300),
  tier: z.enum(TIERS),
});

/** Zod schema for the full `/api/v1/models` response body. Used by
 *  the extension's fetch layer to validate at the wire boundary and
 *  by the storage cache validator — see
 *  `extension/src/lib/models.ts`. */
export const ModelCatalogResponseSchema = z.object({
  default: z.string().min(1),
  models: z.array(RemoteModelInfoSchema).min(1),
});

export type RemoteModelInfo = z.infer<typeof RemoteModelInfoSchema>;
export type ModelCatalogResponse = z.infer<typeof ModelCatalogResponseSchema>;
