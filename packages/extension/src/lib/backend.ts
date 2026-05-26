// Backend health probe shared across the Side Panel views.
//
// Kept in lib/ (not in sidepanel/) so the value-level import is one-way:
// every view imports from here, nothing imports back. Avoids a circular
// dependency between App.tsx and Assistant.tsx.

export type BackendStatus = "checking" | "ok" | "down";

export interface BackendProbeResult {
  status: BackendStatus;
  url: string;
}

/**
 * Hard ceiling on a single probe. A slow backend or a captive portal that
 * holds the connection open should fail closed in a bounded amount of
 * time instead of leaving the UI stuck on "Connecting…" forever.
 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Probe `${url}/api/v1/health` once. Returns `down` for missing/invalid
 * URLs, fetch failures, non-OK responses, or timeouts past
 * `PROBE_TIMEOUT_MS`. Never throws.
 */
export const probeBackend = async (
  url: string | undefined,
  apiKey: string | undefined,
): Promise<BackendProbeResult> => {
  if (!url) return { status: "down", url: "" };
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    PROBE_TIMEOUT_MS,
  );
  try {
    const res = await fetch(`${url}/api/v1/health`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: unknown }
      | null;
    return {
      status: res.ok && body?.ok === true ? "ok" : "down",
      url,
    };
  } catch {
    return { status: "down", url };
  } finally {
    window.clearTimeout(timeoutId);
  }
};
