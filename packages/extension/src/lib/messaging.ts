// Typed wrappers around chrome.runtime messaging. All messages go through the
// shared discriminated union so both ends agree on the contract.
//
// The popover (content script) and the side panel (extension page) both go
// through `sendToBackground`. The popover is the one that has to survive
// "Extension context invalidated" — that happens when the extension is
// reloaded (developer reload, or an auto-update) while a page still has the
// OLD content script attached: its `chrome.runtime` reference becomes a
// disconnected stub and every sendMessage call fails. The only fix is a
// page refresh; we surface that as a typed `ExtensionContextInvalidatedError`
// so callers can render an actionable "Refresh page" CTA instead of leaking
// the raw technical message.

import {
  ExtensionMessage,
  ExtensionMessageSchema,
} from "@inkwell/shared";

/** Thrown when the extension's runtime has been invalidated (orphaned
 *  content script after an extension reload). Only a page reload recovers. */
export class ExtensionContextInvalidatedError extends Error {
  constructor() {
    super(
      "Inkwell was updated or reloaded. Refresh this page to continue.",
    );
    this.name = "ExtensionContextInvalidatedError";
  }
}

const CONTEXT_INVALIDATED_HINT = "extension context invalidated";

const isContextInvalidatedMessage = (msg: string | undefined): boolean =>
  typeof msg === "string" &&
  msg.toLowerCase().includes(CONTEXT_INVALIDATED_HINT);

/** Synchronously check whether `chrome.runtime` is still wired up. An
 *  invalidated context returns `undefined` for `chrome.runtime?.id`
 *  immediately, so callers can short-circuit before issuing a call. */
export const isExtensionContextValid = (): boolean => {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

/** Send a message to the background and await the typed reply. */
export const sendToBackground = <R = unknown>(
  msg: ExtensionMessage,
): Promise<R> => {
  // Fast path — when the runtime is gone, fail before touching the API
  // (which can throw synchronously or fire `lastError` asynchronously).
  if (!isExtensionContextValid()) {
    return Promise.reject(new ExtensionContextInvalidatedError());
  }
  return new Promise<R>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response: unknown) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isContextInvalidatedMessage(err.message)) {
            reject(new ExtensionContextInvalidatedError());
          } else {
            reject(new Error(err.message));
          }
          return;
        }
        resolve(response as R);
      });
    } catch (e) {
      // Some Chrome builds raise the invalidation synchronously instead of
      // routing it through `lastError` — normalise both paths.
      const message = e instanceof Error ? e.message : String(e);
      if (isContextInvalidatedMessage(message)) {
        reject(new ExtensionContextInvalidatedError());
      } else {
        reject(e instanceof Error ? e : new Error(message));
      }
    }
  });
};

/**
 * Validate an incoming message against the discriminated union. Reject anything
 * that doesn't match — never trust messages by shape alone, even from our own
 * contexts (a compromised content script would be a way in).
 */
export const parseExtensionMessage = (input: unknown): ExtensionMessage | null => {
  const r = ExtensionMessageSchema.safeParse(input);
  return r.success ? r.data : null;
};
