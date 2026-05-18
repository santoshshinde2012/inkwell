// Typed wrapper around chrome.storage.local.
//
// Inkwell has no authentication and no backend database — ALL persistent
// state lives here, in chrome.storage.local on the user's device:
//
//   - profile      : optional personalization (displayName, aboutMe)
//   - defaultTone  : the tone preselected when the popover opens
//   - defaultModel : the model used unless overridden per request
//   - backendUrl   : the API the extension talks to (user-configurable, so
//                    the extension works against any compatible backend)
//   - apiKey       : optional bearer credential for the user's own backend
//   - siteAllowlist / siteBlocklist : per-site policy
//
// We deliberately use `local` (not `session` or `sync`):
//   - `session` would clear on browser restart — settings should persist.
//   - `sync` would propagate settings to other Chrome instances, exposing
//     them to any extension with the right permissions; `local` keeps
//     everything on this device only.

import {
  DEFAULT_BLOCKED_HOSTS,
  DEFAULT_MODEL_ID,
  DEFAULT_WORKING_LANGUAGE,
  LocalSettings,
  TONE_PRESETS,
  isLanguageId,
  isModelId,
  type LanguageId,
} from "@inkwell/shared";

// The build-time default backend — used until the user configures their own.
const DEFAULT_BACKEND_URL = __BACKEND_URL__;

const KEYS = {
  displayName: "settings.displayName",
  aboutMe: "settings.aboutMe",
  defaultTone: "settings.defaultTone",
  defaultModel: "settings.defaultModel",
  workingLanguage: "settings.workingLanguage",
  frequentLanguages: "settings.frequentLanguages",
  backendUrl: "settings.backendUrl",
  apiKey: "settings.apiKey",
  siteAllowlist: "policy.siteAllowlist",
  siteBlocklist: "policy.siteBlocklist",
} as const;

const DEFAULTS: LocalSettings = {
  displayName: "",
  aboutMe: "",
  defaultTone: TONE_PRESETS[0]!,
  defaultModel: DEFAULT_MODEL_ID,
  workingLanguage: DEFAULT_WORKING_LANGUAGE,
  frequentLanguages: [],
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: "",
  siteAllowlist: [],
  siteBlocklist: [...DEFAULT_BLOCKED_HOSTS],
};

const asString = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v : fallback;

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// Keep only valid catalog language ids, drop duplicates, preserve order.
const asLanguageList = (v: unknown): LanguageId[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<LanguageId>();
  for (const x of v) {
    if (isLanguageId(x)) seen.add(x);
  }
  return [...seen];
};

/** Normalize a backend URL: trim, drop a trailing slash. Returns null if
 *  the input isn't a valid http(s) URL. */
export const normalizeBackendUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return (u.origin + u.pathname).replace(/\/+$/, "") || u.origin;
  } catch {
    return null;
  }
};

const validBackendUrl = (v: unknown): string => {
  if (typeof v !== "string") return DEFAULT_BACKEND_URL;
  return normalizeBackendUrl(v) ?? DEFAULT_BACKEND_URL;
};

export const localStore = {
  /** Read every setting at once, applying defaults for anything unset. */
  async getAll(): Promise<LocalSettings> {
    const r = await chrome.storage.local.get(Object.values(KEYS));
    const tone = r[KEYS.defaultTone];
    const model = r[KEYS.defaultModel];
    return {
      displayName: asString(r[KEYS.displayName], DEFAULTS.displayName),
      aboutMe: asString(r[KEYS.aboutMe], DEFAULTS.aboutMe),
      defaultTone: (TONE_PRESETS as readonly string[]).includes(tone)
        ? (tone as LocalSettings["defaultTone"])
        : DEFAULTS.defaultTone,
      // Tolerate a stale id from an older version: fall back to the default
      // when the stored model is no longer in the catalog.
      defaultModel: isModelId(model) ? model : DEFAULTS.defaultModel,
      workingLanguage: isLanguageId(r[KEYS.workingLanguage])
        ? r[KEYS.workingLanguage]
        : DEFAULTS.workingLanguage,
      frequentLanguages:
        r[KEYS.frequentLanguages] === undefined
          ? DEFAULTS.frequentLanguages
          : asLanguageList(r[KEYS.frequentLanguages]),
      backendUrl: validBackendUrl(r[KEYS.backendUrl]),
      apiKey: asString(r[KEYS.apiKey], DEFAULTS.apiKey),
      siteAllowlist:
        r[KEYS.siteAllowlist] === undefined
          ? DEFAULTS.siteAllowlist
          : asStringArray(r[KEYS.siteAllowlist]),
      siteBlocklist:
        r[KEYS.siteBlocklist] === undefined
          ? DEFAULTS.siteBlocklist
          : asStringArray(r[KEYS.siteBlocklist]),
    };
  },

  async setProfile(displayName: string, aboutMe: string): Promise<void> {
    await chrome.storage.local.set({
      [KEYS.displayName]: displayName.slice(0, 120),
      [KEYS.aboutMe]: aboutMe.slice(0, 2000),
    });
  },

  async setDefaultTone(tone: LocalSettings["defaultTone"]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.defaultTone]: tone });
  },

  async setDefaultModel(model: LocalSettings["defaultModel"]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.defaultModel]: model });
  },

  async setWorkingLanguage(
    language: LocalSettings["workingLanguage"],
  ): Promise<void> {
    await chrome.storage.local.set({ [KEYS.workingLanguage]: language });
  },

  async setFrequentLanguages(
    languages: LocalSettings["frequentLanguages"],
  ): Promise<void> {
    await chrome.storage.local.set({
      [KEYS.frequentLanguages]: asLanguageList(languages),
    });
  },

  /**
   * Persist the backend the extension talks to. `url` is normalized; an
   * invalid url is rejected (returns false). `apiKey` is stored verbatim
   * (empty string = no Authorization header).
   */
  async setBackend(url: string, apiKey: string): Promise<boolean> {
    const normalized = normalizeBackendUrl(url);
    if (!normalized) return false;
    await chrome.storage.local.set({
      [KEYS.backendUrl]: normalized,
      [KEYS.apiKey]: apiKey.trim().slice(0, 500),
    });
    return true;
  },

  async getAllowlist(): Promise<string[]> {
    return (await this.getAll()).siteAllowlist;
  },
  async setAllowlist(list: string[]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.siteAllowlist]: list });
  },

  async getBlocklist(): Promise<string[]> {
    return (await this.getAll()).siteBlocklist;
  },
  async setBlocklist(list: string[]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.siteBlocklist]: list });
  },

  /** Reset everything to defaults (used by the options page). */
  async clearAll(): Promise<void> {
    await chrome.storage.local.clear();
  },
};

/** The build-time default backend, exposed for the options "Reset" affordance. */
export { DEFAULT_BACKEND_URL };
