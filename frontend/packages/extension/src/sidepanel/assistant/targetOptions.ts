// Pure helper that builds the "target language" picker list for a given
// action. Pinned languages (settings.frequentLanguages) float to the top of
// the catalog and the action determines which non-language sentinels
// ("Customer's language", "Bilingual", "Keep source language") are prepended.

import {
  type Action,
  LANGUAGE_CATALOG,
  type LanguageId,
  getLanguageInfo,
  languageDisplayName,
  languageLabel,
} from "@inkwell/shared";

export interface TargetOption {
  value: string;
  label: string;
}

/** Frequent languages first, then the remainder of the catalog. */
export const orderLanguages = (frequent: LanguageId[]): LanguageId[] => {
  const freq = frequent.filter((id) => getLanguageInfo(id));
  const rest = LANGUAGE_CATALOG.map((l) => l.id).filter((id) => !freq.includes(id));
  return [...freq, ...rest];
};

/**
 * Build the target picker's options. Grammar has no "to" choice; reply and
 * rewrite have action-specific sentinels in addition to the language list.
 */
export const buildTargetOptions = (
  action: Action,
  ordered: LanguageId[],
  workingLanguage: LanguageId,
): TargetOption[] => {
  const langs: TargetOption[] = ordered.map((id) => ({
    value: id,
    label: languageDisplayName(id),
  }));
  if (action === "translate") return langs;
  if (action === "reply")
    return [
      { value: "match", label: "Customer's language" },
      {
        value: "bilingual",
        label: `Bilingual (+ ${languageLabel(workingLanguage)})`,
      },
      ...langs,
    ];
  if (action === "rewrite") return [{ value: "match", label: "Keep source language" }, ...langs];
  return [];
};
