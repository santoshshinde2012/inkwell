// Asks the active tab's content script for whatever text the user has
// selected and returns either the trimmed string or a UX-ready error
// message. Pulled out of the view so React state ownership stays with
// the caller and this function stays trivially testable.

export type CaptureResult =
  | { kind: "ok"; text: string }
  | { kind: "empty" }
  | { kind: "blocked" };

const MESSAGES: Record<Exclude<CaptureResult["kind"], "ok">, string> = {
  empty:
    "No text is selected on the active tab. Highlight some text first, then try again.",
  blocked:
    "Can't read from the active tab — Inkwell's content script doesn't run on internal browser pages.",
};

export const captureActiveSelection = async (): Promise<CaptureResult> => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return { kind: "empty" };
    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: "GET_SELECTION",
    })) as { text?: string } | undefined;
    const text = (res?.text ?? "").trim();
    return text ? { kind: "ok", text } : { kind: "empty" };
  } catch {
    return { kind: "blocked" };
  }
};

export const captureErrorMessage = (
  kind: Exclude<CaptureResult["kind"], "ok">,
): string => MESSAGES[kind];
