// Translation & action history.
//
// Every completed AI action (translate / reply / grammar / rewrite) is
// recorded here, giving agents an auditable, searchable record of past
// interactions — the "centralized history" capability from the multilingual
// support proposal.
//
// Like every other Inkwell setting, history lives ONLY in
// chrome.storage.local on this device; it is never sent to a server. The log
// is bounded (MAX_ENTRIES, newest-first) and each text field is capped, so
// storage cannot grow without limit.

import type { Action, LanguageId } from "@inkwell/shared";

const STORAGE_KEY = "history.entries";
const MAX_ENTRIES = 250;
const MAX_TEXT_CHARS = 2000;

export interface HistoryEntry {
  /** Stable unique id. */
  id: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  action: Action;
  /** Detected/declared source language, or "auto" when undetermined. */
  sourceLanguage: LanguageId | "auto";
  /** Output language, or null for grammar (which stays in the source language). */
  targetLanguage: LanguageId | null;
  /** True when the reply was produced in both source and target languages. */
  bilingual: boolean;
  /** The text the action worked on (the customer query / the draft). */
  inputText: string;
  /** The AI-produced text (translation / reply / corrected or rewritten draft). */
  outputText: string;
  /** Host the action happened on, e.g. "mail.google.com". */
  site: string;
  /** origin + pathname — groups entries belonging to one conversation. */
  conversationUrl: string;
  /** Page title at the time, for display. */
  pageTitle: string;
}

/** Shape passed to `add` — id and timestamp are assigned by the store. */
export type NewHistoryEntry = Omit<HistoryEntry, "id" | "createdAt">;

const clip = (s: string): string =>
  s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + "…" : s;

const newId = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the timestamp-based id
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const readAll = async (): Promise<HistoryEntry[]> => {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const raw = r[STORAGE_KEY];
  return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
};

export const historyStore = {
  /** Every entry, newest first. */
  async list(): Promise<HistoryEntry[]> {
    return readAll();
  },

  /**
   * Append an entry. Text fields are clipped; the log is trimmed to
   * MAX_ENTRIES with the oldest entries dropped. Never throws — a failed
   * write must not break the user-visible flow that produced the result.
   */
  async add(entry: NewHistoryEntry): Promise<void> {
    try {
      const existing = await readAll();
      const record: HistoryEntry = {
        ...entry,
        inputText: clip(entry.inputText),
        outputText: clip(entry.outputText),
        id: newId(),
        createdAt: Date.now(),
      };
      const next = [record, ...existing].slice(0, MAX_ENTRIES);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch {
      // History is best-effort; swallow storage errors.
    }
  },

  /** Remove a single entry by id. */
  async remove(id: string): Promise<void> {
    const existing = await readAll();
    await chrome.storage.local.set({
      [STORAGE_KEY]: existing.filter((e) => e.id !== id),
    });
  },

  /** Delete the entire history. */
  async clear(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  },
};
