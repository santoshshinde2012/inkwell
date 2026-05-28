// Model catalog client. The backend's GET /api/v1/models is the source
// of truth; this module keeps a copy in chrome.storage.local so every
// UI surface (options page, side panel, in-page popover) renders the
// same list without each one re-fetching.
//
// Lifecycle:
//   - Background service worker calls `refreshModelCatalog()` on
//     install, on browser startup, on the periodic alarm, and whenever
//     the user changes the backend URL.
//   - Every UI surface reads via `loadModelCatalog()` (and listens for
//     storage changes through `MODELS_STORAGE_KEY`) so a refresh shows
//     up immediately.
//
// First-run / offline behaviour: when the cache is empty or the fetch
// fails, callers get the bundled `MODEL_CATALOG` from @inkwell/shared
// so the picker is never empty. The bundled list is intentionally tiny
// — the real list comes from the backend.

import { z } from "zod";
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  ModelCatalogResponseSchema,
  type ModelCatalogResponse,
} from "@inkwell/shared";

/** chrome.storage.local key for the cached catalog. Exported so hooks
 *  using `useStorageChange` can subscribe to writes. */
export const MODELS_STORAGE_KEY = "models.catalog";

/** Single-fetch budget. The endpoint is cheap (no provider call) but a
 *  half-down backend or a captive portal shouldn't keep the picker
 *  stuck — fail closed and use the cached / bundled list. */
const FETCH_TIMEOUT_MS = 4000;

// The Zod schemas for the wire payload live in @inkwell/shared so the
// bundled fallback and the live response use one set of rules. Here
// we wrap the response schema in the cache envelope (fetchedAt +
// backendUrl) the storage layer cares about.
const CachedCatalogSchema = z.object({
  /** When the cache was written, ms-since-epoch. Used by the
   *  background's periodic refresh to decide whether to re-fetch. */
  fetchedAt: z.number(),
  /** Which backend produced this list. If the user changes the
   *  backend URL we discard the cache rather than show entries from
   *  a different deployment. */
  backendUrl: z.string(),
  /** The body of /api/v1/models, verbatim. */
  body: ModelCatalogResponseSchema,
});
type CachedCatalog = z.infer<typeof CachedCatalogSchema>;

/** The bundled fallback, packaged the same way the backend would return
 *  it — so consumers can treat the bundled and remote shapes uniformly. */
const BUNDLED: ModelCatalogResponse = {
  default: DEFAULT_MODEL_ID,
  models: MODEL_CATALOG.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    description: m.description,
    tier: m.tier,
  })),
};

/** Read the cached catalog from chrome.storage.local. Returns the
 *  bundled fallback when no cache exists or the cache is for a
 *  different backend (so a user who points the extension at a new
 *  backend doesn't see the old backend's list until the next refresh).
 */
export const loadModelCatalog = async (
  expectedBackendUrl?: string,
): Promise<ModelCatalogResponse> => {
  try {
    const r = await chrome.storage.local.get(MODELS_STORAGE_KEY);
    const cached = CachedCatalogSchema.safeParse(r?.[MODELS_STORAGE_KEY]);
    if (!cached.success) return BUNDLED;
    if (expectedBackendUrl && cached.data.backendUrl !== expectedBackendUrl) {
      return BUNDLED;
    }
    return cached.data.body;
  } catch {
    return BUNDLED;
  }
};

/** Persist a freshly-fetched catalog along with the originating backend
 *  URL and timestamp. */
const saveModelCatalog = async (body: ModelCatalogResponse, backendUrl: string): Promise<void> => {
  try {
    const record: CachedCatalog = {
      fetchedAt: Date.now(),
      backendUrl,
      body,
    };
    await chrome.storage.local.set({ [MODELS_STORAGE_KEY]: record });
  } catch {
    // Storage write failed — non-fatal; the next refresh will try again.
  }
};

/** Drop the cache. Called when the user changes the backend URL so the
 *  next refresh seeds from a clean slate. */
export const clearModelCatalogCache = async (): Promise<void> => {
  try {
    await chrome.storage.local.remove(MODELS_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
};

/** One-shot fetch of GET /api/v1/models. Returns null on any failure
 *  (network, timeout, non-OK status, malformed body) so callers can
 *  fall back to the cached / bundled list without a try/catch. */
export const fetchModelCatalog = async (
  backendUrl: string,
  apiKey: string | undefined,
): Promise<ModelCatalogResponse | null> => {
  if (!backendUrl) return null;
  const controller = new AbortController();
  const timeoutId = self.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${backendUrl}/api/v1/models`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as unknown;
    const parsed = ModelCatalogResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    self.clearTimeout(timeoutId);
  }
};

/** Fetch and persist. Returns the catalog the extension should use
 *  going forward — fetched on success, the previously-cached value (or
 *  the bundled fallback) on failure. Idempotent; safe to call from any
 *  lifecycle hook. */
export const refreshModelCatalog = async (
  backendUrl: string,
  apiKey: string | undefined,
): Promise<ModelCatalogResponse> => {
  const fetched = await fetchModelCatalog(backendUrl, apiKey);
  if (fetched) {
    await saveModelCatalog(fetched, backendUrl);
    return fetched;
  }
  return loadModelCatalog(backendUrl);
};
