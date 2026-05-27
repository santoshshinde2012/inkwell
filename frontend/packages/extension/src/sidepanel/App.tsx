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

import { useCallback, useEffect, useState } from "react";
import { AssistantView } from "./assistant";
import { HistoryView } from "./history";
import { SettingsView } from "./settings";
import { Drawer } from "./Drawer";
import { localStore } from "../lib/storage";
import { probeBackend, type BackendStatus } from "../lib/backend";
import { loadLastView, saveLastView, type SidePanelView } from "../lib/ui-state";
import { historyStore, STORAGE_KEY as HISTORY_STORAGE_KEY } from "../lib/history";
import { useStorageChange } from "../lib/useStorageChange";

const DISPLAY_NAME_KEY = "settings.displayName";

export function App(): JSX.Element {
  const [view, setView] = useState<SidePanelView>("assistant");
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [backendUrl, setBackendUrl] = useState<string>("");

  const [displayName, setDisplayName] = useState<string>("");
  const [historyCount, setHistoryCount] = useState<number>(0);

  // Backend health probe — drives the drawer profile status row + the
  // Assistant top-bar subtitle. Runs once on mount and again each time
  // the panel regains visibility (e.g. user comes back from a different
  // window) so a backend that went down while the panel was idle gets
  // re-evaluated promptly.
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
    };

    void probe(false);

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void probe(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Restore last-viewed tab.
  useEffect(() => {
    let cancelled = false;
    void loadLastView().then((v) => {
      if (cancelled) return;
      setView(v);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
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

  // Live history count for the drawer badge + profile chip.
  useEffect(() => {
    void historyStore.list().then((all) => setHistoryCount(all.length));
  }, []);
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
    <div className="relative flex h-full flex-col bg-zinc-950 text-zinc-100 antialiased">
      <Pane active={view === "assistant"} viewKey="assistant">
        <AssistantView
          backendStatus={backendStatus}
          backendUrl={backendUrl}
          onOpenDrawer={openDrawer}
          onOpenHistory={() => setView("history")}
          onOpenSettings={() => setView("settings")}
        />
      </Pane>
      <Pane active={view === "history"} viewKey="history">
        <HistoryView onOpenDrawer={openDrawer} onJumpToAssistant={() => setView("assistant")} />
      </Pane>
      <Pane active={view === "settings"} viewKey="settings">
        <SettingsView onOpenDrawer={openDrawer} />
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
