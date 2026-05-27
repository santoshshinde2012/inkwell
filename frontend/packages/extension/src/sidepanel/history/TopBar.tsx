// Top bar above the History view. Mirrors the AssistantTopBar layout:
//   hamburger · "History" + count chip · clear-all action
//
// The previous version stacked title + "Stored only on this device —
// newest 250" subtitle, which burned vertical space we'd rather give to
// the list itself. The on-device caveat now lives in the empty-state
// copy and in the quota notice, surfaced only when relevant.

import type { JSX } from "react";
import { HistoryIcon, MenuIcon, TrashIcon } from "../icons";

export interface HistoryTopBarProps {
  count: number;
  onOpenDrawer: () => void;
  onClear: () => void;
}

export function HistoryTopBar({ count, onOpenDrawer, onClear }: HistoryTopBarProps): JSX.Element {
  const hasEntries = count > 0;
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
          <HistoryIcon size={12} />
        </span>
        <span className="truncate text-[14px] font-semibold tracking-tight text-zinc-50">
          History
        </span>
        {hasEntries && (
          <span
            aria-label={`${count} entries`}
            title={`${count} entries · newest 250 kept on this device`}
            className="inline-flex flex-shrink-0 items-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-400 ring-1 ring-inset ring-zinc-800"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </div>

      {hasEntries ? (
        <button
          type="button"
          onClick={onClear}
          title="Clear all history"
          aria-label="Clear all history"
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
        >
          <TrashIcon size={14} />
        </button>
      ) : (
        <span aria-hidden="true" className="inline-block h-9 w-9 flex-shrink-0" />
      )}
    </header>
  );
}
