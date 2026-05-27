// BackendTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { useState, type JSX } from "react";
import { DEFAULT_BACKEND_URL, localStore, normalizeBackendUrl } from "../../lib/storage";
import { Card, type TabProps } from "../components";

/** Result of the "Test connection" round-trip — drives the inline
 *  status badge below the form. */
type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "error"; detail: string };

export function BackendTab({ settings, patch, flash }: TabProps): JSX.Element {
  const [url, setUrl] = useState(settings.backendUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const dirty = url !== settings.backendUrl || apiKey !== settings.apiKey;
  const isDefault = settings.backendUrl === DEFAULT_BACKEND_URL;

  /** Hit <url>/api/v1/health to confirm the backend is reachable. */
  const runTest = async (target: string, key: string): Promise<void> => {
    setTest({ kind: "testing" });
    try {
      const res = await fetch(`${target}/api/v1/health`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      });
      if (!res.ok) {
        setTest({ kind: "error", detail: `Backend returned HTTP ${res.status}.` });
        return;
      }
      const body = (await res.json()) as { ok?: unknown; version?: unknown };
      if (body?.ok === true) {
        const v = typeof body.version === "string" ? ` (v${body.version})` : "";
        setTest({ kind: "ok", detail: `Connected${v}.` });
      } else {
        setTest({
          kind: "error",
          detail: "Reached the URL but it isn't an Inkwell-compatible backend.",
        });
      }
    } catch {
      setTest({
        kind: "error",
        detail:
          "Couldn't reach the backend. Check the URL, and that its CORS " +
          "allows this extension's origin.",
      });
    }
  };

  /**
   * Save the backend config. Requests host permission FIRST (before any
   * await) so the click's user-gesture is still valid, then persists and
   * auto-tests.
   */
  const save = async (): Promise<void> => {
    const normalized = normalizeBackendUrl(url);
    if (!normalized) {
      setTest({
        kind: "error",
        detail: "Enter a valid http(s) URL, e.g. https://api.example.com",
      });
      return;
    }
    setBusy(true);
    try {
      const originPattern = new URL(normalized).origin + "/*";
      // chrome.permissions.request must be the first async call in the
      // gesture — request the exact origin, never the wildcard.
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });
      if (!granted) {
        setTest({
          kind: "error",
          detail:
            "Host permission denied. Inkwell can't call a backend it isn't " +
            "permitted to reach.",
        });
        return;
      }
      const ok = await localStore.setBackend(normalized, apiKey);
      if (!ok) {
        setTest({ kind: "error", detail: "Couldn't save — invalid URL." });
        return;
      }
      setUrl(normalized);
      patch({ backendUrl: normalized, apiKey });
      flash("Backend saved");
      await runTest(normalized, apiKey);
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = (): void => {
    setUrl(DEFAULT_BACKEND_URL);
    setApiKey("");
    setTest({ kind: "idle" });
  };

  return (
    <>
      <Card
        title="Backend"
        description="Inkwell talks to this API. Use the default, or point it at your own backend — anything that implements the Inkwell API contract."
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Backend URL
            </span>
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              API key{" "}
              <span className="font-normal text-zinc-400">
                — optional, only if your backend requires it
              </span>
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Sent as: Authorization: Bearer …"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !dirty}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save & test"}
            </button>
            <button
              type="button"
              onClick={() => void runTest(settings.backendUrl, settings.apiKey)}
              disabled={busy || test.kind === "testing"}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Test saved backend
            </button>
            {!isDefault && (
              <button
                type="button"
                onClick={resetToDefault}
                disabled={busy}
                className="text-xs text-zinc-500 underline hover:text-zinc-800 disabled:opacity-40 dark:hover:text-zinc-200"
              >
                Reset to default
              </button>
            )}
          </div>

          {test.kind !== "idle" && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                test.kind === "ok"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : test.kind === "error"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              <span aria-hidden="true" className="mt-px inline-flex">
                {test.kind === "ok" && "✓"}
                {test.kind === "error" && "✗"}
                {test.kind === "testing" && <TestSpinner />}
              </span>
              <span>{test.kind === "testing" ? "Testing connection…" : test.detail}</span>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          The currently active backend is{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{settings.backendUrl}</code>
          {isDefault && " (default)"}. Saving a new URL asks Chrome for permission to reach that
          host.
        </p>
      </Card>

      <Card
        title="Bring your own backend"
        description="Any server that implements two endpoints works."
      >
        <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
              GET /api/v1/health
            </code>{" "}
            → <code className="text-xs">{"{ ok: true }"}</code>
          </li>
          <li>
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
              POST /api/v1/complete
            </code>{" "}
            → a Server-Sent Events stream of tokens
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Your backend must also allow this extension&apos;s origin via CORS. The full
          request/response contract is in the project docs (docs/how-to/use-your-own-backend.md).
        </p>
      </Card>
    </>
  );
}

/**
 * Compact animated spinner used inline next to "Testing connection…".
 * Sized to match the surrounding emoji-style status glyphs (✓ / ✗) so the
 * row height doesn't jump when the test resolves.
 */
function TestSpinner(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Sites tab
// -----------------------------------------------------------------------------
