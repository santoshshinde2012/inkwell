// Site allow/blocklist evaluation. Used by the content script before it
// renders the floating trigger, and by the background as defense-in-depth.

import { DEFAULT_BLOCKED_HOSTS } from "@inkwell/shared";
import { localStore } from "./storage";

export type SiteVerdict =
  | { allowed: true; reason: "default" | "allowlist" }
  | { allowed: false; reason: "blocklist" | "blocked-by-default" };

const matchesHost = (hostname: string, pattern: string): boolean => {
  // Pattern is either an exact hostname or a domain suffix.
  // "linkedin.com" matches "www.linkedin.com" but not "evilinkedin.com".
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith("." + p);
};

export const evaluateSite = async (hostname: string): Promise<SiteVerdict> => {
  const [allow, block] = await Promise.all([
    localStore.getAllowlist(),
    localStore.getBlocklist(),
  ]);

  // Effective blocklist = user list ∪ defaults that the user hasn't explicitly
  // removed. We keep the default list strict and only let users opt out by
  // adding to allowlist.
  for (const pattern of block) {
    if (matchesHost(hostname, pattern)) {
      return { allowed: false, reason: "blocklist" };
    }
  }
  for (const pattern of DEFAULT_BLOCKED_HOSTS) {
    if (matchesHost(hostname, pattern)) {
      // User must explicitly allowlist a default-blocked host to override.
      const allowedExplicit = allow.some((p) => matchesHost(hostname, p));
      if (!allowedExplicit) {
        return { allowed: false, reason: "blocked-by-default" };
      }
    }
  }
  for (const pattern of allow) {
    if (matchesHost(hostname, pattern)) {
      return { allowed: true, reason: "allowlist" };
    }
  }
  // Default: enabled on any non-sensitive site. Users can tighten this in
  // options if they want strict allowlist mode (Phase 2).
  return { allowed: true, reason: "default" };
};
