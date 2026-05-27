// Cross-context UUID generator.
//
// `crypto.randomUUID()` is the natural choice but is restricted to
// *secure contexts* — extension pages and HTTPS / localhost frames are
// fine, but a content script running in a plain HTTP page sees the
// host page's `window.crypto`, where `randomUUID` is `undefined` and a
// call throws. That made the in-page popover's Generate button fail
// silently on http:// hosts (the unhandled rejection was swallowed by
// `void start()`).
//
// We try `crypto.randomUUID` first, fall back to `getRandomValues`
// (available everywhere, no secure-context gate) formatted as RFC 4122
// v4, and lastly to Math.random so we never throw. The output always
// matches the v4 shape so it passes the `z.string().uuid()` schema on
// the wire.

export const makeUuid = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // crypto.randomUUID exists but is gated by secure-context — fall through.
  }

  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 §4.4: set version to 4 and variant to 10xx.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
};
