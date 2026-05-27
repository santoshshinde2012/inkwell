// Options page — the full settings surface. Lives at chrome://extensions
// → details → Options for the extension.
//
// This file is intentionally small: it owns the loaded-settings state,
// the active-tab state, and a tiny toast. Each tab body lives in
// ./tabs/<Name>Tab.tsx; layout pieces (Header / Tabs / Card / Toast)
// and the shared TabProps shape live in ./components.tsx.

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { LocalSettings } from "@inkwell/shared";
import { localStore } from "../lib/storage";
import { Header, Tabs, type Tab, Toast } from "./components";
import { AboutTab, BackendTab, GeneralTab, HistoryTab, LanguagesTab, SitesTab } from "./tabs";

const TOAST_MS = 1800;

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void localStore.getAll().then(setSettings);
  }, []);

  // Toast timer kept in a ref so back-to-back flashes don't pile up
  // overlapping timers, and so unmount can clear the pending one
  // before React would otherwise warn about updating an unmounted
  // component.
  const toastTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const flash = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }, []);

  // Stable so a memoised tab body wouldn't re-render unnecessarily.
  const patch = useCallback((next: Partial<LocalSettings>): void => {
    setSettings((s) => (s ? { ...s, ...next } : s));
  }, []);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-zinc-800/70 bg-zinc-950/90 px-6 py-3 backdrop-blur">
          <Tabs current={tab} onChange={setTab} />
        </div>

        <div className="space-y-4">
          {tab === "general" && <GeneralTab settings={settings} patch={patch} flash={flash} />}
          {tab === "languages" && <LanguagesTab settings={settings} patch={patch} flash={flash} />}
          {tab === "history" && <HistoryTab />}
          {tab === "backend" && <BackendTab settings={settings} patch={patch} flash={flash} />}
          {tab === "sites" && <SitesTab settings={settings} patch={patch} flash={flash} />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
