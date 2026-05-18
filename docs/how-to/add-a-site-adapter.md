# How-to: Add a site adapter

_For someone extending the extension to extract context from a new
site (e.g., adding GitHub support)._

A site adapter teaches the extension how to find the thread/post the
user is replying to on a particular site. The
[generic adapter](../../packages/extension/src/content/adapters/generic.ts)
is the always-available fallback (page title + draft only); per-site
adapters do targeted DOM extraction.

Adapters already ship for Gmail, Outlook, LinkedIn, X, Slack, and
WhatsApp Web. This guide walks through adding one more — we use GitHub as
the worked example because it has no adapter yet.

## What you'll change

1. Add a new adapter class in
   `packages/extension/src/content/adapters/<site>.ts`.
2. Register it in
   [`adapters/index.ts`](../../packages/extension/src/content/adapters/index.ts).
3. Add the host to `host_permissions` in
   [`manifest.config.ts`](../../packages/extension/manifest.config.ts).

## 1. Write the adapter

Adapters implement the `SiteAdapter` interface:

```ts
export interface SiteAdapter {
  readonly site: string;
  extractContext(targetField: HTMLElement): Promise<RequestContext>;
}
```

`targetField` is the contenteditable / textarea / input the user is
focused on. Your job: walk up to the relevant container, pull the thread
or post, and shape it into a `RequestContext` (see
[`shared/src/schemas.ts`](../../packages/shared/src/schemas.ts)).

Minimal example — GitHub:

```ts
// packages/extension/src/content/adapters/github.ts
import type { RequestContext } from "@inkwell/shared";
import { LIMITS } from "@inkwell/shared";
import { readText } from "../editable";
import type { SiteAdapter } from "./index";

const MAX_THREAD_MESSAGES = 8;

export class GitHubAdapter implements SiteAdapter {
  readonly site = "github";

  async extractContext(target: HTMLElement): Promise<RequestContext> {
    const draft = readText(target).slice(0, LIMITS.MAX_DRAFT_CHARS);

    const comments = Array.from(
      document.querySelectorAll<HTMLElement>(".timeline-comment"),
    ).slice(-MAX_THREAD_MESSAGES);

    const thread = comments
      .map((c) => ({
        author:
          c.querySelector<HTMLElement>(".author")?.innerText.trim() ??
          undefined,
        text:
          c.querySelector<HTMLElement>(".comment-body")?.innerText.trim() ?? "",
      }))
      .filter((t) => t.text);

    return {
      site: this.site,
      pageTitle: document.title.slice(0, 300),
      pageUrl: window.location.origin + window.location.pathname,
      draft,
      ...(thread.length ? { thread } : {}),
    };
  }
}
```

### Guidelines

- **Cap message count** (we use 8 for Gmail). Sending the entire
  conversation history wastes tokens and slows the model.
- **Cap each message length** with `LIMITS.MAX_CONTEXT_CHARS` from
  shared.
- **Degrade gracefully.** Sites change selectors. If your adapter
  can't find anything, return an empty `thread` rather than throwing —
  the generic fallback (draft + title) still produces a useful result.
- **Don't pull anything sensitive.** Sites have notification badges,
  private DMs, etc. Be deliberate about what you select.
- **No side effects.** Adapters are read-only — never click, never
  scroll, never mutate the DOM.

## 2. Register

```ts
// packages/extension/src/content/adapters/index.ts
import { GitHubAdapter } from "./github";

const ADAPTERS = [
  // ...existing entries
  { test: (h: string) => h === "github.com", build: () => new GitHubAdapter() },
];
```

## 3. Permission

```ts
// packages/extension/manifest.config.ts
host_permissions: [
  // ...existing entries
  "https://github.com/*",
],
```

The content script's `<all_urls>` match means it loads everywhere — but
the **adapter** is only selected on hosts you list here. Without the
host permission, requests from this site can't reach our backend.

## 4. Test

```bash
pnpm --filter @inkwell/extension build
```

Reload the extension on `chrome://extensions`. Open a GitHub issue or
pull request, focus the comment box, click ✨. The popover should run —
and `/api/v1/complete` should receive your `site: "github"` context.

To inspect what the adapter actually extracts, add a temporary
`console.log` in `extractContext` and watch the host page's DevTools.

## 5. Sanitize defaults the user might expect

Some sites are sensitive even though they don't match our default
blocklist. If your new site qualifies (HR portals, compliance tools),
add it to
[`DEFAULT_BLOCKED_HOSTS`](../../packages/shared/src/messages.ts) so the
trigger doesn't appear by default. Users can still opt in via the
options page.

## See also

- [Reference: Architecture § Extension](../reference/architecture.md#extension)
- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete) —
  the shape your adapter's output must satisfy.
- [Security § Mitigations § Extension](../security.md#extension-manifest-v3)
