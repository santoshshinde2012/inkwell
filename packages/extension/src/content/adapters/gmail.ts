import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// Gmail's compose body is a contenteditable inside a deeply nested DOM. The
// thread it belongs to lives in `.adn` containers (one per message). Gmail
// rolls these selectors occasionally so we degrade gracefully rather than
// hard-crashing the popover.

const MAX_THREAD_MESSAGES = 8;

export class GmailAdapter implements SiteAdapter {
  readonly site = "gmail";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);

    const subject =
      document.querySelector("h2[data-thread-perm-id]")?.textContent?.trim() ??
      document.title;

    const thread = this.extractThread();

    const ctx: RequestContext = {
      site: this.site,
      pageTitle: subject?.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(thread && thread.length ? { thread } : {}),
    };
    if (subject) ctx.meta = { subject: subject.slice(0, 300) };
    return ctx;
  }

  private extractThread(): RequestContext["thread"] {
    const out: NonNullable<RequestContext["thread"]> = [];
    // Each message in the conversation: span[email] for sender, div.a3s for body.
    const containers = document.querySelectorAll<HTMLElement>(
      "div[role='listitem'] div.adn, div.adn",
    );
    const list = Array.from(containers).slice(-MAX_THREAD_MESSAGES);
    for (const c of list) {
      const author =
        c.querySelector<HTMLElement>("span[email]")?.getAttribute("email") ??
        c.querySelector<HTMLElement>(".gD")?.getAttribute("email") ??
        c.querySelector<HTMLElement>(".gD")?.textContent?.trim() ??
        undefined;
      const body =
        c.querySelector<HTMLElement>("div.a3s")?.innerText.trim() ??
        c.innerText.trim();
      if (!body) continue;
      out.push({
        author,
        text: body.slice(0, LIMITS.MAX_CONTEXT_CHARS),
      });
    }
    return out;
  }
}
