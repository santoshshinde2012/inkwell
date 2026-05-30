// Date / grouping helpers + action label registry for the History view.
//
// Pure functions — no React, no chrome.* — so each piece of the view can
// pull what it needs without dragging in dependencies it doesn't use.

import type { Action } from "@inkwell/shared";
import type { HistoryEntry } from "../../lib/history";

export const ACTION_LABEL: Record<Action, string> = {
  reply: "Reply",
  translate: "Translate",
  grammar: "Grammar",
  rewrite: "Rewrite",
  summarize: "Summarize",
  explain: "Explain",
};

/** All actions in display order — used by the filter chip strip. */
export const ACTIONS_IN_ORDER: Action[] = [
  "reply",
  "translate",
  "grammar",
  "rewrite",
  "summarize",
  "explain",
];

/** Tailwind class tokens for the small per-action badge / chip color. */
export const ACTION_TONE: Record<Action, { bg: string; text: string; ring: string }> = {
  reply: {
    bg: "bg-indigo-500/15",
    text: "text-indigo-200",
    ring: "ring-indigo-400/30",
  },
  translate: {
    bg: "bg-sky-500/15",
    text: "text-sky-200",
    ring: "ring-sky-400/30",
  },
  grammar: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-200",
    ring: "ring-emerald-400/30",
  },
  rewrite: {
    bg: "bg-amber-500/15",
    text: "text-amber-200",
    ring: "ring-amber-400/30",
  },
  summarize: {
    bg: "bg-purple-500/15",
    text: "text-purple-200",
    ring: "ring-purple-400/30",
  },
  explain: {
    bg: "bg-rose-500/15",
    text: "text-rose-200",
    ring: "ring-rose-400/30",
  },
};

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  const diffDays = (today.getTime() - d.getTime()) / (24 * 3600 * 1000);
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export interface DayGroup {
  label: string;
  entries: HistoryEntry[];
}

/** Group adjacent same-day entries. Assumes the input list is already
 *  newest-first (which `historyStore.list()` guarantees). */
export function groupByDay(entries: HistoryEntry[]): DayGroup[] {
  const out: DayGroup[] = [];
  let currentLabel = "";
  for (const e of entries) {
    const label = dayLabel(e.createdAt);
    if (label !== currentLabel) {
      out.push({ label, entries: [e] });
      currentLabel = label;
    } else {
      out[out.length - 1]!.entries.push(e);
    }
  }
  return out;
}
