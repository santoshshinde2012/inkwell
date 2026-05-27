// Default model — radio rows with description + tier badge.
//
// We render the full catalog rather than a select dropdown so the
// description and tier ("fast" / "quality") are visible at the point
// of choice — picking a model is more about the trade-off than the
// name, and a `<select>` hides both.

import type { JSX } from "react";
import { MODEL_CATALOG, type ModelId } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { CheckIcon, CpuIcon } from "../icons";
import { Section, type SectionProps } from "./Section";

export function ModelSection({ settings, patch, flash }: SectionProps): JSX.Element {
  const change = async (model: ModelId): Promise<void> => {
    if (model === settings.defaultModel) return;
    await localStore.setDefaultModel(model);
    patch({ defaultModel: model });
    flash("Default model saved");
  };
  return (
    <Section
      title="Default model"
      description="Used unless you pick a different one for a specific request."
      icon={<CpuIcon size={13} />}
    >
      <div className="space-y-1.5">
        {MODEL_CATALOG.map((m) => {
          const active = m.id === settings.defaultModel;
          const tierTone =
            m.tier?.toLowerCase() === "fast"
              ? "bg-amber-500/15 text-amber-200 ring-amber-500/30"
              : m.tier?.toLowerCase() === "quality"
                ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
                : "bg-zinc-800 text-zinc-300 ring-zinc-700/60";
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => void change(m.id)}
              aria-pressed={active}
              className={`group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                active
                  ? "border-indigo-500/70 bg-gradient-to-br from-indigo-950/50 to-zinc-900/60 shadow-sm shadow-indigo-950/40"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/60"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                  active
                    ? "bg-gradient-to-br from-indigo-400 to-violet-500 text-white shadow-md shadow-indigo-900/50"
                    : "bg-zinc-900 ring-1 ring-zinc-700 text-transparent group-hover:ring-zinc-600"
                }`}
              >
                <CheckIcon size={11} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-zinc-100">{m.label}</span>
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ring-1 ring-inset ${tierTone}`}
                  >
                    {m.tier}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  {m.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
