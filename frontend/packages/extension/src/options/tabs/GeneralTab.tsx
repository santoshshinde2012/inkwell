// GeneralTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { useState, type JSX } from "react";
import {
  MODEL_CATALOG,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  type ModelId,
  type TonePreset,
} from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { Card, KBD_SHORTCUT, type TabProps } from "../components";

export function GeneralTab({ settings, patch, flash }: TabProps): JSX.Element {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [aboutMe, setAboutMe] = useState(settings.aboutMe);

  const dirty = displayName !== settings.displayName || aboutMe !== settings.aboutMe;

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
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">About me</span>
            <textarea
              value={aboutMe}
              maxLength={2000}
              rows={3}
              onChange={(e) => setAboutMe(e.target.value)}
              placeholder="e.g. I'm a product manager. I prefer concise, friendly replies."
              className="mt-1 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder-zinc-500"
            />
            <span className="text-[11px] text-zinc-400">{aboutMe.length}/2000</span>
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
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
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
