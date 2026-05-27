import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

// The generic adapter is intentionally minimal: it only exposes what the user
// is currently typing (the draft) plus the page title. It does NOT scrape
// arbitrary page content, because we don't know what's on the page and we
// don't want to leak unrelated information to the model. Site-specific
// adapters do the targeted thread/post extraction.

export class GenericAdapter implements SiteAdapter {
  readonly site = "generic";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);
    return {
      site: this.site,
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
    };
  }
}
