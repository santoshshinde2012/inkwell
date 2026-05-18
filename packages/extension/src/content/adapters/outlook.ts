import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// Outlook on the web (outlook.live.com / outlook.office.com /
// outlook.office365.com). The compose body is a contenteditable; the
// conversation lives in the reading pane. Outlook rolls its DOM often and
// obfuscates class names, so this adapter leans on stable-ish roles/ids and
// degrades to subject + draft when the thread can't be found.

const MAX_THREAD_MESSAGES = 8;

export class OutlookAdapter implements SiteAdapter {
  readonly site = "outlook";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);

    const subject =
      document
        .querySelector<HTMLElement>('[role="heading"][aria-level="2"]')
        ?.innerText.trim() ??
      document
        .querySelector<HTMLElement>('[role="main"] [role="heading"]')
        ?.innerText.trim();

    const thread = this.extractThread();

    const ctx: RequestContext = {
      site: this.site,
      pageTitle: (subject ?? document.title).slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(thread.length ? { thread } : {}),
    };
    if (subject) ctx.meta = { subject: subject.slice(0, 300) };
    return ctx;
  }

  private extractThread(): NonNullable<RequestContext["thread"]> {
    const out: NonNullable<RequestContext["thread"]> = [];
    // Reading-pane message bodies: Outlook gives them an id starting
    // "UniqueMessageBody" or an aria-label of "Message body".
    const bodies = document.querySelectorAll<HTMLElement>(
      '[id^="UniqueMessageBody"], [aria-label="Message body"]',
    );
    for (const body of Array.from(bodies).slice(-MAX_THREAD_MESSAGES)) {
      const text = body.innerText.trim();
      if (!text) continue;
      // The sender is usually a nearby element carrying the address in a
      // title attribute, or an aria-labelled "From" element.
      const card =
        body.closest<HTMLElement>('[role="listitem"], article') ?? body;
      const author =
        card
          .querySelector<HTMLElement>("span[title*='@']")
          ?.getAttribute("title")
          ?.trim() ??
        card
          .querySelector<HTMLElement>('[aria-label*="From" i]')
          ?.innerText.trim();
      out.push({
        ...(author ? { author: author.slice(0, 200) } : {}),
        text: text.slice(0, LIMITS.MAX_CONTEXT_CHARS),
      });
    }
    return out;
  }
}
