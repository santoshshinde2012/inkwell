// A day's worth of entries, with a sticky header so the user always knows
// what day they're scanning while scrolling a long history. The header
// pins below the FilterBar (which sits at scroll-top of the same
// container) — the `top-[VAL]` offset must match the FilterBar's
// rendered height so the labels stack cleanly without overlap.

import type { JSX } from "react";
import type { HistoryEntry } from "../../lib/history";
import { Row } from "./Row";

export interface DayGroupProps {
  label: string;
  entries: HistoryEntry[];
  openId: string | null;
  /** Sticky `top` offset for the day header — set so it pins right
   *  below the FilterBar in the scroll container. */
  stickyTopPx: number;
  onToggle: (id: string) => void;
  onAskDelete: (id: string) => void;
}

export function DayGroup({
  label,
  entries,
  openId,
  stickyTopPx,
  onToggle,
  onAskDelete,
}: DayGroupProps): JSX.Element {
  return (
    <section>
      <h3
        className="sticky z-[5] -mx-3 mb-1.5 bg-zinc-950/85 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur"
        style={{ top: stickyTopPx }}
      >
        {label}
      </h3>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <Row
            key={e.id}
            entry={e}
            expanded={openId === e.id}
            onToggle={() => onToggle(e.id)}
            onAskDelete={() => onAskDelete(e.id)}
          />
        ))}
      </ul>
    </section>
  );
}
