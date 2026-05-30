import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import { extractPageMeta } from "../page-meta";
import type { SiteAdapter } from "./index";

// The generic adapter is the always-available fallback for sites without a
// dedicated adapter. It exposes what the user is currently typing (the
// draft) plus the page's *declared* metadata (title, site name, a one-line
// description, article author/section/date, main heading) so the model
// understands what kind of page it's helping on.
//
// It deliberately does NOT scrape arbitrary body content — only metadata the
// page advertises about itself (Open Graph / <meta> / JSON-LD), which avoids
// leaking unrelated page text to the model. The actual content to act on
// comes from the user's draft or selection; site-specific adapters do the
// targeted thread/post extraction.

export class GenericAdapter implements SiteAdapter {
  readonly site = "generic";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);
    const meta = extractPageMeta();
    return {
      site: this.site,
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(Object.keys(meta).length ? { meta } : {}),
    };
  }
}
