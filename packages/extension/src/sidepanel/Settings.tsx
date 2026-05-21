// Settings view — surfaces the essential config inside the Side Panel so
// the user doesn't have to jump out to the options page for everyday
// preferences. Profile, default tone, default model, working language and
// frequent languages all save on change with a toast. For advanced
// settings (custom backend URL, per-site allow/block, full history) the
// view links out to the full options page.
//
// Visually styled as a mobile-app settings screen: a profile header card
// followed by a vertical stack of section cards with chip / radio /
// checkbox controls inside.

import { useEffect, useRef, useState } from "react";
import {
  LANGUAGE_CATALOG,
  MODEL_CATALOG,
  ModelId,
  TONE_PRESETS,
  TONE_PRESET_LABELS,
  TonePreset,
  languageDisplayName,
  type LanguageId,
  type LocalSettings,
} from "@inkwell/shared";
import { localStore } from "../lib/storage";
import { CheckIcon, ExternalLinkIcon, MenuIcon } from "./icons";

export function SettingsView({
  onOpenDrawer,
}: {
  onOpenDrawer: () => void;
}): JSX.Element {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void localStore.getAll().then(setSettings);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const flash = (msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => (t === msg ? null : t));
      toastTimerRef.current = null;
    }, 1600);
  };

  const patch = (next: Partial<LocalSettings>): void => {
    setSettings((s) => (s ? { ...s, ...next } : s));
  };

  if (!settings) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader onOpenDrawer={onOpenDrawer} />
        <div className="flex-1 px-3 py-4">
          <SkeletonStack />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <ViewHeader onOpenDrawer={onOpenDrawer} />
      <main className="flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-3">
        <ProfileCard settings={settings} patch={patch} flash={flash} />
        <ToneSection settings={settings} patch={patch} flash={flash} />
        <ModelSection settings={settings} patch={patch} flash={flash} />
        <LanguagesSection settings={settings} patch={patch} flash={flash} />
        <AdvancedSection />
        <FooterNote />
      </main>
      {toast && <Toast message={toast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ViewHeader({
  onOpenDrawer,
}: {
  onOpenDrawer: () => void;
}): JSX.Element {
  return (
    <header className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2.5">
      <button
        type="button"
        onClick={onOpenDrawer}
        title="Menu (⌘B)"
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <MenuIcon size={17} />
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          Settings
        </div>
        <div className="truncate text-[10.5px] text-zinc-500">
          Stored only on this device
        </div>
      </div>
      <span className="inline-block h-9 w-9" aria-hidden="true" />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section primitive — every settings group is a card with title + body
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-700/80">
      <header className="mb-2.5">
        <h3 className="text-[12.5px] font-semibold tracking-tight text-zinc-100">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {description}
          </p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

interface SectionProps {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Profile — avatar circle with initials, tap-to-edit
// ---------------------------------------------------------------------------

function ProfileCard({ settings, patch, flash }: SectionProps): JSX.Element {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [aboutMe, setAboutMe] = useState(settings.aboutMe);
  const dirty =
    displayName !== settings.displayName || aboutMe !== settings.aboutMe;

  const save = async (): Promise<void> => {
    await localStore.setProfile(displayName, aboutMe);
    patch({ displayName, aboutMe });
    flash("Profile saved");
  };

  const initial =
    (displayName || "I").trim().charAt(0).toUpperCase() || "I";

  return (
    <section className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-900/50 p-3">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-[15px] font-semibold text-white shadow-lg shadow-indigo-950/40">
          {initial}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-zinc-50">
            {displayName.trim() || "Add your name"}
          </div>
          <div className="text-[10.5px] text-zinc-500">
            Personalises replies — optional
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        <FieldLabel label="Display name">
          <input
            type="text"
            value={displayName}
            maxLength={120}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex Rivera"
            className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </FieldLabel>
        <FieldLabel label="About me">
          <textarea
            value={aboutMe}
            maxLength={2000}
            rows={3}
            onChange={(e) => setAboutMe(e.target.value)}
            placeholder="e.g. I'm a PM. I prefer concise, friendly replies."
            className="block w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
          <span className="mt-1 block text-right text-[10px] text-zinc-500">
            {aboutMe.length}/2000
          </span>
        </FieldLabel>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-semibold text-white shadow-md shadow-indigo-950/30 transition-colors hover:from-indigo-400 hover:to-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save profile
        </button>
      </div>
    </section>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Default tone — chip group
// ---------------------------------------------------------------------------

function ToneSection({ settings, patch, flash }: SectionProps): JSX.Element {
  const change = async (tone: TonePreset): Promise<void> => {
    if (tone === settings.defaultTone) return;
    await localStore.setDefaultTone(tone);
    patch({ defaultTone: tone });
    flash("Default tone saved");
  };
  return (
    <Section
      title="Default tone"
      description="Preselected when the assistant opens — change per-request any time."
    >
      <div className="flex flex-wrap gap-1.5">
        {TONE_PRESETS.map((t) => {
          const active = t === settings.defaultTone;
          return (
            <button
              key={t}
              type="button"
              onClick={() => void change(t)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                active
                  ? "border-indigo-500 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                  : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
              }`}
            >
              {TONE_PRESET_LABELS[t]}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Default model — radio rows with description + tier badge
// ---------------------------------------------------------------------------

function ModelSection({ settings, patch, flash }: SectionProps): JSX.Element {
  const change = async (model: ModelId): Promise<void> => {
    if (model === settings.defaultModel) return;
    await localStore.setDefaultModel(model);
    patch({ defaultModel: model });
    flash("Default model saved");
  };
  return (
    <Section
      title="Default model"
      description="Used unless you pick a different one for a specific request."
    >
      <div className="space-y-1.5">
        {MODEL_CATALOG.map((m) => {
          const active = m.id === settings.defaultModel;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => void change(m.id)}
              aria-pressed={active}
              className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                active
                  ? "border-indigo-500 bg-indigo-950/40 shadow-sm shadow-indigo-950/40"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                  active
                    ? "border-indigo-400 bg-indigo-400"
                    : "border-zinc-600"
                }`}
              >
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-zinc-100">
                    {m.label}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-zinc-400">
                    {m.tier}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  {m.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Languages — working language dropdown + frequent multi-select
// ---------------------------------------------------------------------------

function LanguagesSection({
  settings,
  patch,
  flash,
}: SectionProps): JSX.Element {
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
  };

  return (
    <Section
      title="Languages"
      description="Pick the language you draft in, plus any you handle often."
    >
      <div className="space-y-3">
        <FieldLabel label="Working language">
          <select
            value={settings.workingLanguage}
            onChange={(e) => void changeWorking(e.target.value as LanguageId)}
            className="block w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-950 bg-no-repeat py-2 pl-3 pr-8 text-[12.5px] text-zinc-100 transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
              backgroundPosition: "right 10px center",
            }}
          >
            {LANGUAGE_CATALOG.map((l) => (
              <option key={l.id} value={l.id}>
                {languageDisplayName(l.id)}
              </option>
            ))}
          </select>
        </FieldLabel>

        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Frequent languages
          </span>
          <p className="mt-0.5 text-[10.5px] text-zinc-500">
            Pinned to the top of every language picker.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LANGUAGE_CATALOG.map((l) => {
              const checked = settings.frequentLanguages.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void toggleFrequent(l.id)}
                  aria-pressed={checked}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                    checked
                      ? "border-indigo-500 bg-indigo-500/15 text-indigo-200"
                      : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                  }`}
                >
                  {checked && <CheckIcon size={10} />}
                  <span className="truncate">{languageDisplayName(l.id)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Advanced — escape hatch to the full options page
// ---------------------------------------------------------------------------

function AdvancedSection(): JSX.Element {
  const openOptions = (): void => {
    void chrome.runtime.openOptionsPage();
  };
  return (
    <Section title="Advanced">
      <p className="text-[11.5px] leading-relaxed text-zinc-400">
        Custom backend, per-site allow/block, full history and the reset
        action live on the full settings page.
      </p>
      <button
        type="button"
        onClick={openOptions}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        Open full settings
        <ExternalLinkIcon size={12} />
      </button>
    </Section>
  );
}

function FooterNote(): JSX.Element {
  return (
    <p className="px-1 pt-1 text-center text-[10px] text-zinc-600">
      Inkwell — multilingual writing assistant
    </p>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function Toast({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3 z-50 flex justify-center"
      role="status"
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3.5 py-1.5 text-[11px] font-medium text-zinc-900 shadow-lg shadow-black/40">
        <span className="text-emerald-600">
          <CheckIcon size={12} />
        </span>
        {message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonStack(): JSX.Element {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40"
        />
      ))}
    </div>
  );
}
