// Per-site context extractors. Each adapter knows where to look on its host
// site for the thread/post the user is replying to. The generic adapter is
// the always-available fallback.

import type { RequestContext } from "@inkwell/shared";
import { GenericAdapter } from "./generic";
import { GmailAdapter } from "./gmail";
import { OutlookAdapter } from "./outlook";
import { LinkedInAdapter } from "./linkedin";
import { TwitterAdapter } from "./twitter";
import { SlackAdapter } from "./slack";
import { WhatsAppAdapter } from "./whatsapp";

export interface SiteAdapter {
  /** Short site identifier, included in the request context. */
  readonly site: string;
  /** Build a context object for the field the user is composing in. */
  extractContext(targetField: HTMLElement): Promise<RequestContext>;
}

const ADAPTERS: ReadonlyArray<{ test: (host: string) => boolean; build: () => SiteAdapter }> = [
  { test: (h) => h === "mail.google.com", build: () => new GmailAdapter() },
  {
    test: (h) =>
      h === "outlook.live.com" ||
      h === "outlook.office.com" ||
      h === "outlook.office365.com",
    build: () => new OutlookAdapter(),
  },
  { test: (h) => h.endsWith("linkedin.com"), build: () => new LinkedInAdapter() },
  { test: (h) => h === "x.com" || h === "twitter.com" || h.endsWith(".x.com"), build: () => new TwitterAdapter() },
  { test: (h) => h === "app.slack.com", build: () => new SlackAdapter() },
  { test: (h) => h === "web.whatsapp.com", build: () => new WhatsAppAdapter() },
];

export const selectAdapter = (hostname: string): SiteAdapter => {
  const h = hostname.toLowerCase();
  for (const entry of ADAPTERS) {
    if (entry.test(h)) return entry.build();
  }
  return new GenericAdapter();
};
