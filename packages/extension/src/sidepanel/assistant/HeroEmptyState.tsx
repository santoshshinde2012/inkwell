// Hero empty state shown when there's no result on screen yet. Designed
// to set context for first-time users — a single sparkle, a per-action
// title, and two status pills that confirm the assistant is ready and
// runs locally.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import { SparkleIcon } from "../icons";
import type { ActionTheme } from "../actionTheme";
import { ACTION_HINTS, EMPTY_TITLES } from "./constants";

export interface HeroEmptyStateProps {
  action: Action;
  theme: ActionTheme;
}

export function HeroEmptyState({ action, theme }: HeroEmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-900/80 ring-1 ring-zinc-800 ${theme.accentIcon}`}
      >
        <SparkleIcon size={24} />
      </span>
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-zinc-50">
          {EMPTY_TITLES[action]}
        </div>
        <p className="mx-auto mt-1 max-w-[34ch] text-[12px] leading-relaxed text-zinc-400">
          {ACTION_HINTS[action]}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <StatusPill tone="emerald" label="AI Ready" />
        <StatusPill tone="indigo" label="Local-only" />
      </div>

      <p className="mt-2 text-[10.5px] text-zinc-500">
        Type below or paste a selection to begin.
      </p>
    </div>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: "emerald" | "indigo";
  label: string;
}): JSX.Element {
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-indigo-400";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-2 py-1 text-[10.5px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
