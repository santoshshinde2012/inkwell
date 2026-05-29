// Settings view — essential preferences inside the Side Panel, so the
// user doesn't have to jump out to the options page for everyday config.
//
// Layout (top → bottom):
//   1. Slim TopBar with gear mark + "Local" pill
//   2. Scrollable stack of Sections — Profile / Tone / Model / Languages
//      / Advanced
//
// Each Section is a self-contained module under ./{Name}Section. The
// shared Section primitive, FieldLabel, and Patch/Flash types live in
// ./Section. The shell here owns only the loaded settings snapshot;
// section components mutate via the `patch` callback and call `flash`
// to confirm via the panel-wide ToastProvider (mounted in App.tsx).

import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { LocalSettings } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { useToast } from "../Toast";
import { AdvancedSection } from "./AdvancedSection";
import { LanguagesSection } from "./LanguagesSection";
import { ModelSection } from "./ModelSection";
import { ProfileCard } from "./ProfileCard";
import { SettingsTopBar } from "./TopBar";
import { SkeletonStack } from "./Section";
import { ToneSection } from "./ToneSection";

export function SettingsView({ onOpenDrawer }: { onOpenDrawer: () => void }): JSX.Element {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const toast = useToast();

  useEffect(() => {
    void localStore.getAll().then(setSettings);
  }, []);

  // `flash` is the Section components' confirmation channel. Routing
  // it through the global toast keeps them ignorant of how the message
  // is shown (no local toast component, no per-view timer).
  const flash = (msg: string): void => {
    toast.success(msg);
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
    </div>
  );
}
