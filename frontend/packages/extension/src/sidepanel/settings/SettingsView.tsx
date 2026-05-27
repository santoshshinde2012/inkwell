// Settings view — essential preferences inside the Side Panel, so the
// user doesn't have to jump out to the options page for everyday config.
//
// Layout (top → bottom):
//   1. Slim TopBar with gear mark + "Local" pill
//   2. Scrollable stack of Sections — Profile / Tone / Model / Languages
//      / Advanced
//   3. Save Toast pinned to the bottom of the panel
//
// Each Section is a self-contained module under ./{Name}Section. The
// shared Section primitive, FieldLabel, Toast, and Patch/Flash types
// live in ./Section. The shell here owns only the loaded settings
// snapshot and the toast timer; section components mutate via the
// `patch` callback and call `flash` to confirm.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { LocalSettings } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { AdvancedSection } from "./AdvancedSection";
import { LanguagesSection } from "./LanguagesSection";
import { ModelSection } from "./ModelSection";
import { ProfileCard } from "./ProfileCard";
import { SettingsTopBar } from "./TopBar";
import { SkeletonStack, Toast } from "./Section";
import { ToneSection } from "./ToneSection";

const TOAST_MS = 1600;

export function SettingsView({ onOpenDrawer }: { onOpenDrawer: () => void }): JSX.Element {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void localStore.getAll().then(setSettings);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const flash = (msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => (t === msg ? null : t));
      toastTimerRef.current = null;
    }, TOAST_MS);
  };

  const patch = (next: Partial<LocalSettings>): void => {
    setSettings((s) => (s ? { ...s, ...next } : s));
  };

  if (!settings) {
    return (
      <div className="flex h-full flex-col">
        <SettingsTopBar onOpenDrawer={onOpenDrawer} />
        <div className="flex-1 px-3 py-4">
          <SkeletonStack />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <SettingsTopBar onOpenDrawer={onOpenDrawer} />
      <main className="flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-3">
        <ProfileCard settings={settings} patch={patch} flash={flash} />
        <ToneSection settings={settings} patch={patch} flash={flash} />
        <ModelSection settings={settings} patch={patch} flash={flash} />
        <LanguagesSection settings={settings} patch={patch} flash={flash} />
        <AdvancedSection />
      </main>
      {toast && <Toast message={toast} />}
    </div>
  );
}
