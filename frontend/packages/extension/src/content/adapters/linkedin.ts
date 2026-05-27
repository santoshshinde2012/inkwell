import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// LinkedIn renders feed posts inside `[data-id^='urn:li:activity']` cards. The
// comment box (which is what we usually attach to) is below the post in the
// same card. We walk up to find the enclosing post and extract its text.

export class LinkedInAdapter implements SiteAdapter {
  readonly site = "linkedin";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);

    const card = target.closest<HTMLElement>(
      "[data-id^='urn:li:activity'], [data-urn^='urn:li:activity']",
    );
    let post: RequestContext["post"];
    if (card) {
      const author = this.findAuthor(card);
      const text = this.findPostText(card);
      if (text) {
        post = {
          ...(author ? { author } : {}),
          text: text.slice(0, LIMITS.MAX_CONTEXT_CHARS),
        };
      }
    }

    return {
      site: this.site,
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(post ? { post } : {}),
    };
  }

  private findAuthor(card: HTMLElement): string | undefined {
    const a =
      card.querySelector<HTMLElement>(".update-components-actor__name")?.innerText ??
      card.querySelector<HTMLElement>(".feed-shared-actor__name")?.innerText;
    return a?.trim().slice(0, 200);
  }

  private findPostText(card: HTMLElement): string | undefined {
    const t =
      card.querySelector<HTMLElement>(".feed-shared-update-v2__description")?.innerText ??
      card.querySelector<HTMLElement>(".update-components-text")?.innerText ??
      card.querySelector<HTMLElement>(".feed-shared-text")?.innerText;
    return t?.trim();
  }
}
