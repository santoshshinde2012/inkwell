// React hook over the cached model catalog (chrome.storage.local).
//
// The background service worker keeps the cache fresh (see
// src/background/index.ts: `refreshModelsFromStorage`). UI surfaces
// consume the cache through this hook so adding a model on the
// backend shows up everywhere — popover, side panel, options page —
// without each one re-fetching.
//
// The hook starts with the bundled fallback so the first render isn't
// blocked on a storage round-trip; the cached value swaps in as soon
// as it resolves. Storage writes (background refresh, or a screen
// asking for `refreshOnMount`) propagate through `useStorageChange`.

import { useEffect, useState } from "react";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, type ModelCatalogResponse } from "@inkwell/shared";
import { loadModelCatalog, MODELS_STORAGE_KEY, refreshModelCatalog } from "./models";
import { localStore } from "./storage";
import { useStorageChange } from "./useStorageChange";

interface UseModelCatalogResult {
  /** Current catalog — bundled fallback on first render, cached value
   *  afterwards, fresh backend response once the on-mount refresh
   *  resolves (when requested). */
  catalog: ModelCatalogResponse;
  /** True once at least one resolved read (cache or fetch) has
   *  replaced the bundled fallback. UI can use this to defer rendering
   *  "no models available" empty states until the real list arrives. */
  loaded: boolean;
}

// Synchronous default for render 0 — kept here so the bundled fallback
// shape (RemoteModelInfo[]) matches what `loadModelCatalog` returns on
// a cache miss.
const FALLBACK: ModelCatalogResponse = {
  default: DEFAULT_MODEL_ID,
  models: MODEL_CATALOG.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    description: m.description,
    tier: m.tier,
  })),
};

/** Subscribe to the cached model catalog. Pass `refreshOnMount: true`
 *  from surfaces where the user is likely to be staring at the picker
 *  (the options page) — it triggers a one-shot backend fetch so
 *  changes show up without waiting for the periodic refresh. */
export function useModelCatalog(opts: { refreshOnMount?: boolean } = {}): UseModelCatalogResult {
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cached = await loadModelCatalog();
      if (cancelled) return;
      setCatalog(cached);

      if (!opts.refreshOnMount) return;
      const settings = await localStore.getAll().catch(() => null);
      if (cancelled || !settings) return;
      const fresh = await refreshModelCatalog(settings.backendUrl, settings.apiKey || undefined);
      if (!cancelled) setCatalog(fresh);
    })();

    return () => {
      cancelled = true;
    };
  }, [opts.refreshOnMount]);

  // Re-read through `loadModelCatalog` (instead of pulling `newValue`
  // straight from the change record) so a cache-clear event lands on
  // the bundled-fallback path without special casing here.
  useStorageChange([MODELS_STORAGE_KEY], () => {
    void loadModelCatalog().then(setCatalog);
  });

  return { catalog: catalog ?? FALLBACK, loaded: catalog !== null };
}
