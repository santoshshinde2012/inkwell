// Advanced — escape hatch to the full options page (custom backend,
// per-site allow/block, full history, reset action).
//
// Kept intentionally lightweight: no settings live here, just one
// outbound link.

import type { JSX } from "react";
import { ExternalLinkIcon, SlidersIcon } from "../icons";
import { Section } from "./Section";

export function AdvancedSection(): JSX.Element {
  const openOptions = (): void => {
    void chrome.runtime.openOptionsPage();
  };
  return (
    <Section title="Advanced" icon={<SlidersIcon size={13} />}>
      <p className="text-[11.5px] leading-relaxed text-zinc-400">
        Custom backend, per-site allow/block, full history and the reset action live on the full
        settings page.
      </p>
      <button
        type="button"
        onClick={openOptions}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        Open full settings
        <ExternalLinkIcon size={12} />
      </button>
    </Section>
  );
}
