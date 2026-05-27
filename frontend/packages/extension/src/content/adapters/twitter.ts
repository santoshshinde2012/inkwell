import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// X / Twitter compose box is a Draft.js contenteditable. The post we're
// replying to lives in the nearest `article[data-testid='tweet']` ancestor
// or, on the dedicated reply page, in the article above the composer.

export class TwitterAdapter implements SiteAdapter {
  readonly site = "x";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);

    let parentTweet: HTMLElement | null = target.closest("article[data-testid='tweet']");
    if (!parentTweet) {
      const articles = document.querySelectorAll<HTMLElement>("article[data-testid='tweet']");
      parentTweet = articles[0] ?? null;
    }
    let post: RequestContext["post"];
    if (parentTweet) {
      const author =
        parentTweet
          .querySelector<HTMLElement>("[data-testid='User-Name']")
          ?.innerText.split("\n")[0]
          ?.trim() ?? undefined;
      const text = parentTweet
        .querySelector<HTMLElement>("[data-testid='tweetText']")
        ?.innerText.trim();
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
}
