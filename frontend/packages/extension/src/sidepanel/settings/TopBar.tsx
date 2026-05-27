// Top bar above the Settings view. Mirrors the Assistant + History
// slim layout: hamburger · gear icon + "Settings" + "Local-only" pill.
//
// The "local-only" caveat now lives in this pill (compact, hover-tip
// for the full sentence) instead of the previous two-line subtitle.

import type { JSX } from "react";
import { GearIcon, MenuIcon } from "../icons";

export interface SettingsTopBarProps {
  onOpenDrawer: () => void;
}

export function SettingsTopBar({ onOpenDrawer }: SettingsTopBarProps): JSX.Element {
  return (
    <header className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-2.5 backdrop-blur">
      <button
        type="button"
        onClick={onOpenDrawer}
        title="Menu (⌘B)"
        aria-label="Open menu"
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
      >
        <MenuIcon size={17} />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-zinc-800"
        >
          <GearIcon size={12} />
        </span>
        <span className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          Settings
        </span>
        <span
          title="Stored only on this device — never sent to a server."
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/25"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Local
        </span>
      </div>

      {/* Right-side spacer for symmetry with the hamburger. */}
      <span aria-hidden="true" className="inline-block h-9 w-9 flex-shrink-0" />
    </header>
  );
}
