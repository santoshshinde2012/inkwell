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
// Permissive check — the catalog is fetched from the backend, so we
// can't enumerate valid ids at this layer. The picker validates the
// chosen id against the current catalog when rendering.
export const isValidModel = (v: unknown): v is ModelId =>
  typeof v === "string" && v.length > 0 && v.length <= 120;
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

// ---------------------------------------------------------------------------
// Assistant draft autosave
// ---------------------------------------------------------------------------
//
// Persist what the user has typed into the side panel's textarea +
// instruction field so a panel close (or browser restart) doesn't
// silently lose their work. Cleared the moment they send. We keep the
// shape narrow and validated on load — a corrupted record falls back
// to an empty draft rather than throwing.

const DRAFT_KEY = "ui.assistantDraft";
/** Drafts older than this are dropped on read. A user who hasn't
 *  touched the panel for two weeks is almost certainly past the point
 *  where their last in-progress draft is still relevant; restoring it
 *  would feel surprising. */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface AssistantDraft {
  inputText: string;
  instruction: string;
  updatedAt: number;
}

const isDraft = (v: unknown): v is AssistantDraft =>
  !!v &&
  typeof v === "object" &&
  typeof (v as { inputText?: unknown }).inputText === "string" &&
  typeof (v as { instruction?: unknown }).instruction === "string" &&
  typeof (v as { updatedAt?: unknown }).updatedAt === "number";

/** Read the persisted draft, or null when nothing is saved, the
 *  record is malformed, or it's past {@link DRAFT_MAX_AGE_MS}. */
export const loadAssistantDraft = (): Promise<AssistantDraft | null> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(DRAFT_KEY, (result) => {
        const v = result?.[DRAFT_KEY];
        if (!isDraft(v)) return resolve(null);
        if (Date.now() - v.updatedAt > DRAFT_MAX_AGE_MS) {
          void chrome.storage.local.remove(DRAFT_KEY);
          return resolve(null);
        }
        resolve(v);
      });
    } catch {
      resolve(null);
    }
  });
};

/** Persist the current draft. The Assistant view debounces calls to
 *  this so storage isn't written on every keystroke. Empty drafts
 *  remove the key instead of saving an empty record, so a stale
 *  record can't reappear after the user cleared the field. */
export const saveAssistantDraft = (
  draft: Omit<AssistantDraft, "updatedAt">,
): void => {
  try {
    if (!draft.inputText && !draft.instruction) {
      void chrome.storage.local.remove(DRAFT_KEY);
      return;
    }
    const record: AssistantDraft = { ...draft, updatedAt: Date.now() };
    void chrome.storage.local.set({ [DRAFT_KEY]: record });
  } catch {
    /* storage unavailable — non-fatal */
  }
};

/** Drop the persisted draft. Called when the user sends, so the
 *  next panel open starts fresh. */
export const clearAssistantDraft = (): void => {
  try {
    void chrome.storage.local.remove(DRAFT_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
};
