// Per-device UI state persisted to chrome.storage.local.
//
//   - ui.optionsExpanded : whether the Options disclosure is open
//   - ui.lastUsed        : the user's last action / tone / model / source
//                          language / target language pick
//
// Shared between the in-page popover and the Side Panel so they open in
// sync, wherever the user touches Inkwell from. Every persisted value is
// validated against the live catalogues on load — a retired model id or
// removed language silently falls back to the configured default rather
// than breaking the surface.

import {
  Action,
  LanguageId,
  ModelId,
  MODEL_CATALOG,
  SourceLanguage,
  TONE_PRESETS,
  TonePreset,
  isLanguageId,
} from "@inkwell/shared";

// The "To" language picker value: a real language id, or one of two
// relative choices ("match" the source, or a "bilingual" reply).
export type TargetChoice = "match" | "bilingual" | LanguageId;

// ---------------------------------------------------------------------------
// Options disclosure expanded/collapsed
// ---------------------------------------------------------------------------

const OPTS_EXPANDED_KEY = "ui.optionsExpanded";

export const loadOptsExpanded = (): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(OPTS_EXPANDED_KEY, (result) => {
        resolve(result?.[OPTS_EXPANDED_KEY] === true);
      });
    } catch {
      resolve(false);
    }
  });
};

export const saveOptsExpanded = (val: boolean): void => {
  try {
    void chrome.storage.local.set({ [OPTS_EXPANDED_KEY]: val });
  } catch {
    /* storage unavailable — non-fatal */
  }
};

// ---------------------------------------------------------------------------
// Last-viewed Side Panel tab (Assistant / History / Settings)
// ---------------------------------------------------------------------------
//
// Restored on mount so reopening the panel drops the user back where they
// left off. We validate against the known set so an old / stale value
// can't put the App into a view it doesn't know how to render.

export type SidePanelView = "assistant" | "history" | "settings";

const LAST_VIEW_KEY = "ui.lastView";

export const isValidSidePanelView = (v: unknown): v is SidePanelView =>
  v === "assistant" || v === "history" || v === "settings";

export const loadLastView = (): Promise<SidePanelView> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(LAST_VIEW_KEY, (result) => {
        const v = result?.[LAST_VIEW_KEY];
        resolve(isValidSidePanelView(v) ? v : "assistant");
      });
    } catch {
      resolve("assistant");
    }
  });
};

export const saveLastView = (v: SidePanelView): void => {
  try {
    void chrome.storage.local.set({ [LAST_VIEW_KEY]: v });
  } catch {
    /* storage unavailable — non-fatal */
  }
};

// ---------------------------------------------------------------------------
// Last-used settings — action / tone / model / language pair
// ---------------------------------------------------------------------------

const LAST_USED_KEY = "ui.lastUsed";

export interface LastUsedShape {
  action?: Action;
  tone?: TonePreset;
  model?: ModelId;
  sourceLang?: SourceLanguage;
  targetChoice?: TargetChoice;
}

export const isValidAction = (v: unknown): v is Action =>
  v === "reply" || v === "translate" || v === "grammar" || v === "rewrite";
export const isValidTone = (v: unknown): v is TonePreset =>
  typeof v === "string" && (TONE_PRESETS as readonly string[]).includes(v);
export const isValidModel = (v: unknown): v is ModelId =>
  typeof v === "string" && MODEL_CATALOG.some((m) => m.id === v);
export const isValidSourceLang = (v: unknown): v is SourceLanguage =>
  v === "auto" || (typeof v === "string" && isLanguageId(v));
export const isValidTargetChoice = (v: unknown): v is TargetChoice =>
  v === "match" ||
  v === "bilingual" ||
  (typeof v === "string" && isLanguageId(v));

export const loadLastUsed = (): Promise<LastUsedShape> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(LAST_USED_KEY, (result) => {
        const v = result?.[LAST_USED_KEY];
        resolve(v && typeof v === "object" ? (v as LastUsedShape) : {});
      });
    } catch {
      resolve({});
    }
  });
};

export interface LastUsedPersistable {
  action: Action;
  tone: TonePreset;
  model: ModelId;
  sourceLang: SourceLanguage;
  targetChoice: TargetChoice;
}

export const saveLastUsed = (s: LastUsedPersistable): void => {
  try {
    void chrome.storage.local.set({
      [LAST_USED_KEY]: {
        action: s.action,
        tone: s.tone,
        model: s.model,
        sourceLang: s.sourceLang,
        targetChoice: s.targetChoice,
      } satisfies LastUsedShape,
    });
  } catch {
    /* storage unavailable — non-fatal */
  }
};
