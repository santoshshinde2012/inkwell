import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// WhatsApp Web marks incoming messages `.message-in` and outgoing messages
// `.message-out`. The body text is in `span.selectable-text`; the wrapping
// `.copyable-text` carries a `data-pre-plain-text="[time, date] Sender: "`
// attribute we parse for the sender name. Selectors degrade gracefully.

const MAX_THREAD_MESSAGES = 12;

export class WhatsAppAdapter implements SiteAdapter {
  readonly site = "whatsapp";

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
    const rows = document.querySelectorAll<HTMLElement>(".message-in, .message-out");
    for (const row of Array.from(rows).slice(-MAX_THREAD_MESSAGES)) {
      const incoming = row.classList.contains("message-in");
      const text = (
        row.querySelector<HTMLElement>("span.selectable-text") ??
        row.querySelector<HTMLElement>(".copyable-text span")
      )?.innerText.trim();
      if (!text) continue;
      // data-pre-plain-text looks like "[10:24, 1/2/2026] Alex Rivera: ".
      const meta = row
        .querySelector<HTMLElement>(".copyable-text")
        ?.getAttribute("data-pre-plain-text");
      const author = meta?.match(/\]\s*([^:]+):/)?.[1]?.trim() || (incoming ? "Customer" : "You");
      out.push({
        author: author.slice(0, 200),
        text: text.slice(0, LIMITS.MAX_CONTEXT_CHARS),
      });
    }
    return out;
  }
}
