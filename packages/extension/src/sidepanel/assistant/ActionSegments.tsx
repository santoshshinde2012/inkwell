// Segmented picker for the four Assistant actions (Reply / Translate /
// Grammar / Rewrite). Each tab pulls its colour from `ACTION_THEMES` so the
// active state lights up the same hue the user will see on the result
// border and the primary Send button.

import type { JSX } from "react";
import type { Action } from "@inkwell/shared";
import { ACTION_THEMES } from "../actionTheme";
import { ACTION_ICON, ACTION_LABELS } from "./constants";

export interface ActionSegmentsProps {
  current: Action;
  onChange: (a: Action) => void;
}

const ITEMS: Action[] = ["reply", "translate", "grammar", "rewrite"];

export function ActionSegments({ current, onChange }: ActionSegmentsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Action"
      className="grid grid-cols-4 gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1 shadow-inner shadow-black/20"
    >
      {ITEMS.map((id) => {
        const active = id === current;
        const theme = ACTION_THEMES[id];
        const Icon = ACTION_ICON[id];
        const label = ACTION_LABELS[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(id)}
            className={`group relative inline-flex h-12 flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              active
                ? `${theme.tabActive} ${theme.tabRing}`
                : `text-zinc-400 hover:bg-zinc-800/60 hover:${theme.accentIcon}`
            }`}
          >
            <Icon size={16} />
            <span className="text-[10.5px] font-semibold tracking-tight">
              {label}
            </span>
            {active && (
              <span
                aria-hidden="true"
                className={`absolute -bottom-px left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full ${theme.dotBg}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
