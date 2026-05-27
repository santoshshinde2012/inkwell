// Languages — working language (single select) + frequent languages
// (multi-select chip filter).
//
// Frequent languages bubble to the top of every per-request language
// picker, so this is one of the higher-impact settings. The filter
// input handles the long catalog (40+ languages) without forcing
// scrolls through every tile.

import { useMemo, useState } from "react";
import type { JSX } from "react";
import { LANGUAGE_CATALOG, languageDisplayName, type LanguageId } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { CheckIcon, GlobeIcon, SearchIcon, XIcon } from "../icons";
import { FieldLabel, Section, type SectionProps } from "./Section";

export function LanguagesSection({ settings, patch, flash }: SectionProps): JSX.Element {
  const [query, setQuery] = useState("");
  const selectedCount = settings.frequentLanguages.length;

  const changeWorking = async (lang: LanguageId): Promise<void> => {
    await localStore.setWorkingLanguage(lang);
    patch({ workingLanguage: lang });
    flash("Working language saved");
  };

  const toggleFrequent = async (lang: LanguageId): Promise<void> => {
    const has = settings.frequentLanguages.includes(lang);
    const next = has
      ? settings.frequentLanguages.filter((l) => l !== lang)
      : [...settings.frequentLanguages, lang];
    await localStore.setFrequentLanguages(next);
    patch({ frequentLanguages: next });
  };

  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGE_CATALOG;
    return LANGUAGE_CATALOG.filter((l) => languageDisplayName(l.id).toLowerCase().includes(q));
  }, [query]);

  return (
    <Section
      title="Languages"
      description="Pick the language you draft in, plus any you handle often."
      icon={<GlobeIcon size={13} />}
      meta={
        selectedCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            {selectedCount} pinned
          </span>
        ) : null
      }
    >
      <div className="space-y-3">
        <FieldLabel label="Working language">
          <select
            value={settings.workingLanguage}
            onChange={(e) => void changeWorking(e.target.value as LanguageId)}
            className="block w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-950 bg-no-repeat py-2 pl-3 pr-8 text-[12.5px] text-zinc-100 transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
              backgroundPosition: "right 10px center",
            }}
          >
            {LANGUAGE_CATALOG.map((l) => (
              <option key={l.id} value={l.id}>
                {languageDisplayName(l.id)}
              </option>
            ))}
          </select>
        </FieldLabel>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Frequent languages
            </span>
            <span className="text-[10px] text-zinc-500">Pinned to the top of every picker</span>
          </div>

          <LanguageSearch value={query} onChange={setQuery} />

          {filteredLanguages.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-3 text-center text-[11px] text-zinc-500">
              No language matches “{query}”.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {filteredLanguages.map((l) => {
                const checked = settings.frequentLanguages.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => void toggleFrequent(l.id)}
                    aria-pressed={checked}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                      checked
                        ? "border-emerald-500/60 bg-emerald-500/12 text-emerald-200 shadow-sm shadow-emerald-950/40"
                        : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                    }`}
                  >
                    {checked && <CheckIcon size={10} />}
                    <span className="truncate">{languageDisplayName(l.id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function LanguageSearch({
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
        <SearchIcon size={12} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter languages…"
        className="block w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-7 pr-7 text-[11.5px] text-zinc-100 placeholder-zinc-500 caret-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <XIcon size={10} />
        </button>
      )}
    </label>
  );
}
