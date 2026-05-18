// Client-side language detection.
//
// Wraps chrome.i18n.detectLanguage (Chrome's bundled CLD model) — no network
// call, no extra permission, instant. The detected id is used to:
//   • label the popover ("Detected: French"),
//   • tag translation/action history entries,
//   • seed the request's `sourceLanguage` field.
//
// The backend model still detects/verifies the language from the text
// itself, so an inconclusive or wrong detection here only costs a UI hint —
// never correctness. When detection is not confident we report null and the
// caller falls back to "auto".

import { normalizeLanguageCode, type LanguageId } from "@inkwell/shared";

export interface DetectionResult {
  language: LanguageId;
  /** 0–100 — the detector's confidence in the top language. */
  confidence: number;
}

// Detection on very short strings is unreliable; below these thresholds we
// treat the result as inconclusive and let the model decide.
const MIN_TEXT_LENGTH = 12;
const MIN_CONFIDENCE = 50;

/**
 * Detect the dominant language of `text`. Resolves to null when there is too
 * little text, the detector is unavailable, or confidence is too low.
 */
export const detectLanguage = async (
  text: string,
): Promise<DetectionResult | null> => {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) return null;
  if (typeof chrome === "undefined" || !chrome.i18n?.detectLanguage) {
    return null;
  }

  try {
    const result = await new Promise<chrome.i18n.LanguageDetectionResult>(
      (resolve, reject) => {
        chrome.i18n.detectLanguage(trimmed, (r) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(r);
        });
      },
    );

    const top = result.languages[0];
    if (!top || top.percentage < MIN_CONFIDENCE) return null;

    const id = normalizeLanguageCode(top.language);
    if (!id) return null;
    return { language: id, confidence: top.percentage };
  } catch {
    // Detection is best-effort — never surface a failure to the caller.
    return null;
  }
};
