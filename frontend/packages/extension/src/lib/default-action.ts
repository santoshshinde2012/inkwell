// Decides the default action for newly arriving text.
//
// Used on three surfaces that all share the same rule:
//   • Side panel `captureSelection`  — when the user pulls in the
//     active tab's current selection.
//   • Side panel `runOcr`            — when image OCR finishes and
//     pushes text into the textarea.
//   • In-page popover mount          — when the popover opens with a
//     selection or focused field.
//
// Rules:
//   non-English text                              → "translate"
//   English from textarea / contenteditable       → "grammar"
//   English from page selection or OCR output     → "reply"
//
// Detection uses Chrome's bundled CLD via `detectLanguage` when
// available, with an ASCII-Latin heuristic fallback for short
// snippets (CLD bails below 12 chars / 50 % confidence) and for
// contexts where `chrome.i18n` isn't reachable (MV3 service-worker
// hosts, or the popover's mount path where we want a synchronous
// answer to avoid first-paint flicker).

import type { Action } from "@inkwell/shared";
import { detectLanguage, type DetectionResult } from "./languages";

/** Where the text came from.
 *
 *  - "field" — inside a textarea, input, or contenteditable. The user
 *    is drafting; the default is to fix their grammar.
 *  - "page"  — a normal page selection, OCR result, or anything else
 *    where the text isn't the user's draft. The default is to reply
 *    to it.
 */
export type DefaultActionSource = "field" | "page";

interface DecideArgs {
  text: string;
  source: DefaultActionSource;
}

/**
 * Async decider — consults Chrome's CLD via {@link detectLanguage}
 * first, with the ASCII heuristic as fallback. ~10 ms in practice.
 * Use this on surfaces that can afford one event-loop turn (side
 * panel hooks).
 */
export async function decideDefaultAction({ text, source }: DecideArgs): Promise<Action> {
  return englishToAction(await isEnglishAsync(text), source);
}

/**
 * Synchronous decider — ASCII heuristic only. Use this on surfaces
 * that need an answer *now*, e.g. the in-page popover's mount path
 * where the action choice has to land before the shadow root is
 * drawn so users don't see the segmented picker flip.
 */
export function decideDefaultActionSync({ text, source }: DecideArgs): Action {
  return englishToAction(isLikelyEnglishSync(text), source);
}

/**
 * Decider variant that takes a pre-fetched CLD result. Useful when
 * the caller has already run language detection in parallel with
 * other I/O (e.g. the popover loads ``lastUsed`` + ``settings`` +
 * detection in the same ``Promise.all``) and wants to apply it
 * synchronously at render time.
 *
 * When ``detection`` is null — CLD bailed because the text was too
 * short or low-confidence — we fall through to the ASCII heuristic,
 * matching the behaviour of {@link decideDefaultActionSync}. When
 * CLD reports a confident non-English language (French, Spanish,
 * Chinese, …) this is the only path that catches short Latin-script
 * non-English text the heuristic would have misread as English.
 */
export function decideDefaultActionWithDetection(
  args: DecideArgs & { detection: DetectionResult | null },
): Action {
  const english = args.detection
    ? args.detection.language === "en"
    : isLikelyEnglishSync(args.text);
  return englishToAction(english, args.source);
}

function englishToAction(english: boolean, source: DefaultActionSource): Action {
  if (!english) return "translate";
  return source === "field" ? "grammar" : "reply";
}

async function isEnglishAsync(text: string): Promise<boolean> {
  const detection = await detectLanguage(text);
  if (detection) return detection.language === "en";
  // CLD couldn't decide (short text, unavailable, low confidence).
  // Fall through to the heuristic — gives us the right answer on
  // English prose and conservatively returns false for anything in
  // a non-Latin script, which is exactly what "translate" wants.
  return isLikelyEnglishSync(text);
}

/**
 * Fast, dependency-free English check based on the share of glyphs
 * that fall inside the Latin Unicode ranges English text actually
 * uses (ASCII + Latin-1 supplement + a handful of curly-quote /
 * em-dash code points rich-text editors paste in). Whitespace and
 * line endings are ignored so paragraph breaks don't skew the ratio.
 *
 * - Real English text scores ~1.0 even when copy-pasted from Word.
 * - Mixed-script (German names in English prose, French loanwords)
 *   stays comfortably above the threshold.
 * - CJK / Arabic / Cyrillic / Devanagari land at ~0, which routes
 *   them to "translate".
 */
export function isLikelyEnglishSync(text: string): boolean {
  let total = 0;
  let latin = 0;
  for (const ch of text.trim()) {
    const code = ch.codePointAt(0)!;
    // Skip whitespace — present in every script, would dilute the ratio.
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) continue;
    total++;
    if (isLatinCodePoint(code)) latin++;
  }
  if (total === 0) return true; // empty / whitespace → don't force translate
  return latin / total >= ENGLISH_THRESHOLD;
}

// Tuned to clear typed English with the odd smart quote (~0.97) and
// to keep heavily punctuated English (URLs, code) above the bar.
const ENGLISH_THRESHOLD = 0.85;

function isLatinCodePoint(code: number): boolean {
  // ASCII printable.
  if (code >= 0x20 && code <= 0x7e) return true;
  // Latin-1 Supplement — café, naïve, façade, etc.
  if (code >= 0xa0 && code <= 0xff) return true;
  // Latin Extended-A — Polish/Czech/etc. names; still "Latin script".
  if (code >= 0x0100 && code <= 0x017f) return true;
  // General Punctuation glyphs that rich-text editors paste into
  // otherwise-ASCII English: em dash, en dash, smart quotes, ellipsis.
  if (code === 0x2013 || code === 0x2014) return true;
  if (code >= 0x2018 && code <= 0x201d) return true;
  if (code === 0x2026) return true;
  return false;
}
