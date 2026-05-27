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
  v === "match" || v === "bilingual" || (typeof v === "string" && isLanguageId(v));

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

// ---------------------------------------------------------------------------
// Popover → Side panel hand-off
// ---------------------------------------------------------------------------
//
// When the user clicks "Open in side panel" from the in-page popover, the
// background writes a small record here. The side panel reads it on mount
// (and on storage change for already-open panels), pre-fills its input,
// and clears the key. The timestamp lets readers ignore stale handoffs
// (e.g. user opens the side panel manually hours later — they shouldn't
// be surprised by text from a long-dismissed popover).

export const HANDOFF_KEY = "ui.handoff";
/** Handoffs older than this are ignored. 30 s comfortably covers the
 *  worst case of a slow `chrome.sidePanel.open`, but is short enough that
 *  a stale record can't surprise the user on a later panel open. */
export const HANDOFF_MAX_AGE_MS = 30_000;

export interface Handoff {
  text?: string;
  action?: Action;
  /** A non-blocking error from the background to be surfaced as a
   *  user-facing notice in the side panel. Set by the right-click OCR
   *  flow's side-panel fallback path when the in-page popover can't be
   *  reached (chrome:// / file:// pages, sandboxed iframes). */
  errorMessage?: string;
  createdAt: number;
}

const isHandoff = (v: unknown): v is Handoff =>
  !!v && typeof v === "object" && typeof (v as { createdAt?: unknown }).createdAt === "number";

/** Read the handoff, if any, AND clear it in the same trip. Returns null
 *  when nothing is staged, the record is malformed, or it's older than
 *  HANDOFF_MAX_AGE_MS. */
export const consumeHandoff = (): Promise<Handoff | null> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(HANDOFF_KEY, (result) => {
        const v = result?.[HANDOFF_KEY];
        // Always remove — even a stale or malformed record should be
        // wiped so it can't reappear on a later read.
        void chrome.storage.local.remove(HANDOFF_KEY);
        if (!isHandoff(v)) return resolve(null);
        if (Date.now() - v.createdAt > HANDOFF_MAX_AGE_MS) return resolve(null);
        resolve(v);
      });
    } catch {
      resolve(null);
    }
  });
};

/** Stash a handoff for the side panel to pick up. Used by the background
 *  worker after opening the side panel. */
export const stashHandoff = async (h: Omit<Handoff, "createdAt">): Promise<void> => {
  try {
    const record: Handoff = { ...h, createdAt: Date.now() };
    await chrome.storage.local.set({ [HANDOFF_KEY]: record });
  } catch {
    /* storage unavailable — non-fatal */
  }
};
