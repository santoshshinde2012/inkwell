// Loading / empty / no-match states for the History view.
//
// All three share the same vertical-center layout; the icon and copy
// changes to fit context. Local-only caveat lives in the empty state
// since that's where it carries weight (a new user learning what's
// stored where).

import type { JSX } from "react";
import { ArrowRightIcon, HistoryIcon, SearchIcon } from "../icons";

export function LoadingState(): JSX.Element {
  return (
    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading history">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-20 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40"
        />
      ))}
    </ul>
  );
}

export function EmptyState({ onJump }: { onJump: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800"
      >
        <HistoryIcon size={24} />
      </span>
      <div>
        <div className="text-[14px] font-semibold text-zinc-100">No history yet</div>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[12px] leading-relaxed text-zinc-500">
          Every reply, translation, grammar fix, and rewrite you generate will appear here. The log
          lives on this device only — never sent to a server.
        </p>
      </div>
      <button
        type="button"
        onClick={onJump}
        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg shadow-indigo-950/40 transition-transform hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        Open the assistant
        <ArrowRightIcon size={13} />
      </button>
    </div>
  );
}

export function NoMatchState({
  query,
  filterLabel,
  onClear,
}: {
  query: string;
  /** When non-null, the user also has an action filter selected — the
   *  "clear" button resets both. */
  filterLabel: string | null;
  onClear: () => void;
}): JSX.Element {
  const subject = query
    ? `“${query}”`
    : filterLabel
      ? `filter “${filterLabel}”`
      : "the current filters";
  const clearLabel =
    query && filterLabel ? "Clear search & filter" : query ? "Clear search" : "Show all";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800"
      >
        <SearchIcon size={18} />
      </span>
      <div>
        <div className="text-[12.5px] font-semibold text-zinc-100">No entries match {subject}</div>
        <p className="mt-1 text-[11.5px] text-zinc-500">
          Try a shorter query or a different filter.
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        {clearLabel}
      </button>
    </div>
  );
}
