// React hook over `chrome.storage.onChanged`.
//
// This pattern appears in half a dozen places across the side panel
// and options page:
//
//     useEffect(() => {
//       const onChanged = (changes, area) => {
//         if (area !== "local") return;
//         if (KEY in changes) refresh();
//       };
//       chrome.storage.onChanged.addListener(onChanged);
//       return () => chrome.storage.onChanged.removeListener(onChanged);
//     }, [refresh]);
//
// The hook below collapses that to a single line and makes the contract
// explicit: subscribe to ``chrome.storage.local`` writes for one or
// more specific keys, and receive the relevant subset of changes
// (filtered by the key list). Other storage areas (`sync`, `session`,
// `managed`) are ignored — every Inkwell setting lives in `local`.
//
// Implementation note: the handler is stored in a ref so callers can
// pass an inline arrow function without re-subscribing on every
// render. The listener is registered on mount and torn down on
// unmount; the only effect re-run happens when the *keys* change,
// keyed by their joined-string fingerprint.

import { useEffect, useRef } from "react";

type StorageChanges = Record<string, chrome.storage.StorageChange>;

/**
 * Subscribe to writes against a fixed set of ``chrome.storage.local``
 * keys. The callback receives ONLY the relevant subset of changes
 * (filtered by the key list) — callers can index by key without
 * checking ``in`` again.
 */
export function useStorageChange(
  keys: readonly string[],
  handler: (changes: StorageChanges) => void,
): void {
  // Keep the latest handler accessible without retriggering the effect
  // — otherwise every render that doesn't memo `handler` would tear
  // down and re-register the listener.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // `keys.join(" ")` is the stable fingerprint for the dep array. The
  // joined form is fine because Inkwell's keys are short ASCII strings
  // chosen from a small alphabet and never contain spaces.
  const keysFingerprint = keys.join(" ");

  useEffect(() => {
    const keySet = new Set(keysFingerprint.split(" ").filter(Boolean));
    const onChanged = (changes: StorageChanges, area: chrome.storage.AreaName): void => {
      if (area !== "local") return;
      const filtered: StorageChanges = {};
      let touched = false;
      for (const key of Object.keys(changes)) {
        if (keySet.has(key)) {
          filtered[key] = changes[key]!;
          touched = true;
        }
      }
      if (touched) handlerRef.current(filtered);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [keysFingerprint]);
}
