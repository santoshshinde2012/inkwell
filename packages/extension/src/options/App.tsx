import { useEffect, useMemo, useState } from "react";
import {
  ACTIONS,
  DEFAULT_BLOCKED_HOSTS,
  LANGUAGE_CATALOG,
  LocalSettings,
  MODEL_CATALOG,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  languageDisplayName,
  languageLabel,
  type Action,
  type LanguageId,
  type ModelId,
  type TonePreset,
} from "@inkwell/shared";
import {
  DEFAULT_BACKEND_URL,
  localStore,
  normalizeBackendUrl,
} from "../lib/storage";
import { historyStore, type HistoryEntry } from "../lib/history";

type Tab = "general" | "languages" | "history" | "backend" | "sites" | "about";

const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
};

const KBD_SHORTCUT = navigator.platform.includes("Mac")
  ? "⌘⇧K"
  : "Ctrl+Shift+K";

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void localStore.getAll().then(setSettings);
  }, []);

  const flash = (msg: string): void => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  };

  if (!settings) {
    return (
      <div className="min-h-screen bg-zinc-950" aria-busy="true">
        <Header />
        <div className="mx-auto max-w-3xl px-6 py-8">
          <div className="h-10 animate-pulse rounded-2xl bg-zinc-900/60" />
          <div className="mt-6 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl border border-zinc-800/60 bg-zinc-900/40"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const patch = (next: Partial<LocalSettings>): void => {
    setSettings((s) => (s ? { ...s, ...next } : s));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-zinc-800/70 bg-zinc-950/90 px-6 py-3 backdrop-blur">
          <Tabs current={tab} onChange={setTab} />
        </div>

        <div className="space-y-4">
          {tab === "general" && (
            <GeneralTab settings={settings} patch={patch} flash={flash} />
          )}
          {tab === "languages" && (
            <LanguagesTab settings={settings} patch={patch} flash={flash} />
          )}
          {tab === "history" && <HistoryTab />}
          {tab === "backend" && (
            <BackendTab settings={settings} patch={patch} flash={flash} />
          )}
          {tab === "sites" && (
            <SitesTab settings={settings} patch={patch} flash={flash} />
          )}
          {tab === "about" && <AboutTab />}
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------

function Header(): JSX.Element {
  return (
    <header className="border-b border-zinc-800 bg-zinc-900/40">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-900/30"
        >
          <BrandIcon />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">
            Inkwell
          </div>
          <div className="text-[12px] text-zinc-400">
            Settings — stored only on this device
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 sm:inline-flex">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Local-only
          </span>
        </div>
      </div>
    </header>
  );
}

function Tabs({
  current,
  onChange,
}: {
  current: Tab;
  onChange: (t: Tab) => void;
}): JSX.Element {
  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "languages", label: "Languages" },
    { id: "history", label: "History" },
    { id: "backend", label: "Backend" },
    { id: "sites", label: "Sites" },
    { id: "about", label: "About" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex flex-wrap items-center gap-1 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1 shadow-inner shadow-black/20"
    >
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-[12.5px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              active
                ? "bg-gradient-to-b from-indigo-500/25 to-indigo-500/10 text-indigo-100 shadow-sm shadow-indigo-900/40 ring-1 ring-inset ring-indigo-400/30"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-zinc-700/80">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold leading-tight tracking-tight text-zinc-50">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
            {description}
          </p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// General tab — profile + defaults, all stored in chrome.storage.local
// -----------------------------------------------------------------------------

function GeneralTab({
  settings,
  patch,
  flash,
}: {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}): JSX.Element {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [aboutMe, setAboutMe] = useState(settings.aboutMe);

  const dirty =
    displayName !== settings.displayName || aboutMe !== settings.aboutMe;

  const saveProfile = async (): Promise<void> => {
    await localStore.setProfile(displayName, aboutMe);
    patch({ displayName, aboutMe });
    flash("Profile saved");
  };

  const changeTone = async (tone: TonePreset): Promise<void> => {
    await localStore.setDefaultTone(tone);
    patch({ defaultTone: tone });
    flash("Default tone saved");
  };

  const changeModel = async (model: ModelId): Promise<void> => {
    await localStore.setDefaultModel(model);
    patch({ defaultModel: model });
    flash("Default model saved");
  };

  return (
    <>
      <Card
        title="Profile"
        description="Optional. Attached to each request to personalize replies — stored only on this device, never on a server."
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Display name
            </span>
            <input
              type="text"
              value={displayName}
              maxLength={120}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              About me
            </span>
            <textarea
              value={aboutMe}
              maxLength={2000}
              rows={3}
              onChange={(e) => setAboutMe(e.target.value)}
              placeholder="e.g. I'm a product manager. I prefer concise, friendly replies."
              className="mt-1 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
            />
            <span className="text-[11px] text-zinc-400">
              {aboutMe.length}/2000
            </span>
          </label>
          <button
            type="button"
            onClick={saveProfile}
            disabled={!dirty}
            className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save profile
          </button>
        </div>
      </Card>

      <Card
        title="Default tone"
        description="Preselected when the popover opens. You can still change it per request."
      >
        <div className="flex flex-wrap gap-2">
          {TONE_PRESETS.map((t) => {
            const active = t === settings.defaultTone;
            return (
              <button
                key={t}
                type="button"
                onClick={() => void changeTone(t)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                  active
                    ? "border-indigo-500 bg-indigo-500 text-white shadow-sm dark:border-indigo-400 dark:bg-indigo-500"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                }`}
              >
                {TONE_PRESET_LABELS[t]}
              </button>
            );
          })}
        </div>
      </Card>

      <Card
        title="Default model"
        description="Used unless you pick a different model in the popover for a specific request."
      >
        <div className="space-y-2">
          {MODEL_CATALOG.map((m) => {
            const active = m.id === settings.defaultModel;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void changeModel(m.id)}
                aria-pressed={active}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    active
                      ? "border-indigo-500 bg-indigo-500 dark:border-indigo-400 dark:bg-indigo-400"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  aria-hidden="true"
                >
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {m.tier}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                    {m.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card
        title="Keyboard"
        description="Open the popover on whatever text field you're focused on."
      >
        <div className="flex items-center gap-3 text-sm">
          <kbd className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {KBD_SHORTCUT}
          </kbd>
          <span className="text-zinc-600 dark:text-zinc-400">
            Open the popover on a focused text field
          </span>
        </div>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Change it at{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            chrome://extensions/shortcuts
          </code>{" "}
          (paste in your address bar — Chrome blocks links to chrome:// pages).
        </p>
      </Card>
    </>
  );
}

// -----------------------------------------------------------------------------
// Backend tab — point the extension at any compatible API
// -----------------------------------------------------------------------------

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "error"; detail: string };

function BackendTab({
  settings,
  patch,
  flash,
}: {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}): JSX.Element {
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
              <span>
                {test.kind === "testing"
                  ? "Testing connection…"
                  : test.detail}
              </span>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          The currently active backend is{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            {settings.backendUrl}
          </code>
          {isDefault && " (default)"}. Saving a new URL asks Chrome for
          permission to reach that host.
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
          Your backend must also allow this extension&apos;s origin via CORS.
          The full request/response contract is in the project docs
          (docs/how-to/use-your-own-backend.md).
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

function SitesTab({
  settings,
  patch,
  flash,
}: {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}): JSX.Element {
  const updateAllow = async (next: string[]): Promise<void> => {
    await localStore.setAllowlist(next);
    patch({ siteAllowlist: next });
    flash("Allowlist saved");
  };
  const updateBlock = async (next: string[]): Promise<void> => {
    await localStore.setBlocklist(next);
    patch({ siteBlocklist: next });
    flash("Blocklist saved");
  };

  return (
    <>
      <HostListCard
        title="Allowlist"
        description="Hosts where the popover is always allowed (overrides default block)."
        list={settings.siteAllowlist}
        onChange={updateAllow}
        addPlaceholder="e.g. mail.google.com"
      />
      <HostListCard
        title="Blocklist"
        description="Hosts where the popover never appears, in addition to the defaults."
        list={settings.siteBlocklist}
        onChange={updateBlock}
        addPlaceholder="e.g. internal.company.com"
      />
      <Card
        title="Default blocklist"
        description={`These ${DEFAULT_BLOCKED_HOSTS.length} hosts are blocked out of the box. Add to the allowlist above to override.`}
      >
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {DEFAULT_BLOCKED_HOSTS.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function HostListCard({
  title,
  description,
  list,
  onChange,
  addPlaceholder,
}: {
  title: string;
  description: string;
  list: string[];
  onChange: (next: string[]) => void | Promise<void>;
  addPlaceholder: string;
}): JSX.Element {
  const [entry, setEntry] = useState("");

  const add = (): void => {
    const v = entry.trim().toLowerCase();
    if (!v || list.includes(v)) return;
    void onChange([...list, v]);
    setEntry("");
  };

  return (
    <Card title={title} description={description}>
      <div className="flex gap-2">
        <input
          type="text"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={addPlaceholder}
          className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Add
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        Use a bare hostname like{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
          linkedin.com
        </code>{" "}
        — subdomains are matched automatically.
      </p>
      {list.length === 0 ? (
        <p className="mt-3 text-sm italic text-zinc-400 dark:text-zinc-500">
          No entries yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {list.map((h) => (
            <li
              key={h}
              className="flex items-center justify-between rounded-md border border-zinc-100 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="font-mono text-xs">{h}</span>
              <button
                type="button"
                onClick={() => void onChange(list.filter((x) => x !== h))}
                aria-label={`Remove ${h}`}
                className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Languages tab — agent language preferences
// -----------------------------------------------------------------------------

function LanguagesTab({
  settings,
  patch,
  flash,
}: {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}): JSX.Element {
  const changeWorking = async (lang: LanguageId): Promise<void> => {
    await localStore.setWorkingLanguage(lang);
    patch({ workingLanguage: lang });
    flash("Working language saved");
  };

  const toggleFrequent = async (lang: LanguageId): Promise<void> => {
    const has = settings.frequentLanguages.includes(lang);
    const next = has
      ? settings.frequentLanguages.filter((l) => l !== lang)
      : [...settings.frequentLanguages, lang];
    await localStore.setFrequentLanguages(next);
    patch({ frequentLanguages: next });
    flash("Frequent languages saved");
  };

  return (
    <>
      <Card
        title="Working language"
        description="Your preferred language for drafting. It is the default target when you translate, and the second language used in a bilingual reply."
      >
        <select
          value={settings.workingLanguage}
          onChange={(e) => void changeWorking(e.target.value as LanguageId)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 sm:w-72"
        >
          {LANGUAGE_CATALOG.map((l) => (
            <option key={l.id} value={l.id}>
              {languageDisplayName(l.id)}
            </option>
          ))}
        </select>
      </Card>

      <Card
        title="Frequent languages"
        description="Languages you handle often. These are surfaced at the top of the language pickers in the popover, so common targets are one click away."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LANGUAGE_CATALOG.map((l) => {
            const checked = settings.frequentLanguages.includes(l.id);
            return (
              <label
                key={l.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition ${
                  checked
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => void toggleFrequent(l.id)}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                <span className="min-w-0 truncate">
                  {languageDisplayName(l.id)}
                </span>
              </label>
            );
          })}
        </div>
        {settings.frequentLanguages.length === 0 && (
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            None selected — the pickers show every language in catalog order.
          </p>
        )}
      </Card>
    </>
  );
}

// -----------------------------------------------------------------------------
// History tab — searchable translation & action log
// -----------------------------------------------------------------------------

function HistoryTab(): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<Action | "all">("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");

  useEffect(() => {
    void historyStore.list().then(setEntries);
  }, []);

  // Filter dropdown options, derived from whatever is actually in the log.
  const sites = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.site))].sort(),
    [entries],
  );
  const languages = useMemo(() => {
    const set = new Set<LanguageId>();
    for (const e of entries ?? []) {
      if (e.sourceLanguage !== "auto") set.add(e.sourceLanguage);
      if (e.targetLanguage) set.add(e.targetLanguage);
    }
    return LANGUAGE_CATALOG.map((l) => l.id).filter((id) => set.has(id));
  }, [entries]);

  // If the user filtered by a value (site / language) that has since been
  // deleted, reset that filter rather than leaving them staring at a
  // phantom selection with zero matches.
  useEffect(() => {
    if (siteFilter !== "all" && !sites.includes(siteFilter)) {
      setSiteFilter("all");
    }
  }, [siteFilter, sites]);
  useEffect(() => {
    if (
      languageFilter !== "all" &&
      !(languages as string[]).includes(languageFilter)
    ) {
      setLanguageFilter("all");
    }
  }, [languageFilter, languages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (siteFilter !== "all" && e.site !== siteFilter) return false;
      if (
        languageFilter !== "all" &&
        e.sourceLanguage !== languageFilter &&
        e.targetLanguage !== languageFilter
      ) {
        return false;
      }
      if (
        q &&
        !e.inputText.toLowerCase().includes(q) &&
        !e.outputText.toLowerCase().includes(q) &&
        !e.pageTitle.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, query, actionFilter, languageFilter, siteFilter]);

  const remove = async (id: string): Promise<void> => {
    await historyStore.remove(id);
    setEntries((cur) => (cur ? cur.filter((e) => e.id !== id) : cur));
  };

  const clearAll = async (): Promise<void> => {
    if (
      !window.confirm("Delete the entire history? This cannot be undone.")
    ) {
      return;
    }
    await historyStore.clear();
    setEntries([]);
  };

  if (!entries) {
    return (
      <Card title="History">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Translation & action history"
        description="Every completed translation and AI-assisted draft on this device. Stored only in your browser — never sent to a server."
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text or page title…"
            className="min-w-[180px] flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as Action | "all")}
            aria-label="Filter by action"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            aria-label="Filter by language"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">All languages</option>
            {languages.map((id) => (
              <option key={id} value={id}>
                {languageLabel(id)}
              </option>
            ))}
          </select>
          {sites.length > 1 && (
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              aria-label="Filter by conversation"
              className="max-w-[180px] rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="all">All conversations</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {filtered.length} of {entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"}
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              className="text-xs text-zinc-500 underline hover:text-red-600 dark:hover:text-red-400"
            >
              Clear all history
            </button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm italic text-zinc-400 dark:text-zinc-500">
            {entries.length === 0
              ? "No history yet. Completed translations and drafts will appear here."
              : "No entries match the current filters."}
          </p>
        </section>
      ) : (
        filtered.map((e) => (
          <HistoryCard key={e.id} entry={e} onDelete={() => void remove(e.id)} />
        ))
      )}
    </>
  );
}

function HistoryCard({
  entry,
  onDelete,
}: {
  entry: HistoryEntry;
  onDelete: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const source =
    entry.sourceLanguage === "auto"
      ? "Auto"
      : languageLabel(entry.sourceLanguage);
  const target = entry.bilingual
    ? `${source} + ${entry.targetLanguage ? languageLabel(entry.targetLanguage) : "—"}`
    : entry.targetLanguage
      ? languageLabel(entry.targetLanguage)
      : source;

  const copyOutput = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.outputText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the text stays selectable on the card.
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
          {ACTION_LABELS[entry.action]}
        </span>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {source} → {target}
        </span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void copyOutput()}
          className="text-xs text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {copied ? "Copied" : "Copy output"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete entry"
          className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
        >
          Delete
        </button>
      </header>
      <p className="mt-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
        {entry.site}
        {entry.pageTitle ? ` · ${entry.pageTitle}` : ""}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Input
          </div>
          <p
            dir="auto"
            className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {entry.inputText || "—"}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Output
          </div>
          <p
            dir="auto"
            className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {entry.outputText || "—"}
          </p>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// About tab
// -----------------------------------------------------------------------------

function AboutTab(): JSX.Element {
  return (
    <>
      <Card title="What this is">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Inkwell translates customer queries, drafts replies, fixes grammar,
          and rewrites text on any text field on the web — across many
          languages, with a preview-before-insert flow so nothing is ever
          auto-sent.
        </p>
      </Card>
      <Card title="No account, no tracking">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Inkwell works without sign-in. Every setting on this page is stored
          only in your browser (chrome.storage.local) and never leaves your
          device, except the optional profile attached to a request to
          personalize a reply. Prompt content is never logged.
        </p>
      </Card>
      <Card title="Version">
        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          1.1.0
        </p>
      </Card>
      <Card
        title="Reset"
        description="Clear every Inkwell setting and the translation history on this device, restoring defaults. This cannot be undone."
      >
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "Reset all Inkwell settings and clear history? This cannot be undone.",
              )
            ) {
              return;
            }
            void localStore.clearAll().then(() => window.location.reload());
          }}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-500 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Reset all settings
        </button>
      </Card>
    </>
  );
}

function Toast({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center"
      role="status"
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-[12px] font-medium text-zinc-900 shadow-lg shadow-black/40">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-emerald-600"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {message}
      </div>
    </div>
  );
}

// The Inkwell brand mark — a filled ink drop. Matches icons/logo.svg.
function BrandIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z" />
    </svg>
  );
}
