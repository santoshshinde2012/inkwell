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
 * Probe `${url}/api/v1/health` once. Returns `down` for missing/invalid
 * URLs, fetch failures, or any non-OK response. Never throws.
 */
export const probeBackend = async (
  url: string | undefined,
  apiKey: string | undefined,
): Promise<BackendProbeResult> => {
  if (!url) return { status: "down", url: "" };
  try {
    const res = await fetch(`${url}/api/v1/health`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
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
  }
};
