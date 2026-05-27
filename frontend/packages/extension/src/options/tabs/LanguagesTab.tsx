// LanguagesTab — one tab of the options page.
//
// Composed by ./index.ts and routed to from options/App.tsx.

import { type JSX } from "react";
import { LANGUAGE_CATALOG, languageDisplayName, type LanguageId } from "@inkwell/shared";
import { localStore } from "../../lib/storage";
import { Card, type TabProps } from "../components";

export function LanguagesTab({ settings, patch, flash }: TabProps): JSX.Element {
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
    flash("Frequent languages saved");
  };

  return (
    <>
      <Card
        title="Working language"
        description="Your preferred language for drafting. It is the default target when you translate, and the second language used in a bilingual reply."
      >
        <select
          value={settings.workingLanguage}
          onChange={(e) => void changeWorking(e.target.value as LanguageId)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 sm:w-72"
        >
          {LANGUAGE_CATALOG.map((l) => (
            <option key={l.id} value={l.id}>
              {languageDisplayName(l.id)}
            </option>
          ))}
        </select>
      </Card>

      <Card
        title="Frequent languages"
        description="Languages you handle often. These are surfaced at the top of the language pickers in the popover, so common targets are one click away."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LANGUAGE_CATALOG.map((l) => {
            const checked = settings.frequentLanguages.includes(l.id);
            return (
              <label
                key={l.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition ${
                  checked
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => void toggleFrequent(l.id)}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                <span className="min-w-0 truncate">{languageDisplayName(l.id)}</span>
              </label>
            );
          })}
        </div>
        {settings.frequentLanguages.length === 0 && (
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            None selected — the pickers show every language in catalog order.
          </p>
        )}
      </Card>
    </>
  );
}

// -----------------------------------------------------------------------------
// History tab — searchable translation & action log
// -----------------------------------------------------------------------------
