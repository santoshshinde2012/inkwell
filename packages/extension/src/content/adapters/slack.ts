import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// Slack renders each message as a [data-qa="message_container"]; the body is
// rich-text content and the sender appears only on the first message of a
// run. Slack changes its DOM periodically, so every selector has a fallback
// and extraction degrades to draft-only rather than throwing.

const MAX_THREAD_MESSAGES = 10;

export class SlackAdapter implements SiteAdapter {
  readonly site = "slack";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);
    const thread = this.extractThread();
    return {
      site: this.site,
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(thread.length ? { thread } : {}),
    };
  }

  private extractThread(): NonNullable<RequestContext["thread"]> {
    const out: NonNullable<RequestContext["thread"]> = [];
    const containers = document.querySelectorAll<HTMLElement>(
      '[data-qa="message_container"], .c-message_kit__background',
    );
    // Slack omits the sender on consecutive messages from one person;
    // carry it forward so each extracted message keeps an author.
    let lastAuthor: string | undefined;
    for (const c of Array.from(containers).slice(-MAX_THREAD_MESSAGES)) {
      const sender =
        c
          .querySelector<HTMLElement>('[data-qa="message_sender_name"]')
          ?.innerText.trim() ??
        c.querySelector<HTMLElement>(".c-message__sender")?.innerText.trim();
      if (sender) lastAuthor = sender;
      const text =
        c
          .querySelector<HTMLElement>('[data-qa="message_text"]')
          ?.innerText.trim() ??
        c
          .querySelector<HTMLElement>(".p-rich_text_section")
          ?.innerText.trim();
      if (!text) continue;
      out.push({
        ...(lastAuthor ? { author: lastAuthor.slice(0, 200) } : {}),
        text: text.slice(0, LIMITS.MAX_CONTEXT_CHARS),
      });
    }
    return out;
  }
}
