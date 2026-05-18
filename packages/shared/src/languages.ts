// Language catalog — the single source of truth for the languages Inkwell
// can detect, translate between, and compose replies in.
//
// Both ends import from here: the extension renders language pickers and
// detection hints straight from LANGUAGE_CATALOG; the backend validates
// requested languages against LANGUAGE_IDS and names them in the prompt.
//
// Adding a language is a one-line catalog change — the request schema,
// the extension's pickers, and the prompt builder all derive from this
// list, so nothing else needs to change.

export interface LanguageInfo {
  /** BCP-47 / ISO 639 identifier sent in API requests and stored locally. */
  readonly id: string;
  /** English name shown in the UI ("French"). */
  readonly label: string;
  /** Endonym — the language's own name ("Français"), shown beside the label. */
  readonly nativeName: string;
  /** True for right-to-left scripts, so the UI can set `dir` correctly. */
  readonly rtl?: boolean;
}

// English first: it is the default agent working language. The rest are
// ordered by the rollout priority in the multilingual support proposal.
export const LANGUAGE_CATALOG = [
  { id: "en", label: "English", nativeName: "English" },
  { id: "fr", label: "French", nativeName: "Français" },
  { id: "de", label: "German", nativeName: "Deutsch" },
  { id: "es", label: "Spanish", nativeName: "Español" },
  { id: "it", label: "Italian", nativeName: "Italiano" },
  { id: "pt", label: "Portuguese", nativeName: "Português" },
  { id: "nl", label: "Dutch", nativeName: "Nederlands" },
  { id: "pl", label: "Polish", nativeName: "Polski" },
  { id: "ru", label: "Russian", nativeName: "Русский" },
  { id: "ja", label: "Japanese", nativeName: "日本語" },
  { id: "zh-Hans", label: "Chinese (Simplified)", nativeName: "简体中文" },
  { id: "zh-Hant", label: "Chinese (Traditional)", nativeName: "繁體中文" },
  { id: "ko", label: "Korean", nativeName: "한국어" },
  { id: "ar", label: "Arabic", nativeName: "العربية", rtl: true },
  { id: "hi", label: "Hindi", nativeName: "हिन्दी" },
] as const satisfies readonly LanguageInfo[];

/** Union of every valid language id, e.g. "en" | "fr" | "zh-Hans". */
export type LanguageId = (typeof LANGUAGE_CATALOG)[number]["id"];

/** Non-empty tuple of language ids — shaped for `z.enum(...)`. */
export const LANGUAGE_IDS = LANGUAGE_CATALOG.map((l) => l.id) as [
  LanguageId,
  ...LanguageId[],
];

/** Sentinel: "let the system detect the source language." */
export const AUTO_DETECT = "auto" as const;
export type AutoDetect = typeof AUTO_DETECT;

/** A request's source language: a concrete language, or "auto" to detect. */
export type SourceLanguage = LanguageId | AutoDetect;

/** Tuple for `z.enum(...)` — accepts any catalog language plus "auto". */
export const SOURCE_LANGUAGE_IDS = [AUTO_DETECT, ...LANGUAGE_IDS] as [
  AutoDetect,
  ...LanguageId[],
];

/** Default agent working language — the first catalog entry (English). */
export const DEFAULT_WORKING_LANGUAGE: LanguageId = LANGUAGE_CATALOG[0].id;

/** Look up a language's metadata by id. Returns undefined for unknown ids. */
export const getLanguageInfo = (id: string): LanguageInfo | undefined =>
  LANGUAGE_CATALOG.find((l) => l.id === id);

/** Type guard: is this string a known catalog language id? */
export const isLanguageId = (id: unknown): id is LanguageId =>
  typeof id === "string" && LANGUAGE_CATALOG.some((l) => l.id === id);

/** English label for a known id; the raw id otherwise (never throws). */
export const languageLabel = (id: string): string =>
  getLanguageInfo(id)?.label ?? id;

/** "French (Français)" — label with endonym, for pickers and badges. */
export const languageDisplayName = (id: string): string => {
  const info = getLanguageInfo(id);
  if (!info) return id;
  return info.label === info.nativeName
    ? info.label
    : `${info.label} (${info.nativeName})`;
};

// Real-world language codes are messy: detectors and browser locales emit
// region subtags ("pt-BR"), legacy codes, and Chinese script variants. This
// table maps the ones we care about onto a catalog id.
const CODE_ALIASES: Readonly<Record<string, LanguageId>> = {
  zh: "zh-Hans",
  cmn: "zh-Hans",
  "zh-cn": "zh-Hans",
  "zh-sg": "zh-Hans",
  "zh-hans": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-mo": "zh-Hant",
  "zh-hant": "zh-Hant",
};

/**
 * Normalize an arbitrary language code (from a detector, an `Accept-Language`
 * header, or a browser locale) onto a catalog id. Handles region subtags
 * ("pt-BR" → "pt") and Chinese script variants. Returns null when the code
 * does not correspond to a supported language.
 */
export const normalizeLanguageCode = (raw: string): LanguageId | null => {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;

  // Exact catalog id, case-insensitive (covers "zh-Hans" / "zh-hant").
  const exact = LANGUAGE_CATALOG.find((l) => l.id.toLowerCase() === lower);
  if (exact) return exact.id;

  // Known alias (Chinese script/region variants, legacy spellings).
  const aliased = CODE_ALIASES[lower];
  if (aliased) return aliased;

  // Otherwise fall back to the primary subtag ("pt-br" → "pt").
  const primary = lower.split("-")[0] ?? lower;
  const primaryAlias = CODE_ALIASES[primary];
  if (primaryAlias) return primaryAlias;
  const base = LANGUAGE_CATALOG.find((l) => l.id.toLowerCase() === primary);
  return base ? base.id : null;
};
