// Typed wrappers around chrome.runtime messaging. All messages go through the
// shared discriminated union so both ends agree on the contract.

import {
  ExtensionMessage,
  ExtensionMessageSchema,
} from "@inkwell/shared";

/** Send a message to the background and await the typed reply. */
export const sendToBackground = <R = unknown>(
  msg: ExtensionMessage,
): Promise<R> => {
  return new Promise<R>((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response: unknown) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as R);
    });
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
