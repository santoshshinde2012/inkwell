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

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  CheckIcon,
  CpuIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MenuIcon,
  PaletteIcon,
  SearchIcon,
  SlidersIcon,
  UserIcon,
  XIcon,
} from "./icons";

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

interface SectionAccent {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  /** Optional right-aligned slot next to the title (e.g. a count badge). */
  meta?: React.ReactNode;
}

function Section({
  title,
  description,
  accent,
  children,
}: {
  title: string;
  description?: string;
  accent?: SectionAccent;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-700/80">
      <header className="mb-2.5 flex items-start gap-2.5">
        {accent && (
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-white/5 ${accent.iconBg} ${accent.iconColor}`}
          >
            {accent.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold tracking-tight text-zinc-100">
              {title}
            </h3>
            {accent?.meta}
          </div>
          {description && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              {description}
            </p>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

// Per-section visual accents — kept consistent in tone (500/15 bg + 300
// icon) so the page reads as a single palette rather than a rainbow.
const ACCENTS = {
  tone: {
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-300",
  },
  model: {
    iconBg: "bg-cyan-500/15",
    iconColor: "text-cyan-300",
  },
  languages: {
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-300",
  },
  advanced: {
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-300",
  },
} as const;

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
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const dirty =
    displayName !== settings.displayName || aboutMe !== settings.aboutMe;

  const save = async (): Promise<void> => {
    await localStore.setProfile(displayName, aboutMe);
    patch({ displayName, aboutMe });
    setJustSaved(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setJustSaved(false);
      savedTimerRef.current = null;
    }, 1800);
    flash("Profile saved");
  };

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const initial =
    (displayName || "I").trim().charAt(0).toUpperCase() || "I";

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-indigo-950/20 via-zinc-900/60 to-zinc-900/40">
      <div className="flex items-center gap-3 border-b border-zinc-800/70 p-3">
        <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[17px] font-semibold text-white shadow-lg shadow-indigo-950/50">
          {initial}
          <span
            aria-hidden="true"
            className="absolute -inset-px rounded-2xl ring-1 ring-inset ring-white/15"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-white/5">
              <UserIcon size={12} />
            </span>
            <span className="text-[12.5px] font-semibold text-zinc-100">
              Profile
            </span>
            {justSaved && (
              <span
                role="status"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
              >
                <CheckIcon size={9} />
                Saved
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[14px] font-semibold text-zinc-50">
            {displayName.trim() || "Add your name"}
          </div>
          <div className="text-[10.5px] text-zinc-500">
            Personalises replies — optional
          </div>
        </div>
      </div>

      <div className="space-y-2.5 p-3">
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
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-semibold text-white shadow-md shadow-indigo-950/30 transition-transform hover:-translate-y-px hover:from-indigo-400 hover:to-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {dirty ? (
            "Save profile"
          ) : (
            <>
              <CheckIcon size={12} />
              Up to date
            </>
          )}
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
      accent={{
        icon: <PaletteIcon size={13} />,
        iconBg: ACCENTS.tone.iconBg,
        iconColor: ACCENTS.tone.iconColor,
      }}
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
      accent={{
        icon: <CpuIcon size={13} />,
        iconBg: ACCENTS.model.iconBg,
        iconColor: ACCENTS.model.iconColor,
      }}
    >
      <div className="space-y-1.5">
        {MODEL_CATALOG.map((m) => {
          const active = m.id === settings.defaultModel;
          const tierTone =
            m.tier?.toLowerCase() === "fast"
              ? "bg-amber-500/15 text-amber-200 ring-amber-500/30"
              : m.tier?.toLowerCase() === "quality"
                ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
                : "bg-zinc-800 text-zinc-300 ring-zinc-700/60";
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => void change(m.id)}
              aria-pressed={active}
              className={`group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                active
                  ? "border-indigo-500/70 bg-gradient-to-br from-indigo-950/50 to-zinc-900/60 shadow-sm shadow-indigo-950/40"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/60"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                  active
                    ? "bg-gradient-to-br from-indigo-400 to-violet-500 text-white shadow-md shadow-indigo-900/50"
                    : "bg-zinc-900 ring-1 ring-zinc-700 text-transparent group-hover:ring-zinc-600"
                }`}
              >
                <CheckIcon size={11} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-zinc-100">
                    {m.label}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ring-1 ring-inset ${tierTone}`}
                  >
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
  const [query, setQuery] = useState("");
  const selectedCount = settings.frequentLanguages.length;

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

  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGE_CATALOG;
    return LANGUAGE_CATALOG.filter((l) =>
      languageDisplayName(l.id).toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Section
      title="Languages"
      description="Pick the language you draft in, plus any you handle often."
      accent={{
        icon: <GlobeIcon size={13} />,
        iconBg: ACCENTS.languages.iconBg,
        iconColor: ACCENTS.languages.iconColor,
        meta:
          selectedCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              {selectedCount} pinned
            </span>
          ) : null,
      }}
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
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Frequent languages
            </span>
            <span className="text-[10px] text-zinc-500">
              Pinned to the top of every language picker
            </span>
          </div>

          <LanguageSearch value={query} onChange={setQuery} />

          {filteredLanguages.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-3 text-center text-[11px] text-zinc-500">
              No language matches “{query}”.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {filteredLanguages.map((l) => {
                const checked = settings.frequentLanguages.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => void toggleFrequent(l.id)}
                    aria-pressed={checked}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                      checked
                        ? "border-emerald-500/60 bg-emerald-500/12 text-emerald-200 shadow-sm shadow-emerald-950/40"
                        : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                    }`}
                  >
                    {checked && <CheckIcon size={10} />}
                    <span className="truncate">
                      {languageDisplayName(l.id)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function LanguageSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="relative block">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
      >
        <SearchIcon size={12} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter languages…"
        className="block w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-7 pr-7 text-[11.5px] text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <XIcon size={10} />
        </button>
      )}
    </label>
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
    <Section
      title="Advanced"
      accent={{
        icon: <SlidersIcon size={13} />,
        iconBg: ACCENTS.advanced.iconBg,
        iconColor: ACCENTS.advanced.iconColor,
      }}
    >
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
