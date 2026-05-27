// Filter bar — sits below the top bar and pins to the top of the
// scrollable list as the user scrolls. Three pieces:
//
//   1. Action chip strip (All / Reply / Translate / Grammar / Rewrite)
//      with per-action counts. Industry-standard filter pattern for
//      activity logs (Linear, Notion, GitHub).
//   2. Search field — input/output/page-title substring match.
//   3. Quota notice — surfaced only when the user is near or at the
//      on-device cap.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import { SearchIcon, XIcon } from "../icons";
import { ACTION_LABEL, ACTION_TONE, ACTIONS_IN_ORDER } from "./helpers";

export interface FilterBarProps {
  /** Total counts per action across the full history (pre-filter). */
  counts: Record<Action, number>;
  total: number;
  selected: Action | "all";
  onSelect: (a: Action | "all") => void;
  query: string;
  onQueryChange: (v: string) => void;
  quotaCount: number;
  quotaMax: number;
  quotaWarnAt: number;
}

export function FilterBar({
  counts,
  total,
  selected,
  onSelect,
  query,
  onQueryChange,
  quotaCount,
  quotaMax,
  quotaWarnAt,
}: FilterBarProps): JSX.Element {
  const showQuota = quotaCount >= quotaWarnAt;
  return (
    <div className="sticky top-0 z-10 space-y-2 border-b border-zinc-800/70 bg-zinc-950/85 px-3 py-2 backdrop-blur">
      <ChipStrip counts={counts} total={total} selected={selected} onSelect={onSelect} />
      <SearchField value={query} onChange={onQueryChange} />
      {showQuota && <QuotaNotice count={quotaCount} max={quotaMax} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip strip — horizontally scrollable on narrow widths
// ---------------------------------------------------------------------------

function ChipStrip({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: Record<Action, number>;
  total: number;
  selected: Action | "all";
  onSelect: (a: Action | "all") => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Filter by action"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Chip label="All" count={total} active={selected === "all"} onClick={() => onSelect("all")} />
      {ACTIONS_IN_ORDER.map((a) => (
        <Chip
          key={a}
          label={ACTION_LABEL[a]}
          count={counts[a]}
          tone={ACTION_TONE[a]}
          active={selected === a}
          onClick={() => onSelect(a)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: { bg: string; text: string; ring: string };
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const base =
    "inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 ring-inset transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500";
  const activeCls = tone
    ? `${tone.bg} ${tone.text} ${tone.ring.replace("/30", "/50")}`
    : "bg-indigo-500/15 text-indigo-200 ring-indigo-400/50";
  const idleCls = "bg-zinc-900 text-zinc-300 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`${base} ${active ? activeCls : idleCls}`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] tabular-nums ${
          active ? "bg-white/15" : "bg-zinc-800 text-zinc-400"
        }`}
      >
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Search field
// ---------------------------------------------------------------------------

function SearchField({
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
        <SearchIcon size={13} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search input, output, or page…"
        className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-8 text-[12.5px] text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <XIcon size={11} />
        </button>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Quota notice — only surfaces once close to the cap
// ---------------------------------------------------------------------------

function QuotaNotice({ count, max }: { count: number; max: number }): JSX.Element {
  const atCap = count >= max;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[10.5px] leading-snug ${
        atCap
          ? "border-amber-900/60 bg-amber-950/30 text-amber-200"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-px inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${
          atCap ? "bg-amber-500/20 text-amber-200" : "bg-zinc-800 text-zinc-400"
        }`}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </span>
      <span>
        <span className="font-semibold tabular-nums">
          {count} / {max}
        </span>{" "}
        {atCap
          ? "— at the on-device limit. Each new action drops the oldest entry."
          : "— approaching the on-device limit. Older entries are dropped first."}
      </span>
    </div>
  );
}
