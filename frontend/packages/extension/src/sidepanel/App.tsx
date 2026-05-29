// Side Panel App — the persistent assistant.
//
// Mobile-app shell with a hamburger-triggered overlay drawer:
//   • Each view (Assistant / History / Settings) renders its own top bar
//     with a hamburger button on the left
//   • Tapping the hamburger slides the Drawer in from the left as an
//     overlay over the active view
//   • The Drawer holds the profile card, primary nav, a gradient CTA, and
//     branding (see Drawer.tsx)
//
// Views stay mounted but only the active one is visible — so typed text
// and scroll positions survive a hop to another view.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AssistantView } from "./assistant";
import { Drawer } from "./Drawer";
import { ToastProvider } from "./Toast";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { localStore } from "../lib/storage";
import { probeBackend, type BackendStatus } from "../lib/backend";
import { loadLastView, saveLastView, type SidePanelView } from "../lib/ui-state";
import { historyStore, STORAGE_KEY as HISTORY_STORAGE_KEY } from "../lib/history";
import { useStorageChange } from "../lib/useStorageChange";

const DISPLAY_NAME_KEY = "settings.displayName";

// Minimum interval between backend health probes triggered by panel
// visibility changes. The cold-start probe runs unconditionally; this
// only gates the re-probe on `visibilitychange`. 30 s is long enough
// that a flickering tab-switcher doesn't poke the service worker, and
// short enough that a backend that came up while the panel was away
// still flips to "ok" the moment the user looks at it again.
const PROBE_MIN_INTERVAL_MS = 30_000;

// Code-split the non-default views so they don't ship in the panel's
// first-paint bundle. Both export their view as a named symbol; the
// `.then` shape adapts them for React.lazy's default-only contract.
const HistoryView = lazy(() =>
  import("./history").then((m) => ({ default: m.HistoryView })),
);
const SettingsView = lazy(() =>
  import("./settings").then((m) => ({ default: m.SettingsView })),
);

export function App(): JSX.Element {
  const [view, setView] = useState<SidePanelView>("assistant");
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendUrl, setBackendUrl] = useState<string>("");

  const [displayName, setDisplayName] = useState<string>("");
  const [historyCount, setHistoryCount] = useState<number>(0);

  // Single hydration pass — every piece the App shell needs at startup
  // (last view, history count, settings snapshot, backend probe) runs
  // in parallel rather than as four independent effects. Saves ~30–
  // 50 ms off the first paint at the cost of one extra dependency in
  // the effect body. The probe re-runs when the panel regains
  // visibility, but throttled so a frequent tab-switcher doesn't poke
  // the backend (and wake the service worker) every few seconds.
  const lastProbeAtRef = useRef(0);
  useEffect(() => {
    let cancelled = false;

    const probe = async (markChecking: boolean): Promise<void> => {
      if (markChecking) setBackendStatus("checking");
      const s = await localStore.getAll().catch(() => null);
      if (cancelled) return;
      if (s) setDisplayName(s.displayName);
      const r = await probeBackend(s?.backendUrl, s?.apiKey);
      if (cancelled) return;
      setBackendStatus(r.status);
      setBackendUrl(r.url);
      lastProbeAtRef.current = Date.now();
    };

    const hydrate = async (): Promise<void> => {
      const [v, items] = await Promise.all([
        loadLastView(),
        historyStore.list(),
        probe(false),
      ]);
      if (cancelled) return;
      setView(v);
      setHistoryCount(items.length);
      setHydrated(true);
    };

    void hydrate();

    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") return;
      // Throttle: a user flicking between tabs or windows shouldn't
      // re-probe more than once per PROBE_MIN_INTERVAL_MS. The cold-
      // start probe above resets the clock; this one only fires when
      // the panel has been away long enough that a backend status
      // change is plausible.
      if (Date.now() - lastProbeAtRef.current < PROBE_MIN_INTERVAL_MS) return;
      void probe(true);
    };
    // Re-probe immediately when network connectivity returns —
    // bypasses the visibility throttle because a transition from
    // offline → online is the single most common reason the cached
    // "Backend offline" status is wrong. The user shouldn't have to
    // re-focus the panel to see the dot flip back to green.
    const onOnline = (): void => {
      void probe(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Persist view after hydration.
  useEffect(() => {
    if (!hydrated) return;
    saveLastView(view);
  }, [hydrated, view]);

  // Stay in sync with profile edits the user makes in Settings, so
  // we don't have to lift the form's state up out of the Settings view.
  useStorageChange([DISPLAY_NAME_KEY], (changes) => {
    const v = changes[DISPLAY_NAME_KEY]?.newValue;
    if (typeof v === "string") setDisplayName(v);
  });

  // Live history count for the drawer badge + profile chip — the
  // initial value is set in the hydration pass above; this listener
  // keeps it fresh when entries are added or removed elsewhere.
  useStorageChange([HISTORY_STORAGE_KEY], () => {
    void historyStore.list().then((all) => setHistoryCount(all.length));
  });

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((p) => !p), []);

  // Cmd/Ctrl+B toggles the drawer — works regardless of which view is
  // active so power users always have a one-shortcut entry point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDrawer]);

  const openOptionsPage = (): void => {
    void chrome.runtime.openOptionsPage();
  };

  return (
    <ToastProvider>
      <div className="relative flex h-full flex-col bg-zinc-950 text-zinc-100 antialiased">
        {/* Per-view ErrorBoundary so a render crash in one pane
            doesn't blank the whole panel — the other views stay
            usable while the user clicks "Try again" on the broken
            one. The root ErrorBoundary in main.tsx still catches
            anything outside the Panes (Drawer, ToastProvider, …).
            Each ErrorBoundary wraps the Suspense so a lazy-import
            failure also surfaces as the in-pane fallback rather
            than crashing the panel. */}
        <Pane active={view === "assistant"} viewKey="assistant">
          <ErrorBoundary>
            <AssistantView
              backendStatus={backendStatus}
              backendUrl={backendUrl}
              onOpenDrawer={openDrawer}
              onOpenHistory={() => setView("history")}
              onOpenSettings={() => setView("settings")}
            />
          </ErrorBoundary>
        </Pane>
        <Pane active={view === "history"} viewKey="history">
          <ErrorBoundary>
            <Suspense fallback={<PaneFallback />}>
              <HistoryView
                onOpenDrawer={openDrawer}
                onJumpToAssistant={() => setView("assistant")}
              />
            </Suspense>
          </ErrorBoundary>
        </Pane>
        <Pane active={view === "settings"} viewKey="settings">
          <ErrorBoundary>
            <Suspense fallback={<PaneFallback />}>
              <SettingsView onOpenDrawer={openDrawer} />
            </Suspense>
          </ErrorBoundary>
        </Pane>

        <Drawer
          open={drawerOpen}
          current={view}
          backendStatus={backendStatus}
          displayName={displayName}
          historyCount={historyCount}
          onClose={closeDrawer}
          onChange={setView}
          onOpenFullSettings={openOptionsPage}
        />
      </div>
    </ToastProvider>
  );
}

function Pane({
  active,
  viewKey,
  children,
}: {
  active: boolean;
  viewKey: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      key={viewKey}
      data-active={active ? "true" : "false"}
      className={`h-full min-h-0 ${
        active ? "flex flex-1 flex-col motion-safe:animate-[pane-in_180ms_ease-out]" : "hidden"
      }`}
    >
      <style>{PANE_KEYFRAMES}</style>
      {children}
    </div>
  );
}

const PANE_KEYFRAMES = `
@keyframes pane-in {
  from { opacity: 0.4; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

/** Minimal placeholder shown while a lazily-loaded view chunk is in
 *  flight. Matches the panel background so there's no visible flash —
 *  the chunk lands within a few frames on a warm tab. */
function PaneFallback(): JSX.Element {
  return <div className="flex h-full flex-1 bg-zinc-950" aria-hidden="true" />;
}
