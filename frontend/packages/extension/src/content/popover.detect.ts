// Local source-language detection for the in-page popover.
//
// `chrome.i18n.detectLanguage` runs against Chrome's bundled CLD model:
// no network call, no extra permission, instant. The result only
// labels the UI ("From · French") and tags history entries — the
// backend model still detects the language itself, so a miss here
// costs nothing but a hint.
//
// Extracted from popover.ts to keep that file focused on layout.
// The detector encapsulates two pieces of state the rest of the
// popover doesn't need to see:
//
//   1. A debounce timer for textarea-driven detection.
//   2. A cached `RequestContext` for field mode (avoids re-scraping
//      the page each time the action changes).

import {
  type Action,
  isLanguageId,
  type LanguageId,
  type RequestContext,
  type SourceLanguage,
} from "@inkwell/shared";
import type { SiteAdapter } from "./adapters";
import { readText } from "./editable";
import { detectLanguage } from "../lib/languages";
import type { PopoverSource } from "./popover";

/** Inputs the detector needs to read or write its caller's state. */
export interface DetectorOptions {
  /** Where the popover was invoked from. Drives whether we read the
   *  source text from the textarea (selection / blank) or scrape the
   *  page via the adapter (field). */
  source: PopoverSource;
  /** Site-specific context extractor — used in field mode to resolve
   *  the "Text being replied to" without re-scraping the page. */
  adapter: SiteAdapter;
  /** Read-only accessor for the current action. The text we detect
   *  against depends on it: grammar/rewrite see the draft, reply/
   *  translate see the incoming thread/post. */
  getAction: () => Action;
  /** Read-only accessor for the current source-language choice.
   *  Detection only writes anything when this is "auto" — otherwise
   *  the user has overridden us. */
  getSourceLang: () => SourceLanguage;
  /** Push a detected language id (or null when nothing was found,
   *  or when the detected id isn't in our catalog) back into the
   *  popover's mutable state. */
  setDetected: (lang: LanguageId | null) => void;
  /** Invoked after a state mutation so the popover re-renders the
   *  language pill + options summary. */
  onChange: () => void;
}

/** A focused wrapper around `chrome.i18n.detectLanguage` with a
 *  debounce timer + field-mode cache. */
export interface LanguageDetector {
  /** Schedule a detection from explicit text, after the debounce
   *  window (400 ms) elapses. Subsequent calls within the window
   *  reset the timer. */
  scheduleFromText(text: string): void;
  /** Run detection for field mode immediately, using the adapter to
   *  extract the relevant text. No-ops in selection/blank mode or
   *  when source-language is locked. */
  detectField(): Promise<void>;
  /** Cancel any pending debounced detection. Call from teardown. */
  dispose(): void;
}

export function createLanguageDetector(opts: DetectorOptions): LanguageDetector {
  let timer = 0;
  let fieldContext: RequestContext | null = null;

  const subjectText = (action: Action, ctx: RequestContext): string => {
    if (action === "grammar" || action === "rewrite") return ctx.draft ?? "";
    if (ctx.post) return ctx.post.text;
    if (ctx.thread && ctx.thread.length > 0) {
      return ctx.thread[ctx.thread.length - 1]?.text ?? "";
    }
    return ctx.draft ?? "";
  };

  const runDetection = async (text: string): Promise<void> => {
    const result = await detectLanguage(text);
    // CLD can return language codes outside our catalog (e.g. "und"
    // for undetermined, "vi" for Vietnamese which we don't support).
    // Filter to keep the popover's state strictly typed.
    const lang = result && isLanguageId(result.language) ? result.language : null;
    opts.setDetected(lang);
    // Only the auto-mode UI cares about the detected language; if the
    // user has picked a concrete source language, no re-render needed.
    if (opts.getSourceLang() === "auto") opts.onChange();
  };

  return {
    scheduleFromText(text: string): void {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void runDetection(text), 400);
    },

    async detectField(): Promise<void> {
      if (opts.source.kind !== "field" || opts.getSourceLang() !== "auto") return;
      const action = opts.getAction();
      let text: string;
      if (action === "grammar" || action === "rewrite") {
        // The draft is cheap to read fresh from the element.
        text = readText(opts.source.element);
      } else {
        // reply / translate work on the incoming thread/post.
        if (!fieldContext) {
          try {
            fieldContext = await opts.adapter.extractContext(opts.source.element);
          } catch {
            fieldContext = null;
          }
        }
        text = fieldContext ? subjectText(action, fieldContext) : "";
      }
      if (text.trim()) {
        await runDetection(text);
      } else {
        opts.setDetected(null);
        opts.onChange();
      }
    },

    dispose(): void {
      window.clearTimeout(timer);
    },
  };
}
