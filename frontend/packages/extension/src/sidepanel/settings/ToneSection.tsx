// Default tone — chip group with one active selection at a time.
//
// The user can override per-request from the OptionsSheet; this just
// seeds what's preselected when the assistant opens.

import type { JSX } from "react";
import { TONE_PRESETS, TONE_PRESET_LABELS, type TonePreset } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { PaletteIcon } from "../icons";
import { Section, type SectionProps } from "./Section";

export function ToneSection({ settings, patch, flash }: SectionProps): JSX.Element {
  const change = async (tone: TonePreset): Promise<void> => {
    if (tone === settings.defaultTone) return;
    await localStore.setDefaultTone(tone);
    patch({ defaultTone: tone });
    flash("Default tone saved");
  };
  return (
    <Section
      title="Default tone"
      description="Preselected when the assistant opens — change per-request any time."
      icon={<PaletteIcon size={13} />}
    >
      <div className="flex flex-wrap gap-1.5">
        {TONE_PRESETS.map((t) => {
          const active = t === settings.defaultTone;
          return (
            <button
              key={t}
              type="button"
              onClick={() => void change(t)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                active
                  ? "border-indigo-500 bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                  : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
              }`}
            >
              {TONE_PRESET_LABELS[t]}
            </button>
          );
        })}
      </div>
    </Section>
  );
}
