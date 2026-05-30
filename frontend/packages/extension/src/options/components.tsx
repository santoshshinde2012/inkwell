// Shared layout bits + cross-tab constants for the options page.
//
// Extracted from App.tsx so that file stays small and focused on
// composition. None of the components below own state — they're pure
// render functions keyed to the tabs under ./tabs/.

import type { JSX } from "react";
import type { Action, LocalSettings } from "@inkwell/shared";

export type Tab = "general" | "languages" | "history" | "backend" | "sites" | "about";

/** Props every tab body receives.
 *
 * Declared here so the shape is single-sourced — both ``App.tsx`` (the
 * caller) and the tabs under ``./tabs/`` import it from this file.
 */
export interface TabProps {
  settings: LocalSettings;
  patch: (next: Partial<LocalSettings>) => void;
  flash: (msg: string) => void;
}

/** Human-readable label per action, used in the General + Sites tabs. */
export const ACTION_LABELS: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
  summarize: "Summarize",
  explain: "Explain",
};

export const KBD_SHORTCUT = navigator.platform.includes("Mac") ? "⌘⇧K" : "Ctrl+Shift+K";

export function Header(): JSX.Element {
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
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">Inkwell</div>
          <div className="text-[12px] text-zinc-400">Settings — stored only on this device</div>
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

export function Tabs({
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

export function Card({
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
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{description}</p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// General tab — profile + defaults, all stored in chrome.storage.local
// -----------------------------------------------------------------------------

export function Toast({ message }: { message: string }): JSX.Element {
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

function BrandIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z" />
    </svg>
  );
}
