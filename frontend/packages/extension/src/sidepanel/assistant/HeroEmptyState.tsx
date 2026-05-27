// Hero empty state shown when there's no result on screen yet.
// One job: set context for the action the user just selected, and
// nudge them toward the input. No marketing pills, no bullet list —
// the chip toolbar in the input bar already advertises selection
// capture and image OCR; repeating those here was clutter.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import type { ActionTheme } from "../actionTheme";
import { ACTION_ICON, ACTION_HINTS, EMPTY_TITLES, KBD } from "./constants";

export interface HeroEmptyStateProps {
  action: Action;
  theme: ActionTheme;
}

export function HeroEmptyState({ action, theme }: HeroEmptyStateProps): JSX.Element {
  const ActionIcon = ACTION_ICON[action];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className={`flex h-20 w-20 items-center justify-center rounded-3xl bg-zinc-900/70 ring-1 ring-zinc-800 ${theme.accentIcon}`}
      >
        <ActionIcon size={30} />
      </span>
      <div className="space-y-2">
        <h1 className="text-[17px] font-semibold tracking-tight text-zinc-50">
          {EMPTY_TITLES[action]}
        </h1>
        <p className="mx-auto max-w-[36ch] text-[12.5px] leading-relaxed text-zinc-400">
          {ACTION_HINTS[action]}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <span>Type below, then press</span>
        <kbd className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {KBD}
        </kbd>
      </div>
    </div>
  );
}
