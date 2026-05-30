// Helpers that bridge the side panel (an extension page) to whatever is
// happening in the user's active tab.
//
// Pulled out of the view so React state ownership stays with the caller
// and these stay trivially testable.

/** Where the captured selection came from. "field" = inside a
 *  textarea / input / contenteditable; "page" = a normal page-text
 *  selection. The side panel forwards this to the default-action
 *  decider so a draft-style selection gets "grammar" and a normal
 *  page selection gets "reply" (when the text is English). */
export type SelectionSource = "field" | "page";

export type CaptureResult =
  | { kind: "ok"; text: string; source: SelectionSource }
  | { kind: "empty" }
  | { kind: "blocked" };

const MESSAGES: Record<Exclude<CaptureResult["kind"], "ok">, string> = {
  empty: "No text is selected on the active tab. Highlight some text first, then try again.",
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
    })) as { text?: string; source?: SelectionSource } | undefined;
    const text = (res?.text ?? "").trim();
    // Default to "page" when an older content script (or unknown
    // sender) doesn't include the source tag — matches the previous
    // behaviour for selections we can't classify.
    const source: SelectionSource = res?.source === "field" ? "field" : "page";
    return text ? { kind: "ok", text, source } : { kind: "empty" };
  } catch {
    return { kind: "blocked" };
  }
};

export const captureErrorMessage = (kind: Exclude<CaptureResult["kind"], "ok">): string =>
  MESSAGES[kind];

// Title cap mirrors the shared schema's `PageTitle` constraint (max 300).
const MAX_PAGE_TITLE = 300;

// Snapshot of the active tab the side panel can attach to a completion
// request. Both fields are optional because the side panel itself is an
// extension page (chrome-extension://…) — when the user is on an internal
// browser page, a sandboxed iframe, or before `activeTab` is granted, we
// simply have nothing to send.
export interface ActiveTabContext {
  pageTitle?: string;
  pageUrl?: string;
  /** Declared page metadata (site name, description, article info, …)
   *  pulled from the active tab's content script, when reachable. Grounds
   *  side-panel completions in the current site the same way the in-page
   *  adapters do. Absent on internal pages or before `activeTab` is granted. */
  meta?: Record<string, string>;
}

/**
 * Read the active tab's URL + title for use as completion context.
 *
 * The side panel CANNOT use `window.location` for this — the side panel
 * is an extension page and `window.location.origin` is
 * `chrome-extension://<id>`, which the backend's `AnyHttpUrl`-typed
 * `pageUrl` field rejects with `VALIDATION_FAILED`. The shared zod
 * schema is looser (any URL) so the request passes client-side and
 * the failure only surfaces at the server.
 *
 * We pull the values from `chrome.tabs.query` instead, and only return
 * a `pageUrl` when the scheme is http/https — silently omitting it
 * otherwise so the backend's Pydantic check stays happy.
 */
export const captureActiveTabContext = async (): Promise<ActiveTabContext> => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return {};
    const out: ActiveTabContext = {};
    if (tab.title) out.pageTitle = tab.title.slice(0, MAX_PAGE_TITLE);
    const url = tab.url ?? "";
    if (url.startsWith("https://") || url.startsWith("http://")) {
      out.pageUrl = url;
    }
    // Best-effort: ask the active tab's content script for declared page
    // metadata. Fails silently (internal pages, no content script, before
    // activeTab is granted) — title/url alone are still useful context.
    if (tab.id !== undefined) {
      try {
        const res = (await chrome.tabs.sendMessage(tab.id, {
          type: "GET_PAGE_META",
        })) as { meta?: Record<string, string> } | undefined;
        if (res?.meta && Object.keys(res.meta).length) out.meta = res.meta;
      } catch {
        // Content script unreachable — leave meta unset.
      }
    }
    return out;
  } catch {
    return {};
  }
};
